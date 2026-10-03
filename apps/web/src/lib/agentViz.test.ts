import { describe, expect, it } from 'vitest'
import { agentLogs, fleetStatus, inferPhase, logSeverity, relTime, snapshotFor } from './agentViz'
import type { LogEntry, ManagedAgent, StateSnapshot } from './ipc'

const NOW = Date.parse('2026-01-01T12:00:00.000Z')
const at = (secAgo: number) => new Date(NOW - secAgo * 1000).toISOString()
const entry = (category: string, message: string, secAgo = 1, agentId = 'a1'): LogEntry => ({
  category,
  message,
  agentId,
  ts: at(secAgo),
})

const agent = (over: Partial<ManagedAgent> = {}): ManagedAgent => ({
  id: 'a1',
  name: 'A1',
  strategyId: 's1',
  running: true,
  pid: 42,
  configPath: '/data/instances/a1/config.json',
  dataDir: '/data/instances/a1',
  ...over,
})

describe('logSeverity', () => {
  it('mirrors the daemon logger category rule', () => {
    expect(logSeverity({ category: 'cron_error' })).toBe('error')
    expect(logSeverity({ category: 'telegram_warn' })).toBe('warn')
    expect(logSeverity({ category: 'screening' })).toBe('info')
  })
})

describe('agentLogs', () => {
  it('never folds unattributed or other agents lines into an agent', () => {
    const logs = [
      entry('cron', 'x', 1, 'a1'),
      entry('cron_error', 'boom', 1, ''),
      entry('cron', 'y', 1, 'default'),
      entry('cron', 'z', 1, 'a2'),
    ]
    expect(agentLogs(logs, 'a1').map((l) => l.message)).toEqual(['x'])
  })

  it('does not let a global error mark an agent as errored', () => {
    const logs = [entry('cron_error', 'boom', 1, '')]
    const mine = agentLogs(logs, 'a1')
    expect(fleetStatus(agent(), mine, false, inferPhase(mine, null, NOW), NOW)).toBe('running')
  })
})

describe('snapshotFor', () => {
  const snap = {
    positions: [],
    totalPnlUsd: 0,
    busy: false,
    configPath: 'C:\\data\\instances\\a1\\config.json',
  } as StateSnapshot
  it('attributes the snapshot by config path, tolerating separators', () => {
    expect(snapshotFor(agent({ configPath: 'C:/data/instances/a1/config.json' }), snap)).toBe(snap)
  })
  it('does not attribute it to a different agent', () => {
    expect(snapshotFor(agent({ id: 'a2', configPath: '/data/instances/a2/config.json' }), snap)).toBeNull()
  })
  it('returns null when the snapshot has no config path', () => {
    expect(snapshotFor(agent(), { ...snap, configPath: undefined })).toBeNull()
  })
})

describe('inferPhase', () => {
  it('is Idle with no activity', () => {
    expect(inferPhase([], null, NOW)).toBe('Idle')
    expect(inferPhase([], false, NOW)).toBe('Idle')
  })
  it('is Evaluating during screening', () => {
    expect(inferPhase([entry('screening', 'Bot-holder filter', 5)], null, NOW)).toBe('Evaluating')
  })
  it('is Rebalancing while a deploy is in flight, Settled after SUCCESS', () => {
    expect(inferPhase([entry('deploy', 'Pool: abc', 5)], null, NOW)).toBe('Rebalancing')
    expect(inferPhase([entry('deploy', 'Pool: abc', 9), entry('deploy', 'SUCCESS — 2 tx(s): h', 3)], null, NOW)).toBe(
      'Settled',
    )
  })
  it('decays Settled and stale in-flight activity back to Idle', () => {
    expect(inferPhase([entry('deploy', 'SUCCESS — 1 tx(s): h', 600)], null, NOW)).toBe('Idle')
    expect(inferPhase([entry('screening', 'x', 600)], null, NOW)).toBe('Idle')
  })
  it('trusts busy=false over an unfinished cycle, and busy=true over staleness', () => {
    expect(inferPhase([entry('screening', 'x', 5)], false, NOW)).toBe('Idle')
    expect(inferPhase([entry('screening', 'x', 600)], true, NOW)).toBe('Evaluating')
  })
  it('ignores warn/error lines when classifying', () => {
    expect(inferPhase([entry('deploy_error', 'fail', 2)], null, NOW)).toBe('Idle')
  })
})

describe('fleetStatus', () => {
  it('reports stopped, error, running and idle', () => {
    expect(fleetStatus(agent({ running: false }), [], false, 'Idle', NOW)).toBe('stopped')
    expect(fleetStatus(agent(), [entry('cron_error', 'boom', 30)], true, 'Idle', NOW)).toBe('error')
    expect(fleetStatus(agent(), [entry('cron_error', 'old', 3600)], true, 'Idle', NOW)).toBe('idle')
    expect(fleetStatus(agent(), [], true, 'Evaluating', NOW)).toBe('running')
    expect(fleetStatus(agent(), [], false, 'Idle', NOW)).toBe('running')
  })
})

describe('relTime', () => {
  it('formats', () => {
    expect(relTime(null, NOW)).toBe('—')
    expect(relTime(NOW - 2000, NOW)).toBe('just now')
    expect(relTime(NOW - 42_000, NOW)).toBe('42s ago')
    expect(relTime(NOW - 7 * 60_000, NOW)).toBe('7m ago')
  })
})
