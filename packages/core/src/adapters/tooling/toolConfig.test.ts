import { describe, expect, it } from 'vitest'
import { config } from '../../config/Config.js'
import type { ConfigPort } from '../../ports/config.js'
import { getToolConfig, resetToolConfig, setToolConfig } from './toolConfig.js'

describe('tool config binding', () => {
  it('defaults to the process config singleton', () => {
    resetToolConfig()
    expect(getToolConfig()).toBe(config)
  })

  it('can be replaced with a scoped config', () => {
    const fake = { screening: { timeframe: '9h' } } as unknown as ConfigPort
    setToolConfig(fake)
    expect(getToolConfig()).toBe(fake)
    resetToolConfig()
    expect(getToolConfig()).toBe(config)
  })
})
