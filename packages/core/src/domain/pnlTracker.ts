/**
 * @file pnlTracker.ts
 * @description Decoupled PnL aggregator and metrics engine for agent performance.
 * Computes:
 * - All-time cumulative realized PnL from closed performance records
 * - Session realized PnL since daemon boot
 * - Open position floating unrealized PnL and claimable fees
 */

import type { PerformanceRecord } from '../shared/types.js'

export interface AgentPnlMetrics {
  /** Cumulative all-time realized PnL in USD across all completed closed positions. */
  totalRealizedPnlUsd: number
  /** Realized PnL in USD from positions closed during the current session. */
  sessionRealizedPnlUsd: number
  /** Floating unrealized PnL in USD across currently open positions. */
  openUnrealizedPnlUsd: number
  /** Total unclaimed trading fees in USD across currently open positions. */
  openUnclaimedFeesUsd: number
  /** Count of closed winning positions. */
  closedWins: number
  /** Count of closed losing positions. */
  closedLosses: number
  /** Total closed positions count. */
  totalClosedCount: number
}

export interface LivePositionSummaryLike {
  pnl_usd?: number | null
  unclaimed_fees_usd?: number | null
  total_value_usd?: number | null
}

export function computeAgentPnlMetrics(params: {
  performanceRecords?: PerformanceRecord[]
  sessionStartTime?: number
  livePositions?: LivePositionSummaryLike[]
}): AgentPnlMetrics {
  const records = params.performanceRecords || []
  const sessionStartTime = params.sessionStartTime ?? 0
  const live = params.livePositions || []

  // Filter out any mock/placeholder test records
  const closedRecords = records.filter((r) => r.pool_name !== 'TEST-SOL')

  let totalRealized = 0
  let sessionRealized = 0
  let wins = 0
  let losses = 0

  for (const r of closedRecords) {
    const pnl = Number(r.net_pnl_usd ?? r.pnl_usd ?? 0)
    if (!Number.isFinite(pnl)) continue

    totalRealized += pnl

    if (pnl > 0) wins++
    else if (pnl < 0) losses++

    const recordedAtMs = r.recorded_at ? new Date(r.recorded_at).getTime() : 0
    if (sessionStartTime > 0 && recordedAtMs >= sessionStartTime) {
      sessionRealized += pnl
    }
  }

  let openUnrealized = 0
  let openUnclaimedFees = 0

  for (const lp of live) {
    const pnl = Number(lp.pnl_usd ?? 0)
    if (Number.isFinite(pnl)) {
      openUnrealized += pnl
    }
    const fees = Number(lp.unclaimed_fees_usd ?? 0)
    if (Number.isFinite(fees)) {
      openUnclaimedFees += fees
    }
  }

  return {
    totalRealizedPnlUsd: Math.round(totalRealized * 100) / 100,
    sessionRealizedPnlUsd: Math.round(sessionRealized * 100) / 100,
    openUnrealizedPnlUsd: Math.round(openUnrealized * 100) / 100,
    openUnclaimedFeesUsd: Math.round(openUnclaimedFees * 100) / 100,
    closedWins: wins,
    closedLosses: losses,
    totalClosedCount: closedRecords.length,
  }
}
