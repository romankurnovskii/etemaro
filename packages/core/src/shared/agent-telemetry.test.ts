import { describe, expect, it } from 'vitest'
import {
  AgentTelemetry,
  cachedPositionTelemetry,
  observedPnlTotal,
  observedUsd,
  projectPositionTelemetry,
} from './agent-telemetry.js'
import type { IpcLogEntry } from './ipc-protocol.js'

function event(category: string, metadata?: Record<string, unknown>, message = category): IpcLogEntry {
  return { category, metadata, message, ts: '2026-10-17T02:00:00.000Z', agentId: 'test-agent' }
}

describe('actual execution telemetry', () => {
  it('starts idle with no fabricated confidence or execution summaries', () => {
    expect(new AgentTelemetry(() => 1000).snapshot()).toEqual({
      phase: 'Idle',
      phaseSince: '1970-01-01T00:00:01.000Z',
      lastDecision: null,
      lastTool: null,
      confidence: null,
      lastError: null,
    })
  })
  it('tracks activity and portfolio tool boundaries, keeping reads and config writes Evaluating', () => {
    let now = 1000
    const telemetry = new AgentTelemetry(() => now)
    const cycle = telemetry.beginActivity()
    expect(telemetry.snapshot().phase).toBe('Evaluating')
    for (const tool of ['get_strategy', 'update_config']) {
      telemetry.observeLog(event('tool_execution_start', { executionId: tool, tool }))
      expect(telemetry.snapshot().phase).toBe('Evaluating')
      telemetry.observeLog(event('tool_execution_end', { executionId: tool, outcome: 'completed' }))
    }
    now = 2000
    telemetry.observeLog(event('tool_execution_start', { executionId: 'write', tool: 'close_position' }))
    expect(telemetry.snapshot()).toMatchObject({ phase: 'Rebalancing', phaseSince: '1970-01-01T00:00:02.000Z' })
    telemetry.observeLog(event('tool_execution_end', { executionId: 'write', outcome: 'completed' }))
    expect(telemetry.snapshot().phase).toBe('Evaluating')
    telemetry.finishActivity(cycle)
    expect(telemetry.snapshot().phase).toBe('Settled')
  })
  it('does not settle while another real activity or portfolio tool is running', () => {
    const telemetry = new AgentTelemetry(() => 1000)
    const first = telemetry.beginActivity()
    const second = telemetry.beginActivity()
    telemetry.observeLog(event('tool_execution_start', { executionId: 'a', tool: 'deploy_position' }))
    telemetry.observeLog(event('tool_execution_start', { executionId: 'b', tool: 'claim_fees' }))
    telemetry.observeLog(event('tool_execution_end', { executionId: 'a', outcome: 'completed' }))
    telemetry.finishActivity(first)
    expect(telemetry.snapshot().phase).toBe('Rebalancing')
    telemetry.observeLog(event('tool_execution_end', { executionId: 'b', outcome: 'completed' }))
    expect(telemetry.snapshot().lastTool).toMatchObject({ name: 'claim_fees', status: 'completed' })
    expect(telemetry.snapshot().phase).toBe('Evaluating')
    telemetry.finishActivity(second)
    expect(telemetry.snapshot().phase).toBe('Settled')
  })
  it('does not infer a phase from prose, old loop logs, or unrelated completions', () => {
    const telemetry = new AgentTelemetry(() => 1000)
    telemetry.observeLog(event('info', undefined, 'deploy_position completed and rebalanced'))
    telemetry.observeLog(event('tool_start', { tool: 'deploy_position' }))
    telemetry.observeLog(event('tool_execution_end', { executionId: 'unknown', outcome: 'completed' }))
    telemetry.finishActivity(Symbol('unknown'))
    expect(telemetry.snapshot().phase).toBe('Idle')
  })
  it('records a safety-blocked tool without claiming its portfolio action executed', () => {
    const telemetry = new AgentTelemetry(() => 1000)
    const activity = telemetry.beginActivity()
    telemetry.observeLog(event('safety_block', { tool: 'deploy_position' }))
    expect(telemetry.snapshot()).toMatchObject({
      phase: 'Evaluating',
      lastTool: { name: 'deploy_position', status: 'blocked' },
    })
    telemetry.finishActivity(activity)
  })
  it('retains actual errors until a new external activity begins', () => {
    const telemetry = new AgentTelemetry(() => 1000)
    const activity = telemetry.beginActivity()
    telemetry.finishActivity(activity, 'Provider unavailable')
    expect(telemetry.snapshot()).toMatchObject({ phase: 'Idle', lastError: { message: 'Provider unavailable' } })
    telemetry.beginActivity()
    expect(telemetry.snapshot().lastError).toBeNull()
  })
  it('keeps the latest invocation when older executions finish out of order', () => {
    const telemetry = new AgentTelemetry(() => 1000)
    telemetry.observeLog(event('tool_execution_start', { executionId: 'old', tool: 'close_position' }))
    telemetry.observeLog(event('tool_execution_start', { executionId: 'new', tool: 'get_strategy' }))
    telemetry.observeLog(event('tool_execution_end', { executionId: 'old', outcome: 'failed' }))
    expect(telemetry.snapshot().lastTool).toMatchObject({ name: 'get_strategy', status: 'running' })
    expect(telemetry.snapshot().lastError?.message).toContain('close_position')
    telemetry.observeLog(event('tool_execution_end', { executionId: 'new', outcome: 'completed' }))
    expect(telemetry.snapshot().lastTool).toMatchObject({ name: 'get_strategy', status: 'completed' })
  })
  it('copies actual redacted decision/error events without manufacturing confidence', () => {
    const telemetry = new AgentTelemetry(() => 1000)
    telemetry.observeLog(event('decision_recorded', undefined, 'Screening skipped'))
    telemetry.observeLog({ ...event('cron_error', undefined, 'Fetch failed [REDACTED]'), level: 'error' })
    const snapshot = telemetry.snapshot()
    expect(snapshot.lastDecision).toEqual({ summary: 'Screening skipped', ts: '2026-10-17T02:00:00.000Z' })
    expect(snapshot.lastError?.message).toBe('Fetch failed [REDACTED]')
    expect(snapshot.confidence).toBeNull()
    snapshot.lastDecision!.summary = 'mutated consumer'
    expect(telemetry.snapshot().lastDecision?.summary).toBe('Screening skipped')
  })
})

