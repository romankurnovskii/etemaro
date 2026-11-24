import { afterEach, describe, expect, it } from 'vitest'
import { setDryRun } from '../../shared/flags.js'
import { DRY_RUN_PREFIX, withDryRunTag } from './TelegramAdapter.js'

afterEach(() => {
  setDryRun(false)
})

describe('withDryRunTag', () => {
  it('prefixes messages while dry-run is on', () => {
    setDryRun(true)
    expect(withDryRunTag('🚀 DEPLOYED')).toBe(`${DRY_RUN_PREFIX}\n🚀 DEPLOYED`)
  })

  it('leaves messages untouched when live', () => {
    setDryRun(false)
    expect(withDryRunTag('🚀 DEPLOYED')).toBe('🚀 DEPLOYED')
  })

  it('never double-prefixes', () => {
    setDryRun(true)
    const once = withDryRunTag('hello')
    expect(withDryRunTag(once)).toBe(once)
  })
})
