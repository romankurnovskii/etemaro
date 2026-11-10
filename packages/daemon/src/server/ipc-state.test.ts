import { describe, expect, it } from 'vitest'
import { findLivePosition, toDecisionSummary, toIpcPositionSummary, toUptime } from './ipc-state.js'

const tracked = {
  position: 'POS_A',
  pool: 'POOL_1',
  pool_name: 'SOL-USDC',
  initial_value_usd: 100,
  deployed_at: '2026-11-10T08:00:00.000Z',
  bin_range: { min: 10, max: 30, active: 20 },
}

const live = {
  position: 'POS_A',
  pool: 'POOL_1',
  pair: 'SOL/USDC',
  lower_bin: 12,
  upper_bin: 34,
  active_bin: 40,
  in_range: false,
  minutes_out_of_range: 7,
  x_share_pct: 62.5,
  total_value_usd: 0.9, // SOL amount when solMode is on
  total_value_true_usd: 180.25,
  pnl_usd: 0.01,
  pnl_true_usd: 2.5,
  pnl_pct: 1.4,
  unclaimed_fees_usd: 0.001,
  unclaimed_fees_true_usd: 0.33,
}

describe('toIpcPositionSummary', () => {
  it('maps bins, range status and asset split from the exact live position', () => {
    const s = toIpcPositionSummary(tracked, live)
    expect(s.priceRangeBins).toEqual({ lower: 12, upper: 34, active: 40 })
    expect(s.inRangeStatus).toEqual({ inRange: false, minutesOutOfRange: 7 })
    expect(s.assetSplit).toEqual({ tokenXPct: 62.5, tokenYPct: 37.5 })
  })

  it('prefers *_true_usd money fields (plain *_usd hold SOL in solMode)', () => {
    const s = toIpcPositionSummary(tracked, live)
    expect(s.valueUsd).toBe(180.25)
    expect(s.pnlUsd).toBe(2.5)
    expect(s.unclaimedFeesUsd).toBe(0.33)
    expect(s.tokenSymbol).toBe('SOL/USDC')
  })

  it('falls back to tracked bin_range and null status/split without live data', () => {
    const s = toIpcPositionSummary(tracked, undefined)
    expect(s.priceRangeBins).toEqual({ lower: 10, upper: 30, active: 20 })
    expect(s.inRangeStatus).toBeNull()
    expect(s.assetSplit).toBeNull()
    expect(s.valueUsd).toBe(100)
    expect(s.deployedAt).toBe('2026-11-10T08:00:00.000Z')
  })

  it('never borrows range data from a different position in the same pool', () => {
    const sibling = { ...live, position: 'POS_B' }
    const s = toIpcPositionSummary(tracked, sibling)
    expect(s.priceRangeBins).toEqual({ lower: 10, upper: 30, active: 20 })
    expect(s.inRangeStatus).toBeNull()
    expect(s.assetSplit).toBeNull()
  })

  it('returns null bins when neither source has a range', () => {
    const s = toIpcPositionSummary({ position: 'POS_C', pool: 'POOL_9' }, undefined)
    expect(s.priceRangeBins).toBeNull()
  })

  it('drops an out-of-bounds split value', () => {
    const s = toIpcPositionSummary(tracked, { ...live, x_share_pct: 140 })
    expect(s.assetSplit).toBeNull()
  })
})

describe('findLivePosition', () => {
  it('prefers an exact address match over a same-pool sibling', () => {
    const sibling = { ...live, position: 'POS_B' }
    expect(findLivePosition(tracked, [sibling, live])).toBe(live)
  })

  it('falls back to a same-pool entry', () => {
    const sibling = { ...live, position: 'POS_B' }
    expect(findLivePosition(tracked, [sibling])).toBe(sibling)
  })
})

describe('toDecisionSummary', () => {
  it('trims a decision to the wire shape', () => {
    const d = toDecisionSummary({
      ts: '2026-11-10T09:00:00.000Z',
      type: 'deploy',
      actor: 'SCREENER',
      pool: 'POOL_1',
      pool_name: 'SOL-USDC',
      summary: 'x'.repeat(400),
      reason: 'long free text',
      metrics: { a: 1 },
    })
    expect(d).toEqual({
      ts: '2026-11-10T09:00:00.000Z',
      type: 'deploy',
      actor: 'SCREENER',
      poolName: 'SOL-USDC',
      summary: 'x'.repeat(280),
    })
  })

  it('returns null for a missing decision', () => {
    expect(toDecisionSummary(undefined)).toBeNull()
    expect(toDecisionSummary({})).toBeNull()
  })
})

describe('toUptime', () => {
  it('reports whole seconds since start', () => {
    const start = Date.parse('2026-11-10T08:00:00.000Z')
    expect(toUptime(start, start + 90_500)).toEqual({ startedAt: '2026-11-10T08:00:00.000Z', seconds: 90 })
  })

  it('never goes negative', () => {
    expect(toUptime(1000, 0).seconds).toBe(0)
  })
})
