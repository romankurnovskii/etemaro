import { describe, expect, it } from 'vitest'
import { DRY_RUN_REMOVED_MESSAGE, rejectRemovedDryRunFlag } from './cliFlags.js'

describe('rejectRemovedDryRunFlag', () => {
  it('rejects --dry-run with guidance to the config field', () => {
    expect(rejectRemovedDryRunFlag({ 'dry-run': true })).toBe(DRY_RUN_REMOVED_MESSAGE)
    expect(DRY_RUN_REMOVED_MESSAGE).toContain('connection.dryRun')
  })

  it('rejects --dry-run even when explicitly false', () => {
    expect(rejectRemovedDryRunFlag({ 'dry-run': false })).toBe(DRY_RUN_REMOVED_MESSAGE)
  })

  it('passes when the flag is absent', () => {
    expect(rejectRemovedDryRunFlag({})).toBeNull()
    expect(rejectRemovedDryRunFlag({ silent: true, config: '/tmp/a.json' })).toBeNull()
  })
})
