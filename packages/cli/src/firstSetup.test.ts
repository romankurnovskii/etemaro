import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assessSetup,
  formatInitMessage,
  loadRuntimeDotenv,
  maybePromptSecrets,
  parseEnvFile,
  upsertEnvVars,
  writeRuntimeSkeleton,
} from './firstSetup.js'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'etemaro-init-'))
}

describe('assessSetup', () => {
  it('is not ready when wallet and llm keys are missing', () => {
    const status = assessSetup({})
    expect(status.wallet).toBe(false)
    expect(status.llm).toBe(false)
    expect(status.readyForDryRun).toBe(false)
    expect(status.readyForLive).toBe(false)
  })

  it('treats blank and env-ref values as missing', () => {
    const status = assessSetup({
      WALLET_PRIVATE_KEY: '  ',
      LLM_API_KEY: 'env.LLM_API_KEY',
      JUPITER_API_KEY: '""',
    })
    expect(status.wallet).toBe(false)
    expect(status.llm).toBe(false)
    expect(status.jupiter).toBe(false)
  })

  it('is ready for dry-run with only wallet and llm keys', () => {
    const status = assessSetup({
      WALLET_PRIVATE_KEY: 'base58wallet',
      LLM_API_KEY: 'sk-or-v1-test',
    })
    expect(status.readyForDryRun).toBe(true)
    expect(status.readyForLive).toBe(false)
    expect(status.jupiter).toBe(false)
  })

  it('is ready for live when jupiter key is also set', () => {
    const status = assessSetup({
      WALLET_PRIVATE_KEY: 'base58wallet',
      LLM_API_KEY: 'sk-or-v1-test',
      JUPITER_API_KEY: 'jup-key',
    })
    expect(status.readyForLive).toBe(true)
  })
})

describe('formatInitMessage', () => {
  it('prints a first-time setup banner and the next command', () => {
    const text = formatInitMessage({
      directory: '/tmp/etemaro',
      firstRun: true,
      status: assessSetup({}),
    })
    expect(text).toContain('first-time setup')
    expect(text).toContain('/tmp/etemaro')
    expect(text).toContain('Wallet')
    expect(text).toContain('LLM')
    expect(text).toContain('etemaro start --dry-run')
  })

  it('says setup is complete when dry-run creds are present', () => {
    const text = formatInitMessage({
      directory: '/tmp/etemaro',
      firstRun: false,
      status: assessSetup({
        WALLET_PRIVATE_KEY: 'k',
        LLM_API_KEY: 'k',
      }),
    })
    expect(text).toContain('Setup complete')
    expect(text).toContain('etemaro start --dry-run')
    expect(text).not.toContain('first-time setup')
  })
})

describe('writeRuntimeSkeleton', () => {
  it('creates .env, config, and data on a fresh directory', () => {
    const dir = tmpDir()
    const result = writeRuntimeSkeleton(dir, {
      defaultUserConfigStr: '{"_version":4}',
      defaultStrategies: [{ id: 'spot' }],
    })
    expect(result.env.created).toBe(true)
    expect(result.config.created).toBe(true)
    expect(fs.existsSync(path.join(dir, '.env'))).toBe(true)
    expect(fs.readFileSync(path.join(dir, '.env'), 'utf8')).toContain('WALLET_PRIVATE_KEY')
    expect(fs.existsSync(path.join(dir, 'config', 'user-config.json'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'data', 'strategy-library.shared.json'))).toBe(true)
  })

  it('does not overwrite an existing .env', () => {
    const dir = tmpDir()
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, '.env'), 'WALLET_PRIVATE_KEY="keep-me"\n')
    const result = writeRuntimeSkeleton(dir, {
      defaultUserConfigStr: '{}',
      defaultStrategies: [],
    })
    expect(result.env.created).toBe(false)
    expect(fs.readFileSync(path.join(dir, '.env'), 'utf8')).toContain('keep-me')
  })
})

describe('upsertEnvVars', () => {
  it('fills empty quoted values in place', () => {
    const next = upsertEnvVars('WALLET_PRIVATE_KEY=""\nLLM_API_KEY=""\n', {
      WALLET_PRIVATE_KEY: 'abc',
    })
    expect(next).toContain('WALLET_PRIVATE_KEY="abc"')
    expect(next).toContain('LLM_API_KEY=""')
  })

  it('escapes backslashes before quotes so values round-trip', () => {
    const raw = 'a\\b"c'
    const next = upsertEnvVars('WALLET_PRIVATE_KEY=""\n', { WALLET_PRIVATE_KEY: raw })
    expect(next).toContain('WALLET_PRIVATE_KEY="a\\\\b\\"c"')
    expect(parseEnvFile(next).WALLET_PRIVATE_KEY).toBe(raw)
  })
})

describe('loadRuntimeDotenv', () => {
  it('loads home .env first, then cwd .env', () => {
    const dir = tmpDir()
    fs.writeFileSync(path.join(dir, '.env'), 'WALLET_PRIVATE_KEY="from-home"\n')
    const calls: Array<Record<string, unknown>> = []
    loadRuntimeDotenv(dir, (opts) => {
      calls.push(opts ?? {})
      return { parsed: {} } as any
    })
    expect(calls[0]).toEqual({ path: path.join(dir, '.env') })
    expect(calls[1]).toEqual({ override: true })
  })
})

describe('maybePromptSecrets', () => {
  it('prompts only for missing wallet and llm keys', async () => {
    const asked: string[] = []
    const updates = await maybePromptSecrets({
      interactive: true,
      status: assessSetup({}),
      ask: async (q) => {
        asked.push(q)
        if (q.toLowerCase().includes('wallet')) return 'wallet-key'
        if (q.toLowerCase().includes('llm')) return 'llm-key'
        return ''
      },
    })
    expect(asked).toHaveLength(2)
    expect(updates).toEqual({ WALLET_PRIVATE_KEY: 'wallet-key', LLM_API_KEY: 'llm-key' })
  })

  it('skips prompts when not interactive', async () => {
    const updates = await maybePromptSecrets({
      interactive: false,
      status: assessSetup({}),
      ask: async () => {
        throw new Error('should not prompt')
      },
    })
    expect(updates).toEqual({})
  })
})
