/**
 * @file liquidation-queue.ts
 * @description Domain manager for persistent unsold token liquidations and reconciliation queue (state.json).
 *
 * @features
 * - Persists unsold token inventory in state.json across daemon restarts
 * - Tracks liquidation attempts, errors, timestamps, and venue fallback metadata
 * - Transitions tokens through lifecycle: pending -> liquidated | abandoned
 * - Filters micro-dust to preserve SOL gas
 *
 * @sideEffects Reads and writes pendingLiquidations in data/state.json under stateMutex
 */

import { log } from '../shared/logger.js'
import type { PendingLiquidation } from '../shared/types.js'
import { loadState, saveState, withStateLock } from './state.js'

export interface EnqueueLiquidationOpts {
  mint: string
  symbol?: string
  amount: number
  usd?: number | null
  pool_address?: string | null
  position?: string | null
  error?: string
}

/**
 * Retrieve all tracked liquidations, optionally filtered by status.
 */
export function getPendingLiquidations(filter?: 'pending' | 'liquidated' | 'abandoned'): PendingLiquidation[] {
  const state = loadState()
  const list = Object.values(state.pendingLiquidations || {})
  if (!filter) return list
  return list.filter((item) => item.status === filter)
}

/**
 * Retrieve a specific token liquidation entry by mint.
 */
export function getPendingLiquidation(mint: string): PendingLiquidation | null {
  const state = loadState()
  return state.pendingLiquidations?.[mint] || null
}

/**
 * Register or update an unsold token in the persistent liquidation backlog.
 */
export async function enqueuePendingLiquidation(opts: EnqueueLiquidationOpts): Promise<PendingLiquidation> {
  return withStateLock(() => {
    const state = loadState()
    if (!state.pendingLiquidations) {
      state.pendingLiquidations = {}
    }

    const existing = state.pendingLiquidations[opts.mint]
    const now = new Date().toISOString()

    let record: PendingLiquidation
    if (existing) {
      record = {
        ...existing,
        symbol: opts.symbol || existing.symbol,
        amount: opts.amount > 0 ? opts.amount : existing.amount,
        usd: opts.usd !== undefined ? opts.usd : existing.usd,
        pool_address: opts.pool_address || existing.pool_address,
        position: opts.position || existing.position || null,
        last_attempt_at: now,
        status: 'pending',
        last_error: opts.error || existing.last_error,
      }
    } else {
      record = {
        mint: opts.mint,
        symbol: opts.symbol,
        amount: opts.amount,
        usd: opts.usd ?? null,
        pool_address: opts.pool_address || null,
        position: opts.position || null,
        added_at: now,
        last_attempt_at: now,
        attempts: 0,
        status: 'pending',
        last_error: opts.error || null,
      }
    }

    state.pendingLiquidations[opts.mint] = record
    saveState(state)

    log(
      'state',
      `Enqueued pending liquidation: ${record.symbol || record.mint.slice(0, 8)} (${record.amount} units${record.usd ? `, ~$${record.usd.toFixed(2)}` : ''}) [status: pending]`,
    )

    return record
  })
}

/**
 * Mark a pending liquidation as successfully liquidated.
 */
export async function markLiquidationSuccess(
  mint: string,
  opts: { tx?: string; amountOutSol?: number } = {},
): Promise<boolean> {
  let position: string | null = null
  const success = await withStateLock(() => {
    const state = loadState()
    const item = state.pendingLiquidations?.[mint]
    if (!item) return false

    position = item.position || null
    item.status = 'liquidated'
    item.last_attempt_at = new Date().toISOString()
    item.last_error = null
    saveState(state)

    log(
      'state',
      `Liquidation success: ${item.symbol || mint.slice(0, 8)} converted to SOL${opts.amountOutSol ? ` (${opts.amountOutSol.toFixed(4)} SOL)` : ''}${opts.tx ? ` [tx: ${opts.tx.slice(0, 16)}...]` : ''}`,
    )
    return true
  })

  if (success) {
    try {
      const { settleTradeLiquidation } = await import('./lessons.js')
      await settleTradeLiquidation(mint, {
        amountOutSol: opts.amountOutSol || 0,
        tx: opts.tx,
        position: position || undefined,
      })
    } catch (e: any) {
      log('state_warn', `Failed to settle trade liquidation in lessons for ${mint}: ${e?.message || e}`)
    }
  }

  return success
}

/**
 * Record a failed liquidation attempt. If attempts or elapsed time exceed configured limits,
 * marks the token as abandoned (rugged / zero-liquidity) to stop quote spam.
 */
export async function markLiquidationAttempt(
  mint: string,
  opts: {
    error?: string
    maxAttempts?: number
    abandonWindowHours?: number
  } = {},
): Promise<{ status: 'pending' | 'abandoned'; attempts: number }> {
  let abandonedPosition: string | null = null
  let lastError: string | null = null

  const result = await withStateLock(() => {
    const state = loadState()
    const item = state.pendingLiquidations?.[mint]
    const maxAttempts = opts.maxAttempts ?? 10
    const abandonWindowHours = opts.abandonWindowHours ?? 2

    if (!item) {
      return { status: 'abandoned' as const, attempts: 0 }
    }

    const now = new Date()
    item.attempts = (item.attempts || 0) + 1
    item.last_attempt_at = now.toISOString()
    item.last_error = opts.error || 'Liquidation attempt failed'
    lastError = item.last_error

    const addedMs = item.added_at ? new Date(item.added_at).getTime() : now.getTime()
    const ageHours = (now.getTime() - addedMs) / (1000 * 60 * 60)

    if (item.attempts >= maxAttempts || ageHours >= abandonWindowHours) {
      item.status = 'abandoned'
      abandonedPosition = item.position || null
      log(
        'state_warn',
        `Liquidation abandoned for ${item.symbol || mint.slice(0, 8)} after ${item.attempts} attempts (${ageHours.toFixed(1)}h). Token marked dead/rugged to halt RPC quote spam.`,
      )
    }

    saveState(state)
    return { status: item.status as 'pending' | 'abandoned', attempts: item.attempts }
  })

  if (result.status === 'abandoned') {
    try {
      const { abandonTradeLiquidation } = await import('./lessons.js')
      await abandonTradeLiquidation(mint, {
        reason: lastError || 'Liquidation attempts exhausted',
        position: abandonedPosition || undefined,
      })
    } catch (e: any) {
      log('state_warn', `Failed to record abandoned liquidation loss for ${mint}: ${e?.message || e}`)
    }
  }

  return result
}

/**
 * Prune old settled (liquidated or abandoned) entries from the liquidation queue.
 */
export async function pruneSettledLiquidations(retentionHours = 24): Promise<number> {
  return withStateLock(() => {
    const state = loadState()
    if (!state.pendingLiquidations) return 0

    const cutoff = Date.now() - retentionHours * 60 * 60 * 1000
    let pruned = 0

    for (const [mint, item] of Object.entries(state.pendingLiquidations)) {
      if (item.status === 'pending') continue
      const lastAction = item.last_attempt_at ? new Date(item.last_attempt_at).getTime() : 0
      if (lastAction > 0 && lastAction <= cutoff) {
        delete state.pendingLiquidations[mint]
        pruned++
      }
    }

    if (pruned > 0) {
      saveState(state)
      log('state', `Pruned ${pruned} settled liquidation entries older than ${retentionHours}h`)
    }
    return pruned
  })
}
