import { describe, expect, it } from 'vitest'
import { agentWsUrl } from '../lib/api'
import { elapsed, strategyDiff } from './AgentsView'

describe('visualizer presentation', () => {
  it('preserves endpoint host/TLS and never carries URL tokens to child endpoints', () => {
    expect(agentWsUrl(8766, 'https://example.test:8765/console?token=test#tab')).toBe('wss://example.test:8766/')
    expect(agentWsUrl(9000, 'http://127.0.0.1:8765')).toBe('ws://127.0.0.1:9000/')
  })
  it.each([undefined, null, 0, -1, 65536, 1.5, Number.NaN])(
    'does not invent a connection for invalid port %s',
    (port) => {
      expect(agentWsUrl(port)).toBeNull()
    },
  )
  it('renders actual elapsed time and labels unknown timestamps', () => {
    const now = Date.parse('2026-10-17T01:00:00Z')
    expect(elapsed('2026-10-17T00:58:35Z', now)).toBe('1m 25s')
    expect(elapsed(now - 3600000, now)).toBe('1h 0m')
    expect(elapsed(undefined, now)).toBe('Not reported')
    expect(elapsed('bad-date', now)).toBe('Not reported')
    expect(elapsed(now + 1000, now)).toBe('0s')
  })
  it('previews changed, removed and added strategy parameters without mutating inputs', () => {
    const before = { id: 'a', is_active: true, lpStrategy: 'spot', limits: { max: 1 }, obsolete: true }
    const after = { id: 'b', is_active: false, lpStrategy: 'curve', limits: { max: 2 }, bestFor: 'high volatility' }
    const changes = strategyDiff(before, after)
    expect(changes.map((c) => c.key)).toEqual(['bestFor', 'limits', 'lpStrategy', 'obsolete'])
    expect(changes.find((c) => c.key === 'obsolete')?.after).toBeUndefined()
    expect(before.limits.max).toBe(1)
    expect(after.limits.max).toBe(2)
  })
})

describe('measured telemetry presentation', () => {
  it('handles inclusive ranges and does not invent an active bin', async () => {
    const { positionRange } = await import('./AgentsView')
    const position = { positionAddress: 'p', poolAddress: 'pool', lowerBin: -5, upperBin: 5, activeBin: 5 }
    expect(positionRange(position)).toMatchObject({ inRange: true, marker: 100 })
    expect(positionRange({ ...position, activeBin: 6 })).toMatchObject({ inRange: false, marker: 100 })
    expect(positionRange({ ...position, activeBin: undefined })).toMatchObject({
      inRange: null,
      activeBin: null,
      marker: null,
    })
    expect(positionRange({ ...position, lowerBin: 10 })).toBeNull()
    expect(positionRange({ ...position, lowerBin: 0, upperBin: 0, activeBin: 0 })).toMatchObject({
      inRange: true,
      marker: 50,
    })
  })
  it('never presents absent or invalid confidence as a percentage', async () => {
    const { confidenceLabel } = await import('./AgentsView')
    expect(confidenceLabel(null)).toBe('Not reported')
    expect(confidenceLabel(0)).toBe('0%')
    expect(confidenceLabel(0.72)).toBe('72%')
    expect(confidenceLabel(Number.NaN)).toBe('Not reported')
    expect(confidenceLabel(75)).toBe('Not reported')
  })
})
