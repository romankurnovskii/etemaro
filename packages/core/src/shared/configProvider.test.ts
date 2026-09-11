import { describe, expect, it } from 'vitest'
import { config } from '../config/Config.js'
import type { ConfigPort } from '../ports/config.js'
import { getConfig, resetConfig, setConfig } from './configProvider.js'

describe('config provider binding', () => {
  it('defaults to the process config singleton', () => {
    resetConfig()
    expect(getConfig()).toBe(config)
  })

  it('can be replaced with a scoped config', () => {
    const fake = { screening: { timeframe: '9h' } } as unknown as ConfigPort
    setConfig(fake)
    expect(getConfig()).toBe(fake)
    resetConfig()
    expect(getConfig()).toBe(config)
  })
})
