import { describe, expect, it } from 'vitest'
import { fmtClock, fmtCountdown } from './format'

const NOW = Date.parse('2026-11-22T19:00:00.000Z')

describe('fmtCountdown', () => {
  it('counts seconds, minutes and hours', () => {
    expect(fmtCountdown('2026-11-22T19:00:45.000Z', NOW)).toBe('in 45s')
    expect(fmtCountdown('2026-11-22T19:04:35.000Z', NOW)).toBe('in 4m 35s')
    expect(fmtCountdown('2026-11-22T19:05:00.000Z', NOW)).toBe('in 5m')
    expect(fmtCountdown('2026-11-22T21:30:00.000Z', NOW)).toBe('in 2h 30m')
    expect(fmtCountdown('2026-11-22T21:00:00.000Z', NOW)).toBe('in 2h')
  })

  it('reports a past target as due now', () => {
    expect(fmtCountdown('2026-11-22T18:59:00.000Z', NOW)).toBe('due now')
    expect(fmtCountdown('2026-11-22T19:00:00.000Z', NOW)).toBe('due now')
  })

  it('returns a dash for missing or invalid targets', () => {
    expect(fmtCountdown(undefined, NOW)).toBe('—')
    expect(fmtCountdown(null, NOW)).toBe('—')
    expect(fmtCountdown('not-a-date', NOW)).toBe('—')
  })
})

describe('fmtClock', () => {
  it('renders in the requested timezone', () => {
    const iso = '2026-11-22T19:10:01.000Z'
    expect(fmtClock(iso, 'UTC')).toMatch(/7:10:01/)
    expect(fmtClock(iso, 'Europe/Berlin')).toMatch(/8:10:01/)
  })

  it('returns a dash for invalid input', () => {
    expect(fmtClock(undefined)).toBe('—')
    expect(fmtClock('nope')).toBe('—')
  })
})
