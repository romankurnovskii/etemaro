import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getMinSafeBinsBelow } from '../shared/constants.js'
import { scaleScreeningToTimeframe } from '../shared/utils.js'
import { config } from './Config.js'
import { DEFAULT_USER_CONFIG, defaultUserConfigStr } from './defaultUserConfig.js'
import { UserConfigSchema } from './schema.js'

// Pool febu-SOL (2CVn...) fee/active-TVL from the Meteora Pool Discovery API.
const FEE_ACTIVE_TVL_RATIO_5M = 0.02540134632532999

describe('fee/active-TVL gate timeframe scaling', () => {
  it('scales the fee floor to the screening timeframe', () => {
    expect(scaleScreeningToTimeframe('5m').minFeeActiveTvlRatio).toBe(0.02)
    expect(scaleScreeningToTimeframe('24h').minFeeActiveTvlRatio).toBe(2.0)
  })

  it('config default for 5m matches the scaled floor (not the old static 0.05)', () => {
    // Only valid when user-config.json does not override minFeeActiveTvlRatio.
    if (process.env.FORCE_RAW_SCREENING_DEFAULT) return
    expect(config.screening.timeframe).toBe('5m')
    expect(config.screening.minFeeActiveTvlRatio).toBe(0.02)
    expect(config.screening.minFeeActiveTvlRatio).not.toBe(0.05)
  })

  it('passes a profitable 5m pool (0.0254%) against the scaled 0.02 floor', () => {
    expect(FEE_ACTIVE_TVL_RATIO_5M).toBeGreaterThanOrEqual(config.screening.minFeeActiveTvlRatio)
  })
})

describe('minSafeBinsBelow config override', () => {
  it('exposes minSafeBinsBelow in strategy config', () => {
    expect(config.strategy.minSafeBinsBelow).toBeDefined()
    expect(typeof config.strategy.minSafeBinsBelow).toBe('number')
  })

  it('getMinSafeBinsBelow returns the configured value', () => {
    expect(getMinSafeBinsBelow()).toBe(config.strategy.minSafeBinsBelow)
  })

  it('default minSafeBinsBelow is 10 (matches example config)', () => {
    expect(config.strategy.minSafeBinsBelow).toBe(10)
    expect(getMinSafeBinsBelow()).toBe(10)
  })
})

describe('schema versioning', () => {
  it('exposes schema _version in AppConfig', () => {
    expect(config._version).toBeDefined()
    expect(typeof config._version).toBe('number')
    expect(config._version).toBeGreaterThanOrEqual(1)
  })
})

describe('screening entrySource config', () => {
  it('defaults entrySource to market or smart_wallets', () => {
    expect(config.screening.entrySource).toBeDefined()
    expect(['market', 'smart_wallets']).toContain(config.screening.entrySource)
  })
})

describe('top-level agentId support', () => {
  it('exposes agentId in AppConfig', () => {
    expect(config.agentId !== undefined).toBe(true)
  })
})

describe('hiveMind agentId support', () => {
  let mockReadFileSync: ReturnType<typeof vi.fn>
  let mockExistsSync: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()

    mockExistsSync = vi.fn((path: string) => {
      if (path.endsWith('user-config.json')) return true
      return true
    })

    const baseConfig = JSON.parse(defaultUserConfigStr)

    mockReadFileSync = vi.fn((path: string, _encoding: string) => {
      if (path.endsWith('user-config.json') || path.endsWith('agent-default.json')) {
        return JSON.stringify({
          ...baseConfig,
          agentId: 'local-top-level-agent',
          hiveMind: {
            ...baseConfig.hiveMind,
            agentId: 'nested-hive-agent',
            url: 'https://hive.example.com',
            apiKey: 'hive-key',
          },
        })
      }
      return ''
    })

    vi.doMock('node:fs', () => ({
      default: {
        existsSync: mockExistsSync,
        readFileSync: mockReadFileSync,
      },
      existsSync: mockExistsSync,
      readFileSync: mockReadFileSync,
    }))
  })

  afterEach(() => {
    vi.doUnmock('node:fs')
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('exposes hiveMind.agentId from nested config when top-level agentId is present', async () => {
    const { config: testConfig } = await import('./Config.js')
    expect(testConfig.agentId).toBe('local-top-level-agent')
    expect(testConfig.hiveMind.agentId).toBe('nested-hive-agent')
  })

  it('falls back to agent-default agentId when top-level agentId is null or empty', async () => {
    const baseConfig = JSON.parse(defaultUserConfigStr)
    mockReadFileSync.mockImplementation((path: string, _encoding: string) => {
      if (path.endsWith('user-config.json') || path.endsWith('agent-default.json')) {
        return JSON.stringify({
          ...baseConfig,
          agentId: null,
          hiveMind: {
            ...baseConfig.hiveMind,
            agentId: 'hive-only-agent',
            url: 'https://hive.example.com',
            apiKey: 'hive-key',
          },
        })
      }
      return ''
    })

    const { config: testConfig } = await import('./Config.js')
    expect(testConfig.agentId).toBe('agent-default')
    expect(testConfig.hiveMind.agentId).toBe('hive-only-agent')
  })
})

