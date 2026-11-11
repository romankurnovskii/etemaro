/**
 * Unit tests for apps/web/src/lib/hashRoute.ts
 *
 * Tests hash route parsing for all valid and invalid inputs.
 * Pure function — no DOM, no fake timers needed.
 */
import { describe, expect, it } from 'vitest'
import { parseHash, VALID_HASHES } from './hashRoute'

describe('parseHash', () => {
  it.each(VALID_HASHES)('accepts valid route %s without prefix', (route) => {
    expect(parseHash(route)).toBe(route)
  })

  it.each(VALID_HASHES)('accepts valid route #%s (with # prefix)', (route) => {
    expect(parseHash(`#${route}`)).toBe(route)
  })

  it.each(VALID_HASHES)('accepts valid route #/%s (with #/ prefix)', (route) => {
    expect(parseHash(`#/${route}`)).toBe(route)
  })

  it('returns agents for empty hash', () => {
    expect(parseHash('')).toBe('agents')
  })

  it('returns agents for bare # hash', () => {
    expect(parseHash('#')).toBe('agents')
  })

  it('returns agents for unknown route', () => {
    expect(parseHash('#/unknown')).toBe('agents')
  })

  it('returns agents for garbage input', () => {
    expect(parseHash('this-is-not-a-route')).toBe('agents')
  })

  it('is case-sensitive — mixed case is not a valid route', () => {
    expect(parseHash('#Agents')).toBe('agents') // Agents !== agents, so defaults
  })

  it('does not accept partial route names', () => {
    expect(parseHash('#agen')).toBe('agents')
  })

  it('all VALID_HASHES entries round-trip', () => {
    for (const route of VALID_HASHES) {
      expect(parseHash(parseHash(route))).toBe(route)
    }
  })
})
