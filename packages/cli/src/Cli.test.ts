import fs from 'node:fs'
import { dataPath, LESSONS_FILENAME } from '@etemaro/core'
import { describe, expect, it, vi } from 'vitest'
import { applyCliRuntimeFlags, Cli, formatConfigLoadError, loadCore, resolveGlobalFlagValue } from './Cli.js'

describe('resolveGlobalFlagValue', () => {
  it('returns the value following the long flag', () => {
    expect(resolveGlobalFlagValue(['--config', '/tmp/cfg.json'], '--config')).toBe('/tmp/cfg.json')
  })

  it('returns the value following an alias', () => {
    expect(resolveGlobalFlagValue(['-c', '/tmp/cfg.json'], '--config', '-c')).toBe('/tmp/cfg.json')
  })

  it('returns undefined when the flag is absent', () => {
    expect(resolveGlobalFlagValue(['balance', '--portal'], '--config', '-c')).toBeUndefined()
  })

  it('returns undefined when the flag has no following value', () => {
    expect(resolveGlobalFlagValue(['balance', '--config'], '--config')).toBeUndefined()
  })

  it('returns undefined when the following token is another flag', () => {
    expect(resolveGlobalFlagValue(['balance', '--config', '--dry-run'], '--config')).toBeUndefined()
  })

  it('extends forward to find the value past the subcommand', () => {
    expect(resolveGlobalFlagValue(['balance', '--data-dir', '/tmp/d'], '--data-dir', '-d')).toBe('/tmp/d')
  })
})

describe('applyCliRuntimeFlags', () => {
  it('sets DRY_RUN when --dry-run is present', () => {
    const env: Record<string, string | undefined> = {}
    applyCliRuntimeFlags({ 'dry-run': true }, env)
    expect(env.DRY_RUN).toBe('true')
  })

  it('does not set DRY_RUN when the flag is absent', () => {
    const env: Record<string, string | undefined> = { DRY_RUN: 'false' }
    applyCliRuntimeFlags({}, env)
    expect(env.DRY_RUN).toBe('false')
  })
})

describe('Cli handleEvolve', () => {
  it('reads performance data from dataPath(LESSONS_FILENAME)', async () => {
    await loadCore()

    const mockEvolveThresholds = vi.fn().mockReturnValue({ changes: { minTvl: 1000 }, rationale: 'better yield' })
    const adapters: any = {
      domain: {
        evolveThresholds: mockEvolveThresholds,
      },
    }

    const cli = new Cli(adapters)
    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any)
    const mockStdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    const lessonsPath = dataPath(LESSONS_FILENAME)
    const originalExists = fs.existsSync
    const originalReadFile = fs.readFileSync

    const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
      if (p === lessonsPath) return true
      return originalExists(p)
    })
    const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation((p, ...args) => {
      if (p === lessonsPath) {
        return JSON.stringify({ performance: [{ pnl_usd: 10 }] })
      }
      return originalReadFile(p, ...args)
    })

    try {
      ;(cli as any).handleEvolve()
      expect(mockEvolveThresholds).toHaveBeenCalledWith([{ pnl_usd: 10 }], expect.anything())
      expect(mockStdout).toHaveBeenCalled()
    } finally {
      mockExit.mockRestore()
      mockStdout.mockRestore()
      existsSpy.mockRestore()
      readSpy.mockRestore()
    }
  }, 15000)
})

