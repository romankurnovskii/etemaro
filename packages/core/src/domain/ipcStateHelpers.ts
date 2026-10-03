/**
 * @file ipcStateHelpers.ts
 * @description Pure helpers for building the IPC state snapshot broadcast to the
 * web console (see Daemon.broadcastIpcState). Kept side-effect free so the
 * live-position matching and phase-derivation logic can be unit tested without
 * instantiating the full Daemon and its adapters.
 * @pattern Domain-layer pure functions, mirroring pnlTracker.ts's computeAgentPnlMetrics.
 */

export interface TrackedPositionLike {
  position?: string
  position_address?: string
  pool?: string
  pool_address?: string
  pnl_usd?: number
  pnl_pct?: number
  peak_pnl_pct?: number
  pool_name?: string
  pair?: string
  tokenSymbol?: string
  initial_value_usd?: number
  unclaimed_fees_usd?: number
  deployed_at?: string
}

export interface LivePositionLike {
  position?: string
  position_address?: string
  pool?: string
  pool_address?: string
  pnl_usd?: number
  pnl_pct?: number
  pair?: string
  total_value_usd?: number
  value_usd?: number
  unclaimed_fees_usd?: number
  lower_bin?: number | null
  upper_bin?: number | null
  active_bin?: number | null
  in_range?: boolean | null
  minutes_out_of_range?: number | null
}

export interface PositionSummaryLike {
  positionAddress: string
  poolAddress: string
  tokenSymbol: string
  pnlUsd: number
  pnlPct: number
  valueUsd: number
  unclaimedFeesUsd: number
  deployedAt?: string
  lowerBin?: number
  upperBin?: number
  activeBin?: number
  inRange?: boolean
  minutesOutOfRange?: number
}

/**
 * Match each tracked position to its live on-chain data.
 *
 * Matches by position id first. Falls back to a pool-only match ONLY when both
 * the tracked and live sides are unambiguous for that pool — two positions
 * sharing a pool must never swap each other's bins/PnL just because a position
 * id lookup missed (e.g. a live-data refresh lagging behind a new deploy).
 */
export function matchLivePositions(
  tracked: TrackedPositionLike[],
  live: LivePositionLike[],
): Map<TrackedPositionLike, LivePositionLike | undefined> {
  const trackedCountByPool = new Map<string, number>()
  for (const p of tracked) {
    const pool = p.pool ?? p.pool_address ?? ''
    trackedCountByPool.set(pool, (trackedCountByPool.get(pool) ?? 0) + 1)
  }
  const liveByPool = new Map<string, LivePositionLike[]>()
  for (const lp of live) {
    const pool = lp.pool ?? lp.pool_address ?? ''
    const list = liveByPool.get(pool) ?? []
    list.push(lp)
    liveByPool.set(pool, list)
  }

  const result = new Map<TrackedPositionLike, LivePositionLike | undefined>()
  for (const p of tracked) {
    const posId = p.position ?? p.position_address ?? ''
    const pool = p.pool ?? p.pool_address ?? ''
    let match = live.find((lp) => (lp.position ?? lp.position_address) === posId)
    if (!match) {
      const poolMatches = liveByPool.get(pool) ?? []
      if (poolMatches.length === 1 && (trackedCountByPool.get(pool) ?? 0) === 1) {
        match = poolMatches[0]
      }
    }
    result.set(p, match)
  }
  return result
}

/** Build the wire-format position summary for one tracked position + its matched live data. */
export function buildPositionSummary(p: TrackedPositionLike, live: LivePositionLike | undefined): PositionSummaryLike {
  const posId = p.position ?? p.position_address ?? ''
  const pool = p.pool ?? p.pool_address ?? ''
  const pnl = Number(live?.pnl_usd ?? p.pnl_usd ?? 0)
  const pnlPct = Number(live?.pnl_pct ?? p.pnl_pct ?? p.peak_pnl_pct ?? 0)
  const tokenSymbol = String(live?.pair ?? p.pool_name ?? p.pair ?? p.tokenSymbol ?? (posId ? posId.slice(0, 8) : ''))
  const valueUsd = Number(live?.total_value_usd ?? live?.value_usd ?? p.initial_value_usd ?? 0)
  const unclaimedFeesUsd = Number(live?.unclaimed_fees_usd ?? p.unclaimed_fees_usd ?? 0)
  return {
    positionAddress: posId,
    poolAddress: pool,
    tokenSymbol,
    pnlUsd: Math.round(pnl * 100) / 100,
    pnlPct: Math.round(pnlPct * 100) / 100,
    valueUsd: Math.round(valueUsd * 100) / 100,
    unclaimedFeesUsd: Math.round(unclaimedFeesUsd * 100) / 100,
    deployedAt: p.deployed_at ? new Date(p.deployed_at).toISOString() : undefined,
    lowerBin: typeof live?.lower_bin === 'number' ? live.lower_bin : undefined,
    upperBin: typeof live?.upper_bin === 'number' ? live.upper_bin : undefined,
    activeBin: typeof live?.active_bin === 'number' ? live.active_bin : undefined,
    inRange: typeof live?.in_range === 'boolean' ? live.in_range : undefined,
    minutesOutOfRange: typeof live?.minutes_out_of_range === 'number' ? live.minutes_out_of_range : undefined,
  }
}

/** Coarse execution phase derived from the daemon's own busy flags — no log-text guessing. */
export function derivePhase(flags: {
  screeningBusy: boolean
  managementBusy: boolean
  busy: boolean
}): 'idle' | 'screening' | 'managing' | 'chat' {
  if (flags.screeningBusy) return 'screening'
  if (flags.managementBusy) return 'managing'
  if (flags.busy) return 'chat'
  return 'idle'
}
