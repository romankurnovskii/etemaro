import { describe, expect, it } from 'vitest'
import type { PerformanceRecord } from '../shared/types.js'
import { computeAgentPnlMetrics, resolveLiveUsd } from './pnlTracker.js'

describe('resolveLiveUsd', () => {
  it('prefers the true USD value', () => {
    expect(resolveLiveUsd(12.5, 0.08, true)).toBe(12.5)
    expect(resolveLiveUsd(12.5, 11, false)).toBe(12.5)
  })

  it('falls back to the plain field only outside solMode', () => {
    expect(resolveLiveUsd(undefined, 11, false)).toBe(11)
    expect(resolveLiveUsd(undefined, 0.08, true)).toBeNull()
    expect(resolveLiveUsd(null, null, false)).toBeNull()
  })
})

describe('computeAgentPnlMetrics', () => {
  const mockBaseRecord: PerformanceRecord = {
    position: 'pos-1',
    pool: 'pool-1',
    pool_name: 'FLAME-SOL',
    strategy: 'bid_ask',
    bin_range: 69,
    bin_step: 80,
    volatility: 8.5,
    fee_tvl_ratio: 0.8,
    organic_score: 75,
    amount_sol: 0.1,
    fees_earned_usd: 0.5,
    final_value_usd: 10.5,
    initial_value_usd: 10.0,
    minutes_in_range: 10,
    minutes_held: 15,
    close_reason: 'take profit',
    recorded_at: '2026-09-11T12:00:00.000Z',
    net_pnl_usd: 1.0,
  }

  it('calculates all-time and session realized PnL correctly', () => {
    const sessionStart = new Date('2026-09-11T11:00:00.000Z').getTime()
    const records: PerformanceRecord[] = [
      {
        ...mockBaseRecord,
        position: 'pos-old',
        recorded_at: '2026-09-10T10:00:00.000Z', // Before session
        net_pnl_usd: 2.5,
      },
      {
        ...mockBaseRecord,
        position: 'pos-session-1',
        recorded_at: '2026-09-11T12:00:00.000Z', // During session
        net_pnl_usd: 1.5,
      },
      {
        ...mockBaseRecord,
        position: 'pos-session-2',
        recorded_at: '2026-09-11T13:00:00.000Z', // During session
        net_pnl_usd: -0.5,
      },
    ]

    const live = [
      { pnl_usd: 0.35, unclaimed_fees_usd: 0.15 },
      { pnl_usd: -0.1, unclaimed_fees_usd: 0.05 },
    ]

    const metrics = computeAgentPnlMetrics({
      performanceRecords: records,
      sessionStartTime: sessionStart,
      livePositions: live,
    })

    expect(metrics.totalRealizedPnlUsd).toBe(3.5) // 2.5 + 1.5 - 0.5
    expect(metrics.sessionRealizedPnlUsd).toBe(1.0) // 1.5 - 0.5
    expect(metrics.openUnrealizedPnlUsd).toBe(0.25) // 0.35 - 0.10
    expect(metrics.openUnclaimedFeesUsd).toBe(0.2) // 0.15 + 0.05
    expect(metrics.closedWins).toBe(2)
    expect(metrics.closedLosses).toBe(1)
    expect(metrics.totalClosedCount).toBe(3)
  })

  it('handles empty records and 0 open positions', () => {
    const metrics = computeAgentPnlMetrics({
      performanceRecords: [],
      sessionStartTime: Date.now(),
      livePositions: [],
    })

    expect(metrics.totalRealizedPnlUsd).toBe(0)
    expect(metrics.sessionRealizedPnlUsd).toBe(0)
    expect(metrics.openUnrealizedPnlUsd).toBe(0)
    expect(metrics.openUnclaimedFeesUsd).toBe(0)
    expect(metrics.totalClosedCount).toBe(0)
  })

  it('uses *_true_usd for open positions in solMode (plain *_usd hold SOL)', () => {
    const live = [
      // pnl_usd / unclaimed_fees_usd are SOL amounts in solMode
      { pnl_usd: 0.02, unclaimed_fees_usd: 0.001, pnl_true_usd: 3.4, unclaimed_fees_true_usd: 0.17 },
      { pnl_usd: -0.01, unclaimed_fees_usd: 0.002, pnl_true_usd: -1.7, unclaimed_fees_true_usd: 0.34 },
    ]
    const metrics = computeAgentPnlMetrics({ livePositions: live, solMode: true })
    expect(metrics.openUnrealizedPnlUsd).toBe(1.7)
    expect(metrics.openUnclaimedFeesUsd).toBe(0.51)
  })

  it('never adds SOL-denominated values to USD totals in solMode', () => {
    const live = [
      { pnl_usd: 0.5, unclaimed_fees_usd: 0.1 }, // no true USD available
      { pnl_usd: 0.02, unclaimed_fees_usd: 0.001, pnl_true_usd: 2, unclaimed_fees_true_usd: 0.25 },
    ]
    const metrics = computeAgentPnlMetrics({ livePositions: live, solMode: true })
    expect(metrics.openUnrealizedPnlUsd).toBe(2)
    expect(metrics.openUnclaimedFeesUsd).toBe(0.25)
  })

  it('prefers *_true_usd outside solMode but falls back to plain *_usd', () => {
    const live = [{ pnl_usd: 1, unclaimed_fees_usd: 0.1, pnl_true_usd: 1.05 }]
    const metrics = computeAgentPnlMetrics({ livePositions: live })
    expect(metrics.openUnrealizedPnlUsd).toBe(1.05)
    expect(metrics.openUnclaimedFeesUsd).toBe(0.1)
  })

  it('filters out mock TEST-SOL records', () => {
    const records: PerformanceRecord[] = [
      {
        ...mockBaseRecord,
        pool_name: 'TEST-SOL',
        net_pnl_usd: 0,
      },
      {
        ...mockBaseRecord,
        pool_name: 'CTO-SOL',
        net_pnl_usd: 0.34,
      },
    ]

    const metrics = computeAgentPnlMetrics({
      performanceRecords: records,
      sessionStartTime: 0,
    })

    expect(metrics.totalRealizedPnlUsd).toBe(0.34)
    expect(metrics.totalClosedCount).toBe(1)
  })
})