describe('formatConfigLoadError', () => {
  it('formats error with exact config file path and tells user how to set env or edit json directly', () => {
    const error = {
      name: 'ConfigLoadError',
      configPath: '/custom/path/user-config.json',
      issues: [
        {
          path: ['llm', 'defaultModel'],
          message: 'Environment variable LLM_MODEL is not set but is referenced by configuration.',
          params: { envVar: 'LLM_MODEL', ref: 'env.LLM_MODEL' },
        },
        {
          path: ['connection', 'rpcUrl'],
          message: 'Environment variable RPC_URL is not set but is referenced by configuration.',
          params: { envVar: 'RPC_URL', ref: 'env.RPC_URL' },
        },
      ],
    }

    const output = formatConfigLoadError(error)
    expect(output).toContain('/custom/path/user-config.json')
    expect(output).toContain('Field "llm.defaultModel" requires environment variable: LLM_MODEL')
    expect(output).toContain('Field "connection.rpcUrl" requires environment variable: RPC_URL')
    expect(output).toContain('Set the environment variable in your .env file or system environment')
    expect(output).toContain('LLM_MODEL=<value>')
    expect(output).toContain('RPC_URL=<value>')
    expect(output).toContain('OR update the value directly in your configuration file:')
    expect(output).toContain('/custom/path/user-config.json')
  })

  it('formats additional schema errors alongside the config file path', () => {
    const error = {
      name: 'ConfigLoadError',
      configPath: '/path/user-config.json',
      issues: [
        {
          path: ['risk', 'maxPositions'],
          message: 'Expected number, received string',
        },
      ],
    }

    const output = formatConfigLoadError(error)
    expect(output).toContain('/path/user-config.json')
    expect(output).toContain('Field "risk.maxPositions": Expected number, received string')
  })
})

describe('Cli handleNewAgent', () => {
  it('scaffolds a new agent configuration with slugified id and creates directories', async () => {
    await loadCore()
    const adapters: any = { domain: {}, wallet: {}, meteora: {}, screening: {} }
    const cli = new Cli(adapters)

    let stdoutOutput = ''
    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any)
    const mockStdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdoutOutput += String(chunk)
      return true
    })

    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation((() => {}) as any)
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation((() => {}) as any)

    try {
      await (cli as any).handleNewAgent({
        name: 'Sol Scalper Alpha',
        desc: 'Fast 15m bid-ask scalper',
      })

      expect(mockExit).toHaveBeenCalledWith(0)
      const parsed = JSON.parse(stdoutOutput)
      expect(parsed.success).toBe(true)
      expect(parsed.name).toBe('Sol Scalper Alpha')
      expect(parsed.description).toBe('Fast 15m bid-ask scalper')
      expect(parsed.agentId).toBe('sol-scalper-alpha')
      expect(parsed.configFile).toContain('sol-scalper-alpha.json')
      expect(parsed.dataDir).toContain('instances/sol-scalper-alpha')

      // Verifies config file write
      expect(writeSpy).toHaveBeenCalled()
      const writtenContent = JSON.parse(writeSpy.mock.calls[0][1] as string)
      expect(writtenContent.name).toBe('Sol Scalper Alpha')
      expect(writtenContent.description).toBe('Fast 15m bid-ask scalper')
      expect(writtenContent.agentId).toBe('sol-scalper-alpha')

      // Verifies data directory creation
      expect(mkdirSpy).toHaveBeenCalledWith(expect.stringContaining('instances/sol-scalper-alpha/logs'), {
        recursive: true,
      })
    } finally {
      mockExit.mockRestore()
      mockStdout.mockRestore()
      mkdirSpy.mockRestore()
      writeSpy.mockRestore()
    }
  })

  it('honors explicit --id override flag', async () => {
    await loadCore()
    const adapters: any = { domain: {}, wallet: {}, meteora: {}, screening: {} }
    const cli = new Cli(adapters)

    let stdoutOutput = ''
    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any)
    const mockStdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdoutOutput += String(chunk)
      return true
    })
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation((() => {}) as any)
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation((() => {}) as any)

    try {
      await (cli as any).handleNewAgent({
        name: 'Custom Agent',
        id: 'custom_id_99',
      })

      const parsed = JSON.parse(stdoutOutput)
      expect(parsed.agentId).toBe('custom_id_99')
      expect(parsed.configFile).toContain('custom_id_99.json')
    } finally {
      mockExit.mockRestore()
      mockStdout.mockRestore()
      mkdirSpy.mockRestore()
      writeSpy.mockRestore()
    }
  })
})

