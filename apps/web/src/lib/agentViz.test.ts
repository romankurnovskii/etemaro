/**
 * Unit tests for apps/web/src/lib/agentViz.ts
 *
 * Constraints:
 * - Pure logic only, no testing-library, no DOM
 * - Every test can fail and documents the bug it catches
 */
import { describe, expect, it } from 'vitest'
import {
  buildBinSegments,
  deriveExecSummary,
  derivePhase,
  deriveStatus,
  fmtUptime,
  logSeverity,
  strategyDiff,
} from './agentViz'
import type { LogEntry, PositionSummary, StateSnapshot } from './ipc'

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeLog(category: string, message = 'msg', metadata?: Record<string, unknown>): LogEntry {
  return { category, message, agentId: 'a1', ts: new Date().toISOString(), metadata }
}

function makeSnap(overrides: Partial<StateSnapshot> = {}): StateSnapshot {
  return { positions: [], totalPnlUsd: 0, busy: false, ...overrides }
}

// ─── logSeverity ─────────────────────────────────────────────────────────────
describe('logSeverity', () => {
  it('maps *_error category → error', () => {
    expect(logSeverity(makeLog('screening_error'))).toBe('error')
  })
  it('maps *_warn category → warn', () => {
    expect(logSeverity(makeLog('ipc_warn'))).toBe('warn')
  })
  it('maps any other category → info', () => {
    expect(logSeverity(makeLog('state'))).toBe('info')
  })
  it('maps bare "error" category → error (regression: daemon error log)', () => {
    expect(logSeverity(makeLog('error'))).toBe('error')
  })
})

// ─── derivePhase ─────────────────────────────────────────────────────────────
describe('derivePhase — daemon field (authoritative)', () => {
  it('screening → evaluating, source daemon', () => {
    const { phase, source } = derivePhase([], makeSnap({ phase: 'screening' }))
    expect(phase).toBe('evaluating')
    expect(source).toBe('daemon')
  })
  it('managing → evaluating, source daemon', () => {
    const { phase } = derivePhase([], makeSnap({ phase: 'managing' }))
    expect(phase).toBe('evaluating')
  })
  it('chat → idle, source daemon', () => {
    const { phase } = derivePhase([], makeSnap({ phase: 'chat' }))
    expect(phase).toBe('idle')
  })
  it('idle with no open write tool → idle', () => {
    const { phase } = derivePhase([], makeSnap({ phase: 'idle' }))
    expect(phase).toBe('idle')
  })
})

describe('derivePhase — write-tool pairing (rebalancing)', () => {
  it('open tool_start for deploy_position → rebalancing', () => {
    const logs = [makeLog('state', 'start', { event: 'tool_start', tool: 'deploy_position', correlationId: 'c1' })]
    const { phase } = derivePhase(logs, null)
    expect(phase).toBe('rebalancing')
  })
  it('matching tool_finish within 2 min → settled (last write just completed)', () => {
    const logs = [
      makeLog('state', 'start', { event: 'tool_start', tool: 'close_position', correlationId: 'c2' }),
      makeLog('state', 'finish', { event: 'tool_finish', tool: 'close_position', correlationId: 'c2' }),
    ]
    const { phase } = derivePhase(logs, null)
    // A just-completed write tool → settled (within 2 min window)
    expect(phase).toBe('settled')
  })
})

describe('derivePhase — heuristic fallback (no daemon phase field)', () => {
  it('screen category in recent logs → evaluating (inferred)', () => {
    const logs = [makeLog('screening')]
    const { phase, source } = derivePhase(logs, makeSnap({ phase: undefined }))
    // Heuristic fires only when daemon phase absent
    // If phase is absent from snapshot, source is inferred
    expect(source).toBe('inferred')
    // Category "screening" matches /screen/ heuristic
    expect(phase).toBe('evaluating')
  })
  it('no relevant logs, no daemon phase → idle (inferred)', () => {
    const { phase, source } = derivePhase([makeLog('state')], null)
    expect(phase).toBe('idle')
    expect(source).toBe('inferred')
  })
})

// ─── deriveStatus ────────────────────────────────────────────────────────────
describe('deriveStatus', () => {
  it('not running → stopped regardless of logs', () => {
    expect(deriveStatus(false, [makeLog('state')], makeSnap())).toBe('stopped')
  })
  it('running + error log → error', () => {
    expect(deriveStatus(true, [makeLog('cron_error')], null)).toBe('error')
  })
  it('running + daemon phase=screening → running', () => {
    expect(deriveStatus(true, [], makeSnap({ phase: 'screening' }))).toBe('running')
  })
  it('running + recent logs → running', () => {
    expect(deriveStatus(true, [makeLog('state')], null)).toBe('running')
  })
  it('running + no logs + no snapshot → idle', () => {
    expect(deriveStatus(true, [], null)).toBe('idle')
  })
})

// ─── fmtUptime ───────────────────────────────────────────────────────────────
describe('fmtUptime', () => {
  it('null → —', () => {
    expect(fmtUptime(null, Date.now())).toBe('—')
  })
  it('shows seconds for < 1 min', () => {
    const start = new Date(Date.now() - 30000).toISOString()
    expect(fmtUptime(start, Date.now())).toBe('30s')
  })
  it('shows minutes for 1–60 min', () => {
    const start = new Date(Date.now() - 90000).toISOString()
    expect(fmtUptime(start, Date.now())).toBe('1m 30s')
  })
  it('shows hours for > 60 min', () => {
    const start = new Date(Date.now() - 3900000).toISOString() // 65 min
    expect(fmtUptime(start, Date.now())).toBe('1h 5m')
  })
})

