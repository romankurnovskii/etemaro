import fs from 'node:fs'
import { dataPath, LESSONS_FILENAME, wallet } from '@etemaro/core'
import { describe, expect, it, vi } from 'vitest'
import {
  applyCliRuntimeFlags,
  Cli,
  expandHome,
  formatConfigLoadError,
  loadCore,
  resolveGlobalFlagValue,
  resolveWalletImportSource,
} from './Cli.js'

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
      const writtenContent = JSON.parse(writeSpy.mock.calls[0]?.[1] as string)
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

describe('Cli handleAttach', () => {
  it('dispatches to handleAttach when attach subcommand is passed', async () => {
    await loadCore()
    const adapters: any = { domain: {}, wallet: {}, meteora: {}, screening: {} }
    const cli = new Cli(adapters)
    const attachSpy = vi.spyOn(cli as any, 'handleAttach').mockResolvedValue(undefined)

    await cli.run(['attach', '--agent', 'custom-agent', '--port', '9999'])
    expect(attachSpy).toHaveBeenCalledOnce()
    expect(attachSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'custom-agent',
        port: '9999',
      }),
    )
  })
})

describe('Cli handleStart', () => {
  it('dispatches to daemon.start({ tty: false }) in headless mode', async () => {
    await loadCore()
    const mockDaemon = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    }
    const adapters: any = { domain: {}, wallet: {}, meteora: {}, screening: {}, daemon: mockDaemon }
    const cli = new Cli(adapters)

    await cli.run(['start', '--headless'])
    expect(mockDaemon.start).toHaveBeenCalledWith({ tty: false })
  })
})

describe('Cli handleGenerateWallet', () => {
  it('calls wallet.generateNewWallet and reports correct savedTo path', async () => {
    await loadCore()
    const generateSpy = vi.spyOn(wallet, 'generateNewWallet').mockReturnValue({
      publicKey: 'mockPubKey123',
      privateKey: 'mockPrivKey456',
      createdAt: new Date().toISOString(),
      label: 'my-wallet',
      savedTo: '/path/to/.credentials/wallets/my-wallet.json',
    })
    const cli = new Cli({} as any)
    let stdoutOutput = ''
    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any)
    const mockStdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdoutOutput += String(chunk)
      return true
    })

    try {
      ;(cli as any).handleGenerateWallet({ name: 'my-wallet' })
      expect(generateSpy).toHaveBeenCalledWith({ label: 'my-wallet' })
      const parsed = JSON.parse(stdoutOutput)
      expect(parsed.success).toBe(true)
      expect(parsed.savedTo).toBe('/path/to/.credentials/wallets/my-wallet.json')
      expect(parsed.label).toBe('my-wallet')
    } finally {
      generateSpy.mockRestore()
      mockExit.mockRestore()
      mockStdout.mockRestore()
    }
  })
})

