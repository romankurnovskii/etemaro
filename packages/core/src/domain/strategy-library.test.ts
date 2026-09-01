import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../config/Config.js'
import * as logger from '../shared/logger.js'
import * as lib from './strategy-library.js'

// No need for global vi.mock here, using vi.spyOn in the test

describe('strategy-library persistence and validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('setActiveStrategy should return error if fs.writeFileSync fails', () => {
    const actualReadFileSync = fs.readFileSync
    const actualExistsSync = fs.existsSync
    vi.spyOn(fs, 'existsSync').mockImplementation((pathArg: any) => {
      const p = pathArg.toString()
      if (p.includes('user-config.json') || p.includes('strategy-library.shared.json')) return true
      return actualExistsSync(pathArg)
    })
    vi.spyOn(fs, 'readFileSync').mockImplementation(((pathArg: any, options: any) => {
      const p = pathArg.toString()
      if (p.includes('user-config.json')) {
        return JSON.stringify({ strategy: { activeStrategyId: 'old_id' } })
      }
      if (p.includes('strategy-library.shared.json')) {
        return JSON.stringify({ strategies: { single_sided_reseed: { name: 'test_strategy' } } })
      }
      return actualReadFileSync(pathArg, options)
    }) as any)

    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('Disk full')
    })

    const result = lib.setActiveStrategy({ id: 'single_sided_reseed' })

    expect(result).toHaveProperty('error')
    expect((result as any).error).toMatch(/Failed to update user config.*Disk full/)
  })
})

describe('strategy-library loads both shared and private libraries', () => {
  const sharedStrategies = {
    single_sided_reseed: { id: 'single_sided_reseed', name: 'Single-Sided Reseed', author: 'meridian' },
    custom_ratio_spot: { id: 'custom_ratio_spot', name: 'Custom Ratio Spot', author: 'meridian' },
  }
  const privateStrategies = {
    copy_trade_lag: { id: 'copy_trade_lag', name: 'Copy Trade Lag', author: 'custom' },
  }

  const actualExistsSync = fs.existsSync
  const actualReadFileSync = fs.readFileSync

  function mockLibraries() {
    vi.spyOn(fs, 'existsSync').mockImplementation((pathArg: any) => {
      const p = pathArg.toString()
      if (p.includes('strategy-library.shared.json')) return true
      if (p.includes('strategy-library.json')) return true
      return actualExistsSync(pathArg)
    })
    vi.spyOn(fs, 'readFileSync').mockImplementation(((pathArg: any, options: any) => {
      const p = pathArg.toString()
      if (p.includes('strategy-library.shared.json')) {
        return JSON.stringify({ strategies: sharedStrategies })
      }
      if (p.includes('strategy-library.json')) {
        return JSON.stringify({ strategies: privateStrategies })
      }
      return actualReadFileSync(pathArg, options)
    }) as any)
  }

  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('listStrategies includes strategies from both the shared and private libraries', () => {
    mockLibraries()
    const result = lib.listStrategies()
    const ids = (result.strategies as Array<{ id: string }>).map((s) => s.id)
    expect(ids).toContain('single_sided_reseed')
    expect(ids).toContain('custom_ratio_spot')
    expect(ids).toContain('copy_trade_lag')
  })

  it('getStrategy resolves a strategy that only exists in the private library', () => {
    mockLibraries()
    const result = lib.getStrategy({ id: 'copy_trade_lag' })
    expect(result.error).toBeUndefined()
    expect(result.name).toBe('Copy Trade Lag')
    expect(result.author).toBe('custom')
  })

  it('getStrategy returns not-found for an id in neither library', () => {
    mockLibraries()
    const result = lib.getStrategy({ id: 'does_not_exist' })
    expect(result.error).toMatch(/not found/i)
  })

  it('validateActiveStrategy succeeds for a strategy that only exists in the private library', () => {
    mockLibraries()
    const originalActive = config.strategy.activeStrategyId
    try {
      config.strategy.activeStrategyId = 'copy_trade_lag'
      expect(() => lib.validateActiveStrategy()).not.toThrow()
    } finally {
      config.strategy.activeStrategyId = originalActive
    }
  })

  it('validateActiveStrategy throws for an id present in neither library', () => {
    mockLibraries()
    const originalActive = config.strategy.activeStrategyId
    try {
      config.strategy.activeStrategyId = 'does_not_exist'
      expect(() => lib.validateActiveStrategy()).toThrow(/not found in the strategy library/)
    } finally {
      config.strategy.activeStrategyId = originalActive
    }
  })

  it('flags duplicate strategy ids shared between the private and shared libraries', () => {
    const logSpy = vi.spyOn(logger, 'log')
    const sharedWithCollision = {
      copy_trade_lag: { id: 'copy_trade_lag', name: 'Shared copy trade', author: 'meridian' },
    }
    vi.spyOn(fs, 'existsSync').mockImplementation((pathArg: any) => {
      const p = pathArg.toString()
      return p.includes('strategy-library.shared.json') || p.includes('strategy-library.json')
    })
    vi.spyOn(fs, 'readFileSync').mockImplementation(((pathArg: any, options: any) => {
      const p = pathArg.toString()
      if (p.includes('strategy-library.shared.json')) {
        return JSON.stringify({ strategies: sharedWithCollision })
      }
      if (p.includes('strategy-library.json')) {
        return JSON.stringify({ strategies: privateStrategies })
      }
      return actualReadFileSync(pathArg, options)
    }) as any)

    lib.listStrategies()

    const warned = logSpy.mock.calls.some(
      (call) => typeof call[1] === 'string' && /collides with a shared strategy id/.test(call[1]),
    )
    expect(warned).toBe(true)
  })
})