describe('already-fetched position projection', () => {
  it.each([-4, 0, 9])('preserves signed/zero observed bin IDs (%s)', (activeBin) => {
    expect(projectPositionTelemetry({ lowerBin: -4, upperBin: 9, activeBin })).toMatchObject({
      lowerBin: -4,
      upperBin: 9,
      activeBin,
      inRange: true,
    })
  })
  it('uses inclusive observed bounds', () => {
    expect(projectPositionTelemetry({ lowerBin: 10, upperBin: 10, activeBin: 10 }).inRange).toBe(true)
    expect(projectPositionTelemetry({ lowerBin: 10, upperBin: 20, activeBin: 21 }).inRange).toBe(false)
  })
  it('does not turn unknowns or deployment-time bins into current measurements', () => {
    expect(projectPositionTelemetry({})).toEqual({
      lowerBin: null,
      upperBin: null,
      activeBin: null,
      inRange: null,
      assetSplit: null,
    })
    expect(projectPositionTelemetry({ lowerBin: 30, upperBin: 20, activeBin: 25 })).toMatchObject({
      lowerBin: null,
      upperBin: null,
      inRange: null,
    })
    expect(
      cachedPositionTelemetry({ active_bin: 5, bin_range: { min: 1, max: 10, active: 5 }, amount_x: 1 }),
    ).toMatchObject({ activeBin: null, assetSplit: null })
    expect(projectPositionTelemetry({ inRange: false }).inRange).toBe(false)
  })
  it('converts measured raw quantities with each token’s actual mint decimals', () => {
    expect(
      projectPositionTelemetry({
        tokenXRaw: '1500000',
        tokenYRaw: { toString: () => '2500000000' },
        tokenXDecimals: 6,
        tokenYDecimals: 9,
      }).assetSplit,
    ).toEqual({ tokenXAmount: 1.5, tokenYAmount: 2.5 })
    expect(
      projectPositionTelemetry({ tokenXRaw: 0, tokenYRaw: 7, tokenXDecimals: 0, tokenYDecimals: 0 }).assetSplit,
    ).toEqual({ tokenXAmount: 0, tokenYAmount: 7 })
  })
  it.each([undefined, null, '', '   ', '\t\n', Number.NaN, Number.POSITIVE_INFINITY, -1, 'broken', true])(
    'rejects invalid raw asset quantity %s',
    (tokenXRaw) => {
      expect(
        projectPositionTelemetry({ tokenXRaw, tokenYRaw: 1, tokenXDecimals: 6, tokenYDecimals: 9 }).assetSplit,
      ).toBeNull()
    },
  )
  it('requires measured decimals rather than silently using an SDK fallback', () => {
    expect(projectPositionTelemetry({ tokenXRaw: 1, tokenYRaw: 2, tokenYDecimals: 9 }).assetSplit).toBeNull()
    expect(
      projectPositionTelemetry({ tokenXRaw: 1, tokenYRaw: 2, tokenXDecimals: 1.5, tokenYDecimals: 9 }).assetSplit,
    ).toBeNull()
  })
  it('forwards only validated cached visualization fields', () => {
    const projected = projectPositionTelemetry({
      lowerBin: 1,
      upperBin: 10,
      activeBin: 4,
      tokenXRaw: 10,
      tokenYRaw: 20,
      tokenXDecimals: 0,
      tokenYDecimals: 0,
    })
    expect(cachedPositionTelemetry({ visualization: projected, unrelated: 'do-not-forward' })).toEqual(projected)
    expect(
      cachedPositionTelemetry({ visualization: { ...projected, assetSplit: { tokenXAmount: -1, tokenYAmount: 2 } } })
        .assetSplit,
    ).toBeNull()
  })

  it('never labels legacy SOL quantities as USD and prefers actual USD observations', () => {
    expect(observedUsd(150, 1, true)).toBe(150)
    expect(observedUsd(0, 1, true)).toBe(0)
    expect(observedUsd(undefined, 1, true)).toBeUndefined()
    expect(observedUsd(null, 1, false)).toBe(1)
    expect(observedUsd('   ', '  ', false)).toBeUndefined()
    expect(observedUsd(Number.NaN, Number.POSITIVE_INFINITY, false)).toBeUndefined()
  })

  it('does not report a fabricated zero total when any tracked position lacks USD observations', () => {
    expect(observedPnlTotal([{ pnlUsd: 10 }, { pnlUsd: -3.5 }])).toEqual({ totalPnlUsd: 6.5, totalPnlUsdKnown: true })
    expect(observedPnlTotal([{ pnlUsd: 10 }, {}])).toEqual({ totalPnlUsd: 0, totalPnlUsdKnown: false })
    expect(observedPnlTotal([])).toEqual({ totalPnlUsd: 0, totalPnlUsdKnown: true })
  })
})
