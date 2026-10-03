import { describe, expect, it } from 'vitest'
import { deriveStatus, inferPhase, lastDecision, lastTool } from './agentActivity'
import type { StateSnapshot } from './ipc'
import type { LogRecord } from './logs'

const WRITE_TOOLS = new Set(['deploy_position', 'close_position'])

let seq = 0
const rec = (category: string, message: string, metadata?: Record<string, unknown>): LogRecord => ({
  seq: seq++,
  entry: {
    agentId: 'a',
    category,
    message,
    ts: `2026-10-03T12:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    metadata,
  },
})

const snapshot = (busy: boolean): StateSnapshot => ({ positions: [], totalPnlUsd: 0, busy })

describe('inferPhase', () => {
  it('is null (and still marked inferred) without signals', () => {
    const result = inferPhase([rec('startup', 'IPC server listening')], WRITE_TOOLS)
    expect(result.phase).toBeNull()
    expect(result.inferred).toBe(true)
  })

  it('evaluating on cycle start and read-only tools', () => {
    expect(inferPhase([rec('cron', 'Starting screening cycle [model: x]')], WRITE_TOOLS).phase).toBe('evaluating')
    expect(inferPhase([rec('cron', 'Starting management cycle')], WRITE_TOOLS).phase).toBe('evaluating')
    expect(inferPhase([rec('agent_loop_start', 'Agent loop started')], WRITE_TOOLS).phase).toBe('evaluating')
    expect(
      inferPhase([rec('tool_start', 'Tool executing: get_top_pools', { tool: 'get_top_pools' })], WRITE_TOOLS).phase,
    ).toBe('evaluating')
  })

  it('rebalancing on write tools and deploy/close activity', () => {
    expect(
      inferPhase([rec('tool_start', 'Tool executing: deploy_position', { tool: 'deploy_position' })], WRITE_TOOLS)
        .phase,
    ).toBe('rebalancing')
    expect(inferPhase([rec('tool_start', 'Tool executing: close_position')], WRITE_TOOLS).phase).toBe('rebalancing')
    expect(inferPhase([rec('deploy', 'Pool: abc')], WRITE_TOOLS).phase).toBe('rebalancing')
    expect(inferPhase([rec('tx_state', 'confirmed')], WRITE_TOOLS).phase).toBe('rebalancing')
  })

  it('settled on loop end, successful deploy/close, or STAY verdict', () => {
    expect(inferPhase([rec('agent_loop_end', 'done')], WRITE_TOOLS).phase).toBe('settled')
    expect(inferPhase([rec('deploy', 'SUCCESS — 2 tx(s): x')], WRITE_TOOLS).phase).toBe('settled')
    expect(inferPhase([rec('close', 'SUCCESS txs: y')], WRITE_TOOLS).phase).toBe('settled')
    expect(inferPhase([rec('cron', 'Management: all positions STAY — skipping')], WRITE_TOOLS).phase).toBe('settled')
  })

  it('uses the newest signal and ignores non-signal noise after it', () => {
    const logs = [
      rec('cron', 'Starting management cycle'),
      rec('tool_start', 'Tool executing: deploy_position', { tool: 'deploy_position' }),
      rec('agent_loop_end', 'done'),
      rec('pnl_tick', 'tick'),
    ]
    const result = inferPhase(logs, WRITE_TOOLS)
    expect(result.phase).toBe('settled')
    expect(result.basis?.category).toBe('agent_loop_end')
  })
})

describe('deriveStatus', () => {
  const base = { running: true, hasTelemetry: true, snapshot: null, logs: [] as LogRecord[], writeTools: WRITE_TOOLS }

  it('stopped when the process is not running, regardless of logs', () => {
    expect(deriveStatus({ ...base, running: false, logs: [rec('error', 'boom')] })).toBe('stopped')
  })

  it('running (not idle) when telemetry is not connected yet', () => {
    expect(deriveStatus({ ...base, hasTelemetry: false })).toBe('running')
  })

  it('error when an error is newer than the last phase signal', () => {
    expect(deriveStatus({ ...base, logs: [rec('cron', 'Starting management cycle'), rec('cron_error', 'x')] })).toBe(
      'error',
    )
  })

  it('recovers from error once a new phase signal arrives', () => {
    const logs = [rec('cron_error', 'x'), rec('cron', 'Starting screening cycle')]
    expect(deriveStatus({ ...base, logs })).toBe('running')
  })

  it('an error in another agent never affects this agent (attribution is upstream, per agent)', () => {
    const own = [rec('agent_loop_end', 'done')]
    expect(deriveStatus({ ...base, logs: own })).toBe('idle')
  })

  it('running when the snapshot is busy or the phase is active; idle otherwise', () => {
    expect(deriveStatus({ ...base, snapshot: snapshot(true) })).toBe('running')
    expect(deriveStatus({ ...base, logs: [rec('agent_loop_start', 'go')] })).toBe('running')
    expect(deriveStatus({ ...base, snapshot: snapshot(false), logs: [rec('agent_loop_end', 'done')] })).toBe('idle')
  })
})

describe('lastTool / lastDecision', () => {
  it('returns the newest tool_start name', () => {
    const logs = [
      rec('tool_start', 'Tool executing: get_top_pools', { tool: 'get_top_pools' }),
      rec('tool_finish', 'Tool completed: get_top_pools (5ms)', { tool: 'get_top_pools' }),
      rec('tool_start', 'Tool executing: deploy_position'),
    ]
    expect(lastTool(logs)?.name).toBe('deploy_position')
    expect(lastTool([rec('cron', 'x')])).toBeNull()
  })

  it('returns the final answer following "Final answer reached"', () => {
    const logs = [
      rec('agent', 'Step 2/10'),
      rec('agent', 'Final answer reached'),
      rec('agent', 'Deployed into SOL-USDC'),
    ]
    expect(lastDecision(logs)?.text).toBe('Deployed into SOL-USDC')
  })

  it('returns management verdicts and agent replies', () => {
    expect(lastDecision([rec('cron', 'Management: all positions STAY — skipping')])?.text).toMatch(/STAY/)
    expect(lastDecision([rec('agent_reply', 'Holding.')])?.text).toBe('Holding.')
    expect(lastDecision([rec('agent', 'Step 1/10')])).toBeNull()
  })
})
