import { describe, expect, it } from 'vitest'
import { isLiveAgent, startNeedsConfirmation } from './agentSafety'

describe('agentSafety', () => {
  it('treats dryRun: true as safe', () => {
    expect(isLiveAgent({ dryRun: true })).toBe(false)
    expect(startNeedsConfirmation({ dryRun: true })).toBe(false)
  })

  it('treats dryRun: false as live', () => {
    expect(isLiveAgent({ dryRun: false })).toBe(true)
    expect(startNeedsConfirmation({ dryRun: false })).toBe(true)
  })

  it('treats a missing dryRun as live (daemon default is false)', () => {
    expect(isLiveAgent({} as { dryRun: boolean })).toBe(true)
    expect(isLiveAgent(null)).toBe(true)
    expect(isLiveAgent(undefined)).toBe(true)
  })
})
