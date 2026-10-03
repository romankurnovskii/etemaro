/**
 * @file ipcStateHelpers.test.ts
 * @description Unit tests for the pure helpers behind Daemon.broadcastIpcState:
 * live-position matching (incl. the same-pool ambiguity guard), position summary
 * mapping, and busy-flag -> phase derivation.
 */

import { describe, expect, it } from 'vitest'
import { buildPositionSummary, derivePhase, matchLivePositions } from './ipcStateHelpers.js'

describe('matchLivePositions', () => {
  it('matches by exact position id', () => {
    const tracked = [{ position: 'posA', pool: 'poolA' }]
    const live = [{ position: 'posA', pool: 'poolA', pnl_usd: 12 }]
    const matched = matchLivePositions(tracked, live)
    expect(matched.get(tracked[0]!)?.pnl_usd).toBe(12)
  })

  it('falls back to a pool-only match when unambiguous on both sides', () => {
    const tracked = [{ position: 'posA', pool: 'poolA' }]
    // Live data keyed by position_address only, but a different field name — the
    // id lookup misses, so the pool-only fallback should kick in.
    const live = [{ position_address: 'stale-id', pool: 'poolA', pnl_usd: 7 }]
    const matched = matchLivePositions(tracked, live)
    expect(matched.get(tracked[0]!)?.pnl_usd).toBe(7)
  })

  it('does NOT fall back to pool matching when two tracked positions share a pool', () => {
    const posA = { position: 'posA', pool: 'poolShared' }
    const posB = { position: 'posB', pool: 'poolShared' }
    const tracked = [posA, posB]
    // Only one live entry for the shared pool, with a mismatched id.
    const live = [{ position: 'unrelated-id', pool: 'poolShared', pnl_usd: 99 }]
    const matched = matchLivePositions(tracked, live)
    expect(matched.get(posA)).toBeUndefined()
    expect(matched.get(posB)).toBeUndefined()
  })

  it('does NOT fall back to pool matching when two live entries share a pool', () => {
    const tracked = [{ position: 'posA', pool: 'poolShared' }]
    const live = [
      { position: 'other-1', pool: 'poolShared', pnl_usd: 1 },
      { position: 'other-2', pool: 'poolShared', pnl_usd: 2 },
    ]
    const matched = matchLivePositions(tracked, live)
    expect(matched.get(tracked[0]!)).toBeUndefined()
  })

  it('leaves a position unmatched when there is no live data at all', () => {
    const tracked = [{ position: 'posA', pool: 'poolA' }]
    const matched = matchLivePositions(tracked, [])
    expect(matched.get(tracked[0]!)).toBeUndefined()
  })
})

describe('buildPositionSummary', () => {
  it('prefers live data over tracked data and rounds to 2 decimals', () => {
    const p = { position: 'posA', pool: 'poolA', pnl_usd: 1, pnl_pct: 1 }
    const live = { pnl_usd: 12.3456, pnl_pct: 5.005, total_value_usd: 100.001 }
    const summary = buildPositionSummary(p, live)
    expect(summary.pnlUsd).toBe(12.35)
    expect(summary.pnlPct).toBe(5.01)
    expect(summary.valueUsd).toBe(100)
  })

  it('falls back to tracked data when there is no live match', () => {
    const p = { position: 'posA', pool: 'poolA', pnl_usd: 3, pnl_pct: 4, pool_name: 'SOL/USDC' }
    const summary = buildPositionSummary(p, undefined)
    expect(summary.pnlUsd).toBe(3)
    expect(summary.pnlPct).toBe(4)
    expect(summary.tokenSymbol).toBe('SOL/USDC')
    expect(summary.lowerBin).toBeUndefined()
    expect(summary.inRange).toBeUndefined()
  })

  it('passes bin/range fields through only when they are the right type', () => {
    const p = { position: 'posA', pool: 'poolA' }
    const live = { lower_bin: 10, upper_bin: 20, active_bin: 15, in_range: true, minutes_out_of_range: 0 }
    const summary = buildPositionSummary(p, live)
    expect(summary.lowerBin).toBe(10)
    expect(summary.upperBin).toBe(20)
    expect(summary.activeBin).toBe(15)
    expect(summary.inRange).toBe(true)
    expect(summary.minutesOutOfRange).toBe(0)
  })

  it('omits bin fields rather than fabricating them when live data has nulls', () => {
    const p = { position: 'posA', pool: 'poolA' }
    const live = { lower_bin: null, upper_bin: null, active_bin: null, in_range: null, minutes_out_of_range: null }
    const summary = buildPositionSummary(p, live)
    expect(summary.lowerBin).toBeUndefined()
    expect(summary.upperBin).toBeUndefined()
    expect(summary.activeBin).toBeUndefined()
    expect(summary.inRange).toBeUndefined()
    expect(summary.minutesOutOfRange).toBeUndefined()
  })

  it('falls back to the first 8 chars of the position id when no symbol is known', () => {
    const p = { position: 'abcdefghijklmnop', pool: 'poolA' }
    const summary = buildPositionSummary(p, undefined)
    expect(summary.tokenSymbol).toBe('abcdefgh')
  })
})

describe('derivePhase', () => {
  it('reports idle when nothing is busy', () => {
    expect(derivePhase({ screeningBusy: false, managementBusy: false, busy: false })).toBe('idle')
  })

  it('prioritizes screening over managing and chat', () => {
    expect(derivePhase({ screeningBusy: true, managementBusy: true, busy: true })).toBe('screening')
  })

  it('prioritizes managing over chat', () => {
    expect(derivePhase({ screeningBusy: false, managementBusy: true, busy: true })).toBe('managing')
  })

  it('reports chat when only the REPL/chat busy flag is set', () => {
    expect(derivePhase({ screeningBusy: false, managementBusy: false, busy: true })).toBe('chat')
  })
})