// ─── strategyDiff ────────────────────────────────────────────────────────────
describe('strategyDiff', () => {
  it('identical objects → no rows', () => {
    expect(strategyDiff({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toHaveLength(0)
  })
  it('changed field → changed row', () => {
    const rows = strategyDiff({ a: 1 }, { a: 2 })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ key: 'a', kind: 'changed', from: '1', to: '2' })
  })
  it('added field → added row', () => {
    const rows = strategyDiff({}, { b: 'new' })
    expect(rows[0]).toMatchObject({ key: 'b', kind: 'added', from: '', to: '"new"' })
  })
  it('removed field → removed row', () => {
    const rows = strategyDiff({ c: true }, {})
    expect(rows[0]).toMatchObject({ key: 'c', kind: 'removed', to: '' })
  })
  it('ignores volatile timestamp fields', () => {
    const rows = strategyDiff({ addedAt: 'old', updatedAt: 'old' }, { addedAt: 'new', updatedAt: 'new' })
    expect(rows).toHaveLength(0)
  })
  it('null inputs → empty array', () => {
    expect(strategyDiff(null, { a: 1 })).toHaveLength(0)
    expect(strategyDiff({ a: 1 }, null)).toHaveLength(0)
  })
  it('nested object: sub-fields appear as dot-notation keys', () => {
    const rows = strategyDiff(
      { range: { min: 1, max: 10 } },
      { range: { min: 1, max: 20 } },
    )
    // Only range.max changed — range.min is unchanged and should not appear
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ key: 'range.max', kind: 'changed', from: '10', to: '20' })
  })
  it('nested object: unchanged sub-fields produce no rows', () => {
    const rows = strategyDiff(
      { range: { min: 1, max: 10 }, slippage: 0.5 },
      { range: { min: 1, max: 10 }, slippage: 0.5 },
    )
    expect(rows).toHaveLength(0)
  })
  it('nested object: newly added sub-field shows as added row', () => {
    const rows = strategyDiff(
      { range: { min: 1 } },
      { range: { min: 1, max: 10 } },
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ key: 'range.max', kind: 'added' })
  })
})

// ─── buildBinSegments ────────────────────────────────────────────────────────
describe('buildBinSegments', () => {
  const base: PositionSummary = {
    positionAddress: 'p1',
    poolAddress: 'pool1',
    lowerBin: 100,
    upperBin: 109,
    activeBin: 105,
    inRange: true,
  }

  it('returns null when lowerBin missing', () => {
    expect(buildBinSegments({ ...base, lowerBin: undefined })).toBeNull()
  })
  it('returns null when upperBin missing', () => {
    expect(buildBinSegments({ ...base, upperBin: undefined })).toBeNull()
  })
  it('returns null when activeBin missing', () => {
    expect(buildBinSegments({ ...base, activeBin: undefined })).toBeNull()
  })
  it('returns non-empty array for valid data', () => {
    const segs = buildBinSegments(base)
    expect(segs).not.toBeNull()
    expect(segs?.length).toBeGreaterThan(0)
  })
  it('active-in segment present when inRange=true', () => {
    const segs = buildBinSegments(base)
    expect(segs).not.toBeNull()
    expect(segs?.some((s) => s.kind === 'active-in')).toBe(true)
    expect(segs?.some((s) => s.kind === 'active-out')).toBe(false)
  })
  it('active-out segment present when inRange=false', () => {
    const segs = buildBinSegments({ ...base, inRange: false })
    expect(segs).not.toBeNull()
    expect(segs?.some((s) => s.kind === 'active-out')).toBe(true)
    expect(segs?.some((s) => s.kind === 'active-in')).toBe(false)
  })
  it('handles reversed bins (upperBin < lowerBin) without error', () => {
    const segs = buildBinSegments({ ...base, lowerBin: 109, upperBin: 100 })
    expect(segs).not.toBeNull()
  })
  it('returns null for span > 200 (bogus data guard)', () => {
    expect(buildBinSegments({ ...base, lowerBin: 0, upperBin: 300 })).toBeNull()
  })
})

// ─── deriveExecSummary ───────────────────────────────────────────────────────
describe('deriveExecSummary', () => {
  it('returns nulls for empty logs', () => {
    const s = deriveExecSummary([])
    expect(s.lastTool).toBeNull()
    expect(s.lastDecision).toBeNull()
    expect(s.confidence).toBeNull()
  })
  it('picks up last tool_start', () => {
    const logs = [makeLog('state', 'm', { event: 'tool_start', tool: 'deploy_position', args: { pool: 'x' } })]
    const s = deriveExecSummary(logs)
    expect(s.lastTool).toBe('deploy_position')
  })
  it('picks up confidence when present', () => {
    const logs = [makeLog('state', 'm', { event: 'agent_reply', text: 'do it', confidence: 0.9 })]
    const s = deriveExecSummary(logs)
    expect(s.confidence).toBeCloseTo(0.9, 6)
    // 6 decimal places: confidence is read directly from metadata, no floating-point accumulation
  })
})
