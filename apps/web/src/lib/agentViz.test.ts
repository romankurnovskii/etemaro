import { describe, expect, it } from 'vitest'
import {
  decisionLabel,
  deriveLoopStage,
  formatMetrics,
  isLoopActive,
  logSeverity,
  relativeTime,
  shortenAddress,
} from './agentViz'
import type { Decision, LogEntry } from './ipc'

function log(category: string, overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    category,
    message: category,
    agentId: 'agent-1',
    ts: '2026-10-12T10:00:00.000Z',
    ...overrides,
  }
}

function decision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: 'dec_1',
    ts: '2026-10-12T10:00:00.000Z',
    type: 'deploy',
    actor: 'SCREENER',
    pool: null,
    pool_name: null,
    position: null,
    summary: null,
    reason: null,
    risks: [],
    metrics: {},
    rejected: [],
    ...overrides,
  }
}

describe('deriveLoopStage', () => {
  it('is Idle with no logs', () => {
    expect(deriveLoopStage([])).toBe('Idle')
  })

  it('is Settled after a completed loop iteration', () => {
    expect(deriveLoopStage([log('agent_loop_start'), log('tool_start'), log('agent_loop_end')])).toBe('Settled')
  })

  it('is Evaluating right after a loop start', () => {
    expect(deriveLoopStage([log('agent_loop_end'), log('agent_loop_start')])).toBe('Evaluating')
  })

  it('is Evaluating after a settled iteration starts again', () => {
    expect(
      deriveLoopStage([log('agent_loop_start'), log('tool_start'), log('agent_loop_end'), log('agent_loop_start')]),
    ).toBe('Evaluating')
  })

  it('is Rebalancing while a tool call is in flight', () => {
    expect(deriveLoopStage([log('agent_loop_start'), log('tool_start')])).toBe('Rebalancing')
  })

  it('is Rebalancing after a tool finishes, before the loop closes', () => {
    expect(deriveLoopStage([log('agent_loop_start'), log('tool_start'), log('tool_finish')])).toBe('Rebalancing')
  })

  it('treats a blocked tool as an action still in progress', () => {
    expect(deriveLoopStage([log('agent_loop_start'), log('tool_blocked')])).toBe('Rebalancing')
  })

  it('parks the agent in Idle on a loop error', () => {
    expect(deriveLoopStage([log('agent_loop_start'), log('tool_start'), log('agent_loop_error')])).toBe('Idle')
  })

  it('ignores unrelated trailing categories', () => {
    expect(deriveLoopStage([log('agent_loop_start'), log('sweeper_tick')])).toBe('Evaluating')
  })
})

describe('isLoopActive', () => {
  it('is false with no logs', () => {
    expect(isLoopActive([])).toBe(false)
  })

  it('is true while a loop iteration is open', () => {
    expect(isLoopActive([log('agent_loop_start')])).toBe(true)
  })

  it('is false once the iteration closes', () => {
    expect(isLoopActive([log('agent_loop_start'), log('agent_loop_end')])).toBe(false)
  })
})

describe('logSeverity', () => {
  it('classifies loop errors and blocked tools as errors', () => {
    expect(logSeverity(log('agent_loop_error'))).toBe('error')
    expect(logSeverity(log('tool_blocked'))).toBe('error')
  })

  it('classifies hallucination rejections as warnings', () => {
    expect(logSeverity(log('anti_hallucination_reject'))).toBe('warn')
  })

  it('defaults to info', () => {
    expect(logSeverity(log('agent_loop_start'))).toBe('info')
  })
})

describe('shortenAddress', () => {
  it('shortens long keys', () => {
    expect(shortenAddress('AbCdEfGhIjKlMnOp')).toBe('AbCd…MnOp')
  })

  it('leaves short values untouched', () => {
    expect(shortenAddress('Ab12')).toBe('Ab12')
  })

  it('renders a dash for missing values', () => {
    expect(shortenAddress(null)).toBe('—')
    expect(shortenAddress(undefined)).toBe('—')
    expect(shortenAddress('')).toBe('—')
  })
})

describe('decisionLabel', () => {
  it('includes actor, type and pool', () => {
    expect(decisionLabel(decision({ pool_name: 'SOL-USDC' }))).toBe('[SCREENER] DEPLOY SOL-USDC')
  })

  it('falls back to the raw pool address', () => {
    expect(decisionLabel(decision({ pool: 'AbCdEfGhIjKlMnOp' }))).toBe('[SCREENER] DEPLOY AbCd…MnOp')
  })

  it('handles an unknown pool', () => {
    expect(decisionLabel(decision())).toBe('[SCREENER] DEPLOY unknown pool')
  })
})

describe('relativeTime', () => {
  const now = Date.parse('2026-10-12T12:00:00.000Z')

  it('renders a dash for missing timestamps', () => {
    expect(relativeTime(null, now)).toBe('—')
    expect(relativeTime('not-a-date', now)).toBe('—')
  })

  it('renders recent instants', () => {
    expect(relativeTime('2026-10-12T11:59:50.000Z', now)).toBe('just now')
  })

  it('renders minutes', () => {
    expect(relativeTime('2026-10-12T11:45:00.000Z', now)).toBe('15m ago')
  })

  it('renders hours', () => {
    expect(relativeTime('2026-10-12T09:00:00.000Z', now)).toBe('3h ago')
  })

  it('renders days', () => {
    expect(relativeTime('2026-10-09T12:00:00.000Z', now)).toBe('3d ago')
  })
})

describe('formatMetrics', () => {
  it('renders primitives only', () => {
    expect(formatMetrics({ binId: 12, label: 'spot', nested: { a: 1 }, flag: true })).toEqual([
      'binId=12',
      'label=spot',
      'flag=true',
    ])
  })

  it('returns nothing for empty or invalid input', () => {
    expect(formatMetrics(undefined)).toEqual([])
    expect(formatMetrics({})).toEqual([])
  })
})
