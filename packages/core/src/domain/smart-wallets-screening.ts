/**
 * @file smart-wallets-screening.ts
 * @description Pure helper logic for smart wallet candidate discovery, snapshot diffing, and position ledger tracking.
 */

export interface SmartWalletSnapshot {
  initialized: boolean
  /**
   * Permanently handled position addresses: recorded on first run (baseline) or
   * after a successful deploy. These are never re-evaluated.
   */
  positions: string[]
  /**
   * Transiently rejected ("vetoed") positions, keyed by position address.
   * A filter reject is a point-in-time decision, so these become eligible again
   * once the retry TTL has elapsed. Absent/empty on legacy snapshots.
   */
  vetoed?: Record<string, SmartWalletVetoEntry>
}

export interface SmartWalletVetoEntry {
  /** Epoch ms of the most recent veto. */
  at: number
  /** Human-readable reject reason, kept for telemetry/debugging. */
  reason?: string
}

export interface WalletPositionItem {
  position: string
  pool: string
}

export interface SmartWalletProcessedPosition {
  position: string
  /** True when the position was successfully deployed or explicitly vetoed. Failed deploys stay uncommitted so they retry on the next tick. */
  resolved: boolean
  /** True when `resolved` was a filter veto rather than a successful deploy. */
  vetoed?: boolean
  reason?: string
  /** Epoch ms of the veto; defaults to now when omitted. */
  at?: number
}

export interface SmartWalletDiffOptions {
  /** Epoch ms used for the TTL comparison. Defaults to Date.now(). */
  now?: number
  /** How long a vetoed position stays suppressed before it is retried. Defaults to DEFAULT_VETO_RETRY_MS. */
  vetoRetryMs?: number
}

export interface SmartWalletDiffResult {
  isFirstRun: boolean
  newPositions: WalletPositionItem[]
  uniquePools: string[]
  nextSnapshot: SmartWalletSnapshot
}

/** Fallback TTL when the caller does not supply screening.smartWalletVetoRetryHours. */
export const DEFAULT_VETO_RETRY_MS = 6 * 60 * 60 * 1000

function normalizeSnapshot(existingSnapshot?: SmartWalletSnapshot | null): SmartWalletSnapshot {
  if (!existingSnapshot || typeof existingSnapshot !== 'object') {
    return { initialized: false, positions: [], vetoed: {} }
  }
  return {
    initialized: Boolean(existingSnapshot.initialized),
    positions: Array.isArray(existingSnapshot.positions) ? existingSnapshot.positions : [],
    vetoed:
      existingSnapshot.vetoed && typeof existingSnapshot.vetoed === 'object' ? { ...existingSnapshot.vetoed } : {},
  }
}

/**
 * Calculates new smart wallet positions against a snapshot ledger.
 * On first run (!snapshot.initialized) it records the current positions as a
 * permanent baseline and returns isFirstRun: true.
 *
 * Positions that were vetoed stay suppressed only while younger than
 * `vetoRetryMs`, so a reject driven by a transient value (TVL, token age,
 * volatility, fee/TVL) is retried later instead of being blacklisted forever.
 */
export function diffSmartWalletPositions(
  currentPositions: WalletPositionItem[],
  existingSnapshot?: SmartWalletSnapshot | null,
  options: SmartWalletDiffOptions = {},
): SmartWalletDiffResult {
  const snapshot = normalizeSnapshot(existingSnapshot)
  const now = options.now ?? Date.now()
  const vetoRetryMs = options.vetoRetryMs ?? DEFAULT_VETO_RETRY_MS

  if (!snapshot.initialized) {
    const allPos = Array.from(new Set(currentPositions.map((p) => p.position)))
    return {
      isFirstRun: true,
      newPositions: [],
      uniquePools: [],
      nextSnapshot: { initialized: true, positions: allPos, vetoed: {} },
    }
  }

  const knownSet = new Set(snapshot.positions)
  const activeVetoes: Record<string, SmartWalletVetoEntry> = {}
  for (const [position, entry] of Object.entries(snapshot.vetoed ?? {})) {
    if (entry && now - entry.at < vetoRetryMs) {
      knownSet.add(position)
      activeVetoes[position] = entry
    }
  }

  const newPositions = currentPositions.filter((p) => !knownSet.has(p.position))
  const uniquePools = Array.from(new Set(newPositions.map((p) => p.pool).filter(Boolean)))

  return {
    isFirstRun: false,
    newPositions,
    uniquePools,
    nextSnapshot: { initialized: true, positions: [...snapshot.positions], vetoed: activeVetoes },
  }
}

/**
 * Updates the snapshot ledger with newly processed positions.
 * Deployed positions are committed permanently; vetoed positions are recorded
 * with a timestamp (and reason) so they are retried after the TTL. Failed
 * deploys stay uncommitted so they retry on the next screening tick.
 */
export function updateSnapshotPositions(
  snapshot: SmartWalletSnapshot,
  processedPositions: SmartWalletProcessedPosition[],
): SmartWalletSnapshot {
  const knownSet = new Set(snapshot.positions)
  const vetoed: Record<string, SmartWalletVetoEntry> = { ...(snapshot.vetoed ?? {}) }
  for (const item of processedPositions) {
    if (!item.resolved) continue
    if (item.vetoed) {
      vetoed[item.position] = { at: item.at ?? Date.now(), reason: item.reason }
      continue
    }
    knownSet.add(item.position)
    delete vetoed[item.position]
  }
  return {
    initialized: true,
    positions: Array.from(knownSet),
    vetoed,
  }
}
