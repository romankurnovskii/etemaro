import { describe, expect, it } from 'vitest'
import { backoffDelay } from './backoff'

const policy = { baseMs: 500, maxMs: 15_000 }

describe('backoffDelay', () => {
  it('grows exponentially within [ceiling/2, ceiling]', () => {
    expect(backoffDelay(0, policy, () => 0)).toBe(250)
    expect(backoffDelay(0, policy, () => 1)).toBe(500)
    expect(backoffDelay(3, policy, () => 0)).toBe(2000)
    expect(backoffDelay(3, policy, () => 1)).toBe(4000)
  })

  it('caps at maxMs', () => {
    expect(backoffDelay(50, policy, () => 1)).toBe(15_000)
    expect(backoffDelay(50, policy, () => 0)).toBe(7500)
  })

  it('never returns 0 (no hot reconnect loop)', () => {
    expect(backoffDelay(0, policy, () => 0)).toBeGreaterThan(0)
  })

  it('clamps negative attempts', () => {
    expect(backoffDelay(-3, policy, () => 1)).toBe(500)
  })
})
