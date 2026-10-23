import type { IpcLogEntry } from '@etemaro/core'
import { describe, expect, it } from 'vitest'
import { ConsoleTelemetry, livePositionFor, positionTelemetry } from './ConsoleTelemetry.js'

const entry = (category: string, tool?: string, step = 1): IpcLogEntry => ({
  category,
  message: category,
  agentId: 'alpha',
  ts: '2026-10-23T00:00:00Z',
  metadata: { tool, step },
})
describe('console telemetry', () => {
  it('follows actual loop and tool events, distinguishing reads from writes', () => {
    const state = new ConsoleTelemetry()
    const writes = new Set(['deploy_position'])
    expect(state.phase).toBe('idle')
    state.observe(entry('agent_loop_start'), writes)
    expect(state.phase).toBe('evaluating')
    state.observe(entry('tool_start', 'get_positions'), writes)
    expect(state.phase).toBe('evaluating')
    state.observe(entry('tool_start', 'deploy_position'), writes)
    expect(state.phase).toBe('rebalancing')
    state.observe(entry('tool_finish', 'deploy_position'), writes)
    expect(state.lastTool?.status).toBe('completed')
    state.observe(entry('agent_loop_end'), writes)
    expect(state.phase).toBe('settled')
  })
  it('keeps a write phase until parallel writes finish', () => {
    const state = new ConsoleTelemetry()
    const writes = new Set(['deploy_position'])
    state.observe(entry('tool_start', 'deploy_position', 1), writes)
    state.observe(entry('tool_start', 'deploy_position', 2), writes)
    state.observe(entry('tool_finish', 'deploy_position', 1), writes)
    expect(state.phase).toBe('rebalancing')
    state.observe(entry('agent_loop_error'), writes)
    expect(state.phase).toBe('error')
  })
  it('ignores unrelated logs rather than inventing a phase', () => {
    const state = new ConsoleTelemetry()
    expect(state.observe(entry('startup'), new Set())).toBe(false)
    expect(state.phase).toBe('idle')
  })
  it('clears an interrupted loop so the next read is not labelled a write', () => {
    const state = new ConsoleTelemetry()
    state.observe(entry('tool_start', 'deploy_position'), new Set(['deploy_position']))
    state.observe(entry('agent_loop_error'), new Set())
    state.observe(entry('agent_loop_start'), new Set())
    state.observe(entry('tool_start', 'get_positions'), new Set())
    expect(state.phase).toBe('evaluating')
  })
})
describe('measured position telemetry', () => {
  it('matches position identity, never a different position in the same pool', () => {
    const first = { position: 'one', pool: 'same', lower_bin: 1 }
    const second = { position: 'two', pool: 'same', lower_bin: 9 }
    expect(livePositionFor({ position: 'two', pool: 'same' }, [first, second])).toBe(second)
    expect(livePositionFor({ position: 'missing', pool: 'same' }, [first])).toBeUndefined()
    expect(livePositionFor({}, [{}])).toBeUndefined()
  })
  it('preserves zero and negative bins and computes inclusive bounds', () => {
    expect(
      positionTelemetry({ lower_bin: -5, upper_bin: 0, active_bin: 0, asset_x_value_usd: 0, asset_y_value_usd: 12 }),
    ).toMatchObject({ lowerBin: -5, upperBin: 0, activeBin: 0, inRange: true, assetXValueUsd: 0, assetYValueUsd: 12 })
    expect(positionTelemetry({ lower_bin: 1, upper_bin: 5, active_bin: 6 }).inRange).toBe(false)
  })
  it('does not turn missing/null values into fabricated zero telemetry', () => {
    expect(positionTelemetry(undefined).activeBin).toBeUndefined()
    expect(positionTelemetry({ lower_bin: null, upper_bin: 2, active_bin: 0 }).inRange).toBeUndefined()
    expect(positionTelemetry({ asset_x_value_usd: Number.NaN }).assetXValueUsd).toBeUndefined()
  })
})