describe('fail-closed config load and validation behavior', () => {
  const originalConfigPath = process.env.USER_CONFIG_PATH
  const originalSkipEnv = process.env.ETEMARO_SKIP_ENV_VALIDATION

  afterEach(() => {
    if (originalConfigPath === undefined) {
      delete process.env.USER_CONFIG_PATH
    } else {
      process.env.USER_CONFIG_PATH = originalConfigPath
    }
    if (originalSkipEnv === undefined) {
      delete process.env.ETEMARO_SKIP_ENV_VALIDATION
    } else {
      process.env.ETEMARO_SKIP_ENV_VALIDATION = originalSkipEnv
    }
    vi.doUnmock('node:fs')
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('throws ConfigLoadError when an explicit USER_CONFIG_PATH does not exist', async () => {
    vi.resetModules()
    process.env.USER_CONFIG_PATH = '/path/to/nonexistent/custom-config.json'

    let error: any
    try {
      await import('./Config.js')
    } catch (e) {
      error = e
    }

    expect(error).toBeDefined()
    expect(error.name).toBe('ConfigLoadError')
    expect(error.message).toMatch(/Fatal: Failed to load explicit configuration from USER_CONFIG_PATH/)
  })

  it('throws ConfigLoadError when an explicit USER_CONFIG_PATH contains corrupted JSON', async () => {
    vi.resetModules()
    process.env.USER_CONFIG_PATH = '/path/to/corrupted-config.json'

    vi.doMock('node:fs', () => ({
      default: {
        existsSync: () => true,
        readFileSync: () => '{"invalid json: true',
      },
      existsSync: () => true,
      readFileSync: () => '{"invalid json: true',
    }))

    let error: any
    try {
      await import('./Config.js')
    } catch (e) {
      error = e
    }

    expect(error).toBeDefined()
    expect(error.name).toBe('ConfigLoadError')
    expect(error.message).toMatch(/Failed to parse corrupted-config\.json/)
  })

  it('throws ConfigLoadError when an explicit USER_CONFIG_PATH fails schema validation', async () => {
    vi.resetModules()
    process.env.USER_CONFIG_PATH = '/path/to/invalid-schema.json'

    vi.doMock('node:fs', () => ({
      default: {
        existsSync: () => true,
        readFileSync: () => JSON.stringify({ _version: 'not-a-number' }),
      },
      existsSync: () => true,
      readFileSync: () => JSON.stringify({ _version: 'not-a-number' }),
    }))

    let error: any
    try {
      await import('./Config.js')
    } catch (e) {
      error = e
    }

    expect(error).toBeDefined()
    expect(error.name).toBe('ConfigLoadError')
    expect(error.message).toMatch(/invalid-schema\.json has invalid or missing fields/)
  })

  it('throws ConfigLoadError when default user-config.json contains corrupted JSON without explicit USER_CONFIG_PATH', async () => {
    vi.resetModules()
    delete process.env.USER_CONFIG_PATH

    vi.doMock('node:fs', () => ({
      default: {
        existsSync: (p: string) => p.endsWith('user-config.json'),
        readFileSync: () => '{"corrupted": true,',
      },
      existsSync: (p: string) => p.endsWith('user-config.json'),
      readFileSync: () => '{"corrupted": true,',
    }))

    let error: any
    try {
      await import('./Config.js')
    } catch (e) {
      error = e
    }

    expect(error).toBeDefined()
    expect(error.name).toBe('ConfigLoadError')
    expect(error.message).toMatch(/Failed to parse user-config\.json/)
  })

  it('bypasses fatal error and falls back when ETEMARO_SKIP_ENV_VALIDATION is enabled for info/help commands', async () => {
    vi.resetModules()
    process.env.USER_CONFIG_PATH = '/path/to/nonexistent/custom-config.json'
    process.env.ETEMARO_SKIP_ENV_VALIDATION = '1'

    const { config: testConfig } = await import('./Config.js')
    expect(testConfig).toBeDefined()
    expect(testConfig.strategy).toBeDefined()
  })
})

describe('DEFAULT_USER_CONFIG template parity and validation', () => {
  it('defaultUserConfigStr accurately serializes DEFAULT_USER_CONFIG', () => {
    const parsed = JSON.parse(defaultUserConfigStr)
    expect(parsed).toEqual(DEFAULT_USER_CONFIG)
  })

  it('validates DEFAULT_USER_CONFIG against UserConfigSchema with mock env', () => {
    const mockEnv = {
      HELIUS_API_KEY: 'test-helius',
      LLM_BASE_URL: 'https://openrouter.ai/api/v1',
      LLM_API_KEY: 'test-llm',
      LLM_MODEL: 'test-model',
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_CHAT_ID: '123456',
      TELEGRAM_ALLOWED_USER_IDS: '123456',
      DEFAULT_AGENT_MERIDIAN_PUBLIC_KEY: 'test-key',
      GMGN_API_KEY: 'test-gmgn',
      JUPITER_API_KEY: 'test-jup',
    }

    const originalEnv = { ...process.env }
    Object.assign(process.env, mockEnv)

    try {
      const result = UserConfigSchema.safeParse(DEFAULT_USER_CONFIG)
      expect(result.success).toBe(true)
    } finally {
      process.env = originalEnv
    }
  })

  it('rejects unknown top-level keys (strict schema)', () => {
    const mockEnv = {
      HELIUS_API_KEY: 'test-helius',
      LLM_BASE_URL: 'https://openrouter.ai/api/v1',
      LLM_API_KEY: 'test-llm',
      LLM_MODEL: 'test-model',
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_CHAT_ID: '123456',
      TELEGRAM_ALLOWED_USER_IDS: '123456',
      DEFAULT_AGENT_MERIDIAN_PUBLIC_KEY: 'test-key',
      GMGN_API_KEY: 'test-gmgn',
      JUPITER_API_KEY: 'test-jup',
    }
    const originalEnv = { ...process.env }
    Object.assign(process.env, mockEnv)

    try {
      const configWithUnknown = { ...DEFAULT_USER_CONFIG, unknownTopLevelKey: 'should-fail' }
      const result = UserConfigSchema.safeParse(configWithUnknown)
      expect(result.success).toBe(false)
      if (!result.success) {
        const unrecognizedIssue = result.error.issues.find(
          (i: any) => i.code === 'unrecognized_keys' && Array.isArray(i.keys) && i.keys.includes('unknownTopLevelKey'),
        )
        expect(unrecognizedIssue).toBeDefined()
      }
    } finally {
      process.env = originalEnv
    }
  })

  it('rejects unknown nested keys inside a section (strict schema)', () => {
    const mockEnv = {
      HELIUS_API_KEY: 'test-helius',
      LLM_BASE_URL: 'https://openrouter.ai/api/v1',
      LLM_API_KEY: 'test-llm',
      LLM_MODEL: 'test-model',
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_CHAT_ID: '123456',
      TELEGRAM_ALLOWED_USER_IDS: '123456',
      DEFAULT_AGENT_MERIDIAN_PUBLIC_KEY: 'test-key',
      GMGN_API_KEY: 'test-gmgn',
      JUPITER_API_KEY: 'test-jup',
    }
    const originalEnv = { ...process.env }
    Object.assign(process.env, mockEnv)

    try {
      const configWithUnknownNested = {
        ...DEFAULT_USER_CONFIG,
        risk: {
          ...DEFAULT_USER_CONFIG.risk,
          unknownRiskField: 99,
        },
      }
      const result = UserConfigSchema.safeParse(configWithUnknownNested)
      expect(result.success).toBe(false)
      if (!result.success) {
        const unrecognizedIssue = result.error.issues.find(
          (i: any) => i.code === 'unrecognized_keys' && Array.isArray(i.keys) && i.keys.includes('unknownRiskField'),
        )
        expect(unrecognizedIssue).toBeDefined()
      }
    } finally {
      process.env = originalEnv
    }
  })

  describe('resetConfig helper', () => {
    it('resets in-memory config singleton and keeps object reference identical', async () => {
      const { config, resetConfig } = await import('./Config.js')
      const originalTimeframe = config.screening.timeframe

      // Temporarily mutate in place
      config.screening.timeframe = '1h'
      expect(config.screening.timeframe).toBe('1h')

      // Call resetConfig to reload
      const res = resetConfig()
      expect(res).toBe(config)
      expect(config.screening.timeframe).toBe(originalTimeframe)
    })
  })

  describe('legacy RPC migration', () => {
    const originalEnv = { ...process.env }
    const originalUserConfigPath = process.env.USER_CONFIG_PATH

    afterEach(() => {
      process.env = { ...originalEnv }
      if (originalUserConfigPath) {
        process.env.USER_CONFIG_PATH = originalUserConfigPath
      } else {
        delete process.env.USER_CONFIG_PATH
      }
    })

    it('migrates legacy hardcoded primary RPC to .env value when they differ', async () => {
      const { loadAndValidateConfig } = await import('./ConfigValidator.js')
      const tmpPath = `/tmp/etemaro-test-config-${Date.now()}.json`
      const fullConfig = JSON.parse(defaultUserConfigStr)
      fullConfig.connection.rpcUrl = 'https://pump.helius-rpc.com'
      fullConfig.pnl = { ...(fullConfig.pnl || {}), source: 'rpc', rpcUrl: 'https://pump.helius-rpc.com' }
      fs.writeFileSync(tmpPath, JSON.stringify(fullConfig))
      process.env.USER_CONFIG_PATH = tmpPath
      process.env.RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=test-key'

      const result = loadAndValidateConfig()

      expect(result.connection?.rpcUrl).toBe('https://mainnet.helius-rpc.com/?api-key=test-key')
      expect(result.pnl?.rpcUrl).toBe('https://pump.helius-rpc.com')
    })

    it('does not migrate when .env RPC_URL matches legacy default', async () => {
      const { loadAndValidateConfig } = await import('./ConfigValidator.js')
      const tmpPath = `/tmp/etemaro-test-config-${Date.now()}.json`
      const fullConfig = JSON.parse(defaultUserConfigStr)
      fullConfig.connection.rpcUrl = 'https://pump.helius-rpc.com'
      fs.writeFileSync(tmpPath, JSON.stringify(fullConfig))
      process.env.USER_CONFIG_PATH = tmpPath
      process.env.RPC_URL = 'https://pump.helius-rpc.com'

      const result = loadAndValidateConfig()

      expect(result.connection?.rpcUrl).toBe('https://pump.helius-rpc.com')
    })

    it('does not migrate when .env RPC_URL is unset', async () => {
      const { loadAndValidateConfig } = await import('./ConfigValidator.js')
      const tmpPath = `/tmp/etemaro-test-config-${Date.now()}.json`
      const fullConfig = JSON.parse(defaultUserConfigStr)
      fullConfig.connection.rpcUrl = 'https://pump.helius-rpc.com'
      fs.writeFileSync(tmpPath, JSON.stringify(fullConfig))
      process.env.USER_CONFIG_PATH = tmpPath
      delete process.env.RPC_URL

      const result = loadAndValidateConfig()

      expect(result.connection?.rpcUrl).toBe('https://pump.helius-rpc.com')
    })
  })

  describe('direct model configuration and formatConfigLoadError', () => {
    it('resolves direct model without requiring LLM_MODEL env var', async () => {
      const { UserConfigSchema } = await import('./schema.js')
      const baseConfig = JSON.parse(defaultUserConfigStr)
      baseConfig.llm.defaultModel = 'anthropic/claude-3.5-sonnet'
      // Set role models to reference an unset env var
      baseConfig.llm.managementModel = 'env.UNSET_LLM_MODEL'
      baseConfig.llm.screeningModel = 'env.UNSET_LLM_MODEL'
      baseConfig.llm.generalModel = 'env.UNSET_LLM_MODEL'

      const parsed = UserConfigSchema.parse(baseConfig)
      expect(parsed.llm.defaultModel).toBe('anthropic/claude-3.5-sonnet')
      expect(parsed.llm.managementModel).toBe('anthropic/claude-3.5-sonnet')
      expect(parsed.llm.screeningModel).toBe('anthropic/claude-3.5-sonnet')
      expect(parsed.llm.generalModel).toBe('anthropic/claude-3.5-sonnet')
    })

    it('resolves model alias without requiring LLM_MODEL env var', async () => {
      const { UserConfigSchema } = await import('./schema.js')
      const baseConfig = JSON.parse(defaultUserConfigStr)
      delete baseConfig.llm.defaultModel
      baseConfig.llm.model = 'openai/gpt-4o'
      baseConfig.llm.managementModel = 'env.UNSET_LLM_MODEL'

      const parsed = UserConfigSchema.parse(baseConfig)
      expect(parsed.llm.defaultModel).toBe('openai/gpt-4o')
      expect(parsed.llm.managementModel).toBe('openai/gpt-4o')
    })

    it('formats config load error pointing to exact json file path and instructs user how to set env or edit directly', async () => {
      const { formatConfigLoadError } = await import('./formatConfigLoadError.js')
      const error = {
        name: 'ConfigLoadError',
        configPath: '/Users/r/test/user-config.json',
        issues: [
          {
            path: ['llm', 'defaultModel'],
            message: 'Environment variable LLM_MODEL is not set',
            params: { envVar: 'LLM_MODEL', ref: 'env.LLM_MODEL' },
          },
        ],
      }
      const output = formatConfigLoadError(error)
      expect(output).toContain('/Users/r/test/user-config.json')
      expect(output).toContain('Field "llm.defaultModel" requires environment variable: LLM_MODEL')
      expect(output).toContain('Set the environment variable in your .env file or system environment:')
      expect(output).toContain('LLM_MODEL=<value>')
      expect(output).toContain('OR update the value directly in your configuration file:')
      expect(output).toContain('/Users/r/test/user-config.json')
    })
  })
})
