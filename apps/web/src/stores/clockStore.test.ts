import { describe, expect, it } from 'vitest'
import { zoneLabel } from './clockStore'

describe('zoneLabel', () => {
  it('prefers the IANA zone', () => {
    expect(zoneLabel('Europe/Berlin', 60)).toBe('Europe/Berlin')
  })

  it('falls back to a UTC offset', () => {
    expect(zoneLabel(null, 0)).toBe('UTC+0')
    expect(zoneLabel(null, 120)).toBe('UTC+2')
    expect(zoneLabel(null, -330)).toBe('UTC-5:30')
  })

  it('says local when nothing is known', () => {
    expect(zoneLabel(null, null)).toBe('local')
  })
})