describe('Cli wallet commands', () => {
  it('captures --private-key as a string when importing (space-separated form)', async () => {
    await loadCore()
    const importSpy = vi.spyOn(wallet, 'importWallet').mockReturnValue({
      publicKey: 'mockPubKey',
      privateKey: 'KEY123',
      createdAt: new Date().toISOString(),
      label: 'alice',
      savedTo: '/tmp/alice.json',
    } as any)
    const cli = new Cli({} as any)
    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any)
    const mockStdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const mockSkill = vi.spyOn(cli as any, 'writeSkillMd').mockImplementation(() => {})

    try {
      await cli.run(['wallet', 'import', '--name', 'alice', '--private-key', 'KEY123'])
      expect(importSpy).toHaveBeenCalledWith({ label: 'alice', privateKey: 'KEY123', filePath: undefined })
    } finally {
      importSpy.mockRestore()
      mockExit.mockRestore()
      mockStdout.mockRestore()
      mockSkill.mockRestore()
    }
  })

  it('refuses wallet remove without --yes when stdout is not a TTY', async () => {
    await loadCore()
    const cli = new Cli({} as any)
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation((() => {}) as any)
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as any)
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const originalIsTTY = process.stdout.isTTY
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true, writable: true })

    try {
      await expect((cli as any).handleWalletRemove({ name: 'doomed' })).rejects.toThrow('exit:1')
      expect(unlinkSpy).not.toHaveBeenCalled()
      expect(stderrSpy.mock.calls.flat().join('')).toContain('Refusing to delete')
    } finally {
      existsSpy.mockRestore()
      unlinkSpy.mockRestore()
      mockExit.mockRestore()
      stderrSpy.mockRestore()
      Object.defineProperty(process.stdout, 'isTTY', {
        value: originalIsTTY,
        configurable: true,
        writable: true,
      })
    }
  })

  it('deletes every matching keystore file with --yes', async () => {
    await loadCore()
    const cli = new Cli({} as any)
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation((() => {}) as any)
    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any)
    const mockStdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    try {
      await (cli as any).handleWalletRemove({ name: 'gone', yes: true })
      expect(unlinkSpy).toHaveBeenCalledTimes(2)
    } finally {
      existsSpy.mockRestore()
      unlinkSpy.mockRestore()
      mockExit.mockRestore()
      mockStdout.mockRestore()
    }
  })

  it('omits the private key unless --show-private-key is passed', async () => {
    await loadCore()
    const generateSpy = vi.spyOn(wallet, 'generateNewWallet').mockReturnValue({
      publicKey: 'pub',
      privateKey: 'secret-priv',
      createdAt: new Date().toISOString(),
      label: 'w',
      savedTo: '/tmp/w.json',
    } as any)
    const cli = new Cli({} as any)
    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any)
    let printed = ''
    const mockStdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      printed += String(chunk)
      return true
    })

    try {
      ;(cli as any).handleGenerateWallet({ name: 'w' })
      expect(JSON.parse(printed).privateKey).toBeUndefined()

      printed = ''
      ;(cli as any).handleGenerateWallet({ name: 'w', 'show-private-key': true })
      expect(JSON.parse(printed).privateKey).toBe('secret-priv')
    } finally {
      generateSpy.mockRestore()
      mockExit.mockRestore()
      mockStdout.mockRestore()
    }
  })
})

describe('resolveWalletImportSource', () => {
  const collector = (answers: string[]) => {
    const asked: string[] = []
    const ask = async (question: string) => {
      asked.push(question)
      return answers.shift() ?? ''
    }
    return { asked, ask }
  }

  it('asks for alias, then source, then file path', async () => {
    const { asked, ask } = collector(['my-wallet', '1', '~/key.json'])
    const result = await resolveWalletImportSource({ usePrompt: false }, ask)
    expect(result).toEqual({ alias: 'my-wallet', filePath: '~/key.json', usePrompt: false })
    expect(asked[1]).toMatch(/Import from/)
  })

  it('defaults to the private-key prompt when the choice is empty', async () => {
    const { ask } = collector(['wallet-1', ''])
    const result = await resolveWalletImportSource({ usePrompt: false }, ask)
    expect(result.alias).toBe('wallet-1')
    expect(result.usePrompt).toBe(true)
  })

  it('selects the file branch for "file" as well as "1"', async () => {
    const { ask } = collector(['w', 'file', '/tmp/k.json'])
    const result = await resolveWalletImportSource({ usePrompt: false }, ask)
    expect(result.filePath).toBe('/tmp/k.json')
  })

  it('does not ask when alias and source are already supplied', async () => {
    const ask = vi.fn()
    const result = await resolveWalletImportSource({ alias: 'a', filePath: '/tmp/k.json', usePrompt: false }, ask)
    expect(ask).not.toHaveBeenCalled()
    expect(result).toEqual({ alias: 'a', filePath: '/tmp/k.json', usePrompt: false })
  })

  it('asks only for the alias when the source is already supplied', async () => {
    const { asked, ask } = collector(['a'])
    const result = await resolveWalletImportSource({ usePrompt: true }, ask)
    expect(result).toEqual({ alias: 'a', usePrompt: true })
    expect(asked).toHaveLength(1)
  })
})

describe('expandHome', () => {
  it('expands a leading ~/', () => {
    const home = process.env.HOME || ''
    expect(expandHome('~/key.json')).toBe(`${home}/key.json`)
  })

  it('expands a bare ~', () => {
    expect(expandHome('~')).toBe(process.env.HOME || '~')
  })

  it('leaves other paths untouched', () => {
    expect(expandHome('/abs/key.json')).toBe('/abs/key.json')
  })
})
