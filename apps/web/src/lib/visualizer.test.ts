import { describe, expect, it } from 'vitest'
import type { LogEntry, ManagedAgent } from './ipc'
import { agentWsUrl, assetSplit, binProgress, elapsed, logLevel, strategyChanges } from './visualizer'

const agent = { running: true, ipcPort: 8766 } as ManagedAgent
describe('agent endpoint isolation', () => {
  it('uses each child port and preserves secure transport', () => {
    expect(agentWsUrl(agent, 'wss://console.example:8765/')).toBe('wss://console.example:8766/')
    expect(agentWsUrl({ ...agent, ipcPort: 8767 }, 'ws://localhost:8765/')).toBe('ws://localhost:8767/')
  })
  it('never substitutes the parent endpoint or connects stopped agents', () => {
    for (const ipcPort of [undefined, 0, -1, 1.5, 65536, 8765])
      expect(agentWsUrl({ ...agent, ipcPort }, 'ws://localhost:8765/')).toBeNull()
    expect(agentWsUrl({ ...agent, running: false }, 'ws://localhost:8765/')).toBeNull()
  })
  it('does not carry query credentials into another endpoint', () => {
    expect(agentWsUrl(agent, 'ws://localhost:8765/?token=synthetic')).toBe('ws://localhost:8766/')
  })
})
describe('strategy review', () => {
  it('shows additions, removals, nested changes and array changes', () => {
    expect(
      strategyChanges({ risk: { max: 2 }, tags: ['a'], removed: true }, { risk: { max: 3 }, tags: ['b'], added: 0 }),
    ).toEqual([
      { path: 'added', before: '(missing)', after: '0' },
      { path: 'removed', before: 'true', after: '(missing)' },
      { path: 'risk.max', before: '2', after: '3' },
      { path: 'tags', before: '["a"]', after: '["b"]' },
    ])
  })
  it('ignores activity flags and object key order without hiding a value change', () => {
    expect(strategyChanges({ a: 1, b: 2, is_active: true }, { b: 2, a: 1, is_active: false })).toEqual([])
    expect(strategyChanges({ a: 0 }, { a: false })).toHaveLength(1)
  })
})
describe('reported metrics', () => {
  it('handles single-bin positions, clamped edges and invalid ranges honestly', () => {
    const position = { positionAddress: 'p', poolAddress: 'q', lowerBin: 0, upperBin: 0, activeBin: 0 }
    expect(binProgress(position)).toBe(50)
    expect(binProgress({ ...position, activeBin: 1 })).toBe(100)
    expect(binProgress({ ...position, activeBin: -1 })).toBe(0)
    expect(binProgress({ ...position, lowerBin: 2, upperBin: 1 })).toBeNull()
    expect(binProgress({ ...position, activeBin: Number.NaN })).toBeNull()
  })
  it('uses relative USD values, including a zero-side holding', () => {
    expect(assetSplit({ positionAddress: 'p', poolAddress: 'q', assetXValueUsd: 80, assetYValueUsd: 20 })).toBe(80)
    expect(assetSplit({ positionAddress: 'p', poolAddress: 'q', assetXValueUsd: 0, assetYValueUsd: 20 })).toBe(0)
  })
  it('never invents an even split for unknown, negative or zero totals', () => {
    for (const values of [
      {},
      { assetXValueUsd: 0, assetYValueUsd: 0 },
      { assetXValueUsd: -1, assetYValueUsd: 4 },
      { assetXValueUsd: Number.NaN, assetYValueUsd: 1 },
    ])
      expect(assetSplit({ positionAddress: 'p', poolAddress: 'q', ...values })).toBeNull()
  })
  it('formats measured uptime, missing timestamps and future clock skew', () => {
    expect(elapsed(undefined)).toBe('Not reported')
    expect(elapsed('invalid')).toBe('Not reported')
    expect(elapsed('2026-01-01T00:00:00Z', Date.parse('2026-01-01T00:02:01Z'))).toBe('2m')
    expect(elapsed('2026-01-01T00:00:00Z', 0)).toBe('0s')
  })
  it('classifies explicit log category conventions', () => {
    for (const [category, level] of [
      ['cron_error', 'error'],
      ['positions_warn', 'warn'],
      ['safety_block', 'warn'],
      ['tool_start', 'info'],
    ])
      expect(logLevel({ category } as LogEntry)).toBe(level)
  })
})
