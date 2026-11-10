/**
 * Pure mappers from daemon/core state to the IPC state-snapshot shapes.
 * Kept out of Daemon.ts so the mapping can be unit-tested without the daemon.
 */
import { type IpcDecisionSummary, type IpcPositionSummary, type IpcUptime, resolveLiveUsd } from '@etemaro/core'

// biome-ignore lint/suspicious/noExplicitAny: tracked/live position records are untyped JSON state
type Loose = Record<string, any>

const round2 = (n: number) => Math.round(n * 100) / 100
const round2OrUndefined = (n: number | null) => (n == null ? undefined : round2(n))

function finite(value: unknown): number | null {
  const n = typeof value === 'number' ? value : value == null ? Number.NaN : Number(value)
  return Number.isFinite(n) ? n : null
}

function positionId(p: Loose): string {
  return p.position ?? p.position_address ?? ''
}

/**
 * Builds the IPC summary for one tracked position.
 *
 * `live` is the matching entry from `getMyPositions()` (the BuiltPosition shape).
 * Money fields resolve real USD via `resolveLiveUsd`, the same rule as the
 * snapshot totals in `computeAgentPnlMetrics`: in `management.solMode` the plain
 * `*_usd` fields hold SOL, so only `*_true_usd` is used there and a value with
 * no USD figure is omitted rather than shown as dollars.
 * Range / split data is only taken from a live entry whose position address
 * matches exactly, so one position never shows another position's bins.
 */
export function toIpcPositionSummary(tracked: Loose, live: Loose | undefined, solMode = false): IpcPositionSummary {
  const id = positionId(tracked)
  const exact = live && positionId(live) === id ? live : undefined

  const pnl = resolveLiveUsd(live?.pnl_true_usd, live?.pnl_usd ?? tracked.pnl_usd ?? 0, solMode)
  const pnlPct = finite(live?.pnl_pct) ?? finite(tracked.pnl_pct) ?? finite(tracked.peak_pnl_pct) ?? 0
  const valueUsd =
    resolveLiveUsd(live?.total_value_true_usd, live?.total_value_usd ?? live?.value_usd, solMode) ??
    finite(tracked.initial_value_usd) ??
    (solMode ? null : 0)
  const feesUsd = resolveLiveUsd(
    live?.unclaimed_fees_true_usd,
    live?.unclaimed_fees_usd ?? tracked.unclaimed_fees_usd ?? 0,
    solMode,
  )
  const tokenSymbol =
    live?.pair ?? tracked.pool_name ?? tracked.pair ?? tracked.tokenSymbol ?? (id ? id.slice(0, 8) : '')

  const lower = finite(exact?.lower_bin) ?? finite(tracked.bin_range?.min)
  const upper = finite(exact?.upper_bin) ?? finite(tracked.bin_range?.max)
  const active = finite(exact?.active_bin) ?? finite(tracked.bin_range?.active)

  const xShare = finite(exact?.x_share_pct)

  return {
    positionAddress: id,
    poolAddress: tracked.pool ?? tracked.pool_address ?? '',
    tokenSymbol,
    pnlUsd: round2OrUndefined(pnl),
    pnlPct: round2(pnlPct),
    valueUsd: round2OrUndefined(valueUsd),
    unclaimedFeesUsd: round2OrUndefined(feesUsd),
    deployedAt: tracked.deployed_at ? new Date(tracked.deployed_at).toISOString() : undefined,
    priceRangeBins: lower != null && upper != null ? { lower, upper, active } : null,
    inRangeStatus:
      typeof exact?.in_range === 'boolean'
        ? { inRange: exact.in_range, minutesOutOfRange: Math.max(0, finite(exact.minutes_out_of_range) ?? 0) }
        : null,
    assetSplit:
      xShare != null && xShare >= 0 && xShare <= 100
        ? { tokenXPct: xShare, tokenYPct: Math.round((100 - xShare) * 10) / 10 }
        : null,
  }
}

/** Finds the live entry for a tracked position: exact address first, then same pool. */
export function findLivePosition(tracked: Loose, livePositions: Loose[]): Loose | undefined {
  const id = positionId(tracked)
  return (
    livePositions.find((lp) => positionId(lp) === id) ??
    livePositions.find((lp) => lp.pool != null && lp.pool === (tracked.pool ?? tracked.pool_address))
  )
}

/** Trims a decision-log entry for the wire: no 2 KB reason, no raw metrics. */
export function toDecisionSummary(decision: Loose | undefined | null): IpcDecisionSummary | null {
  if (!decision?.ts) return null
  const summary = typeof decision.summary === 'string' ? decision.summary.slice(0, 280) : null
  return {
    ts: String(decision.ts),
    type: String(decision.type ?? 'note'),
    actor: String(decision.actor ?? 'GENERAL'),
    poolName: decision.pool_name ?? decision.pool ?? null,
    summary,
  }
}

export function toUptime(startedAtMs: number, nowMs: number): IpcUptime {
  return {
    startedAt: new Date(startedAtMs).toISOString(),
    seconds: Math.max(0, Math.floor((nowMs - startedAtMs) / 1000)),
  }
}
