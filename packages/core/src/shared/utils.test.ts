import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveJsonFile } from './utils.js'

vi.mock('./logger.js', () => ({
  log: vi.fn(),
  logStructured: vi.fn(),
}))

describe('saveJsonFile — atomicity', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'saveJsonFile-test-'))
  afterEach(() => {
    // Clean up any leftover tmp files in the directory
    for (const f of fs.readdirSync(tmpDir)) {
      fs.unlinkSync(path.join(tmpDir, f))
    }
  })

  it('writes a valid JSON file atomically (no leftover tmp on success)', () => {
    const target = path.join(tmpDir, 'atomic.json')
    saveJsonFile(target, { hello: 'world' })

    const content = fs.readFileSync(target, 'utf8')
    expect(JSON.parse(content)).toEqual({ hello: 'world' })

    // No stray .tmp files should remain
    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.tmp'))
    expect(files).toHaveLength(0)
  })

  it('does NOT overwrite the original file when fs.renameSync fails', () => {
    const target = path.join(tmpDir, 'rename-fail.json')
    // Seed original
    fs.writeFileSync(target, JSON.stringify({ original: true }))

    const spy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('simulated rename failure')
    })

    try {
      expect(() => saveJsonFile(target, { new: true })).toThrow('simulated rename failure')

      // Original file must still contain the old data
      const content = fs.readFileSync(target, 'utf8')
      expect(JSON.parse(content)).toEqual({ original: true })
    } finally {
      spy.mockRestore()
    }
  })

  it('cleans up the temp file when an error occurs', () => {
    const target = path.join(tmpDir, 'cleanup.json')

    const spy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('disk full')
    })

    try {
      expect(() => saveJsonFile(target, { data: 42 })).toThrow('disk full')

      // The temp file matching the pattern should NOT persist
      const tmpFiles = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.tmp'))
      expect(tmpFiles).toHaveLength(0)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('loadJsonFile — missing vs corrupt file handling', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loadJsonFile-test-'))

  afterEach(() => {
    for (const f of fs.readdirSync(tmpDir)) {
      fs.unlinkSync(path.join(tmpDir, f))
    }
  })

  it('returns fallback without throwing when file does not exist', async () => {
    const { loadJsonFile } = await import('./utils.js')
    const target = path.join(tmpDir, 'nonexistent.json')
    const result = loadJsonFile(target, { default: true })
    expect(result).toEqual({ default: true })
  })

  it('returns fallback and logs warning when file contains corrupt JSON', async () => {
    const { loadJsonFile } = await import('./utils.js')
    const target = path.join(tmpDir, 'corrupt.json')
    fs.writeFileSync(target, '{ bad json syntax !!!')

    const result = loadJsonFile(target, { fallback: 123 }, { label: 'test-corrupt' })
    expect(result).toEqual({ fallback: 123 })
  })

  it('throws error when file contains corrupt JSON and critical: true', async () => {
    const { loadJsonFile } = await import('./utils.js')
    const target = path.join(tmpDir, 'corrupt-critical.json')
    fs.writeFileSync(target, '{ broken json')

    expect(() => loadJsonFile(target, { fallback: true }, { label: 'state', critical: true })).toThrowError(
      /Failed to parse JSON file at.*Critical file corrupted/,
    )
  })

  it('backs up a corrupt file when backupOnCorrupt is true', async () => {
    const { loadJsonFile } = await import('./utils.js')
    const target = path.join(tmpDir, 'corrupt-backup.json')
    fs.writeFileSync(target, '{ bad json syntax !!!')

    const result = loadJsonFile(target, { fallback: 1 }, { label: 'pool-memory', backupOnCorrupt: true })
    expect(result).toEqual({ fallback: 1 })
    expect(fs.existsSync(target)).toBe(false)
    const backups = fs.readdirSync(tmpDir).filter((f) => f.startsWith('corrupt-backup.json.corrupt-'))
    expect(backups).toHaveLength(1)
    expect(fs.readFileSync(path.join(tmpDir, backups[0]!), 'utf8')).toContain('bad json syntax')
  })

  it('correctly parses and returns valid JSON', async () => {
    const { loadJsonFile } = await import('./utils.js')
    const target = path.join(tmpDir, 'valid.json')
    fs.writeFileSync(target, JSON.stringify({ success: true, count: 42 }))

    const result = loadJsonFile(target, { success: false })
    expect(result).toEqual({ success: true, count: 42 })
  })
})

describe('loadJsonFileWithInfo — detailed load tracking', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loadJsonFileWithInfo-test-'))

  afterEach(() => {
    for (const f of fs.readdirSync(tmpDir)) {
      fs.unlinkSync(path.join(tmpDir, f))
    }
  })

  it('returns fallback and loadedFrom: fallback when file does not exist', async () => {
    const { loadJsonFileWithInfo } = await import('./utils.js')
    const target = path.join(tmpDir, 'nonexistent.json')
    const result = loadJsonFileWithInfo(target, { fallback: true })

    expect(result.data).toEqual({ fallback: true })
    expect(result.loadedFrom).toBe('fallback')
    expect(result.filePath).toBe(target)
    expect(result.error).toBeUndefined()
  })

  it('returns fallback and captures error when file is corrupt JSON', async () => {
    const { loadJsonFileWithInfo } = await import('./utils.js')
    const target = path.join(tmpDir, 'corrupt.json')
    fs.writeFileSync(target, 'not valid json {{{')

    const result = loadJsonFileWithInfo(target, { defaultVal: 123 })
    expect(result.data).toEqual({ defaultVal: 123 })
    expect(result.loadedFrom).toBe('fallback')
    expect(result.filePath).toBe(target)
    expect(result.error).toBeDefined()
  })

  it('returns parsed data with loadedFrom: file when JSON is valid', async () => {
    const { loadJsonFileWithInfo } = await import('./utils.js')
    const target = path.join(tmpDir, 'valid.json')
    fs.writeFileSync(target, JSON.stringify({ wallets: ['walletA', 'walletB'] }))

    const result = loadJsonFileWithInfo<{ wallets: string[] }>(target, { wallets: [] })
    expect(result.data).toEqual({ wallets: ['walletA', 'walletB'] })
    expect(result.loadedFrom).toBe('file')
    expect(result.filePath).toBe(target)
    expect(result.error).toBeUndefined()
  })
})

describe('isTransientRpcError', () => {
  it('identifies rate limits as transient', async () => {
    const { isTransientRpcError } = await import('./utils.js')
    expect(isTransientRpcError(new Error('HTTP 429 Too Many Requests'))).toBe(true)
    expect(isTransientRpcError(new Error('Rate limit exceeded'))).toBe(true)
    expect(isTransientRpcError({ status: 429 })).toBe(true)
  })

  it('identifies server errors as transient', async () => {
    const { isTransientRpcError } = await import('./utils.js')
    expect(isTransientRpcError(new Error('503 Service Unavailable'))).toBe(true)
    expect(isTransientRpcError(new Error('502 Bad Gateway'))).toBe(true)
    expect(isTransientRpcError(new Error('504 Gateway Timeout'))).toBe(true)
    expect(isTransientRpcError(new Error('Solana node is behind by 100 slots (-32005)'))).toBe(true)
  })

  it('identifies network failures as transient', async () => {
    const { isTransientRpcError } = await import('./utils.js')
    expect(isTransientRpcError(new Error('read ECONNRESET'))).toBe(true)
    expect(isTransientRpcError(new Error('ETIMEDOUT'))).toBe(true)
    expect(isTransientRpcError(new Error('socket hang up'))).toBe(true)
    expect(isTransientRpcError(new Error('fetch failed'))).toBe(true)
    expect(isTransientRpcError(new Error('Transaction simulation failed: blockhash not found'))).toBe(true)
  })

  it('identifies non-transient domain errors as non-retryable', async () => {
    const { isTransientRpcError } = await import('./utils.js')
    expect(isTransientRpcError(new Error('Invalid public key'))).toBe(false)
    expect(isTransientRpcError(new Error('Insufficient balance'))).toBe(false)
    expect(isTransientRpcError(new Error('private key not set'))).toBe(false)
    expect(isTransientRpcError(null)).toBe(false)
  })
})

describe('withRpcRetry', () => {
  it('returns result immediately on first attempt success', async () => {
    const { withRpcRetry } = await import('./utils.js')
    const fn = vi.fn().mockResolvedValue('success')

    const result = await withRpcRetry(fn, { maxRetries: 3 })
    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on transient failure and resolves when subsequent attempt succeeds', async () => {
    const { withRpcRetry } = await import('./utils.js')
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('HTTP 429 Too Many Requests'))
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce('eventual success')

    const onRetry = vi.fn()
    const result = await withRpcRetry(fn, {
      maxRetries: 3,
      initialDelayMs: 1,
      maxDelayMs: 5,
      jitter: false,
      onRetry,
    })

    expect(result).toBe('eventual success')
    expect(fn).toHaveBeenCalledTimes(3)
    expect(onRetry).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenNthCalledWith(1, expect.any(Error), 1, 1)
    expect(onRetry).toHaveBeenNthCalledWith(2, expect.any(Error), 2, 2)
  })

  it('rethrows error when maxRetries is exhausted', async () => {
    const { withRpcRetry } = await import('./utils.js')
    const fn = vi.fn().mockRejectedValue(new Error('503 Service Unavailable'))

    const onRetry = vi.fn()
    await expect(
      withRpcRetry(fn, {
        maxRetries: 2,
        initialDelayMs: 1,
        maxDelayMs: 5,
        jitter: false,
        onRetry,
      }),
    ).rejects.toThrow('503 Service Unavailable')

    expect(fn).toHaveBeenCalledTimes(3) // attempt 0 + 2 retries
    expect(onRetry).toHaveBeenCalledTimes(2)
  })

  it('immediately throws without retry when error is non-retryable', async () => {
    const { withRpcRetry } = await import('./utils.js')
    const fn = vi.fn().mockRejectedValue(new Error('Invalid public key format'))

    const onRetry = vi.fn()
    await expect(
      withRpcRetry(fn, {
        maxRetries: 3,
        initialDelayMs: 1,
        onRetry,
      }),
    ).rejects.toThrow('Invalid public key format')

    expect(fn).toHaveBeenCalledTimes(1)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('respects custom isRetryable predicate', async () => {
    const { withRpcRetry } = await import('./utils.js')
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('CUSTOM_RETRYABLE_ERROR'))
      .mockResolvedValueOnce('custom success')

    const result = await withRpcRetry(fn, {
      maxRetries: 2,
      initialDelayMs: 1,
      isRetryable: (err: any) => err.message.includes('CUSTOM_RETRYABLE'),
    })

    expect(result).toBe('custom success')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('honours a Retry-After hint when respectRetryAfter is set', async () => {
    vi.useFakeTimers()
    try {
      const { withRpcRetry } = await import('./utils.js')
      const rateLimited: any = new Error('Portfolio API 429: Too many requests')
      rateLimited.status = 429
      rateLimited.retryAfterMs = 750
      const fn = vi.fn().mockRejectedValueOnce(rateLimited).mockResolvedValueOnce('recovered')

      const onRetry = vi.fn()
      const promise = withRpcRetry(fn, {
        maxRetries: 2,
        initialDelayMs: 1,
        maxDelayMs: 100,
        jitter: false,
        respectRetryAfter: true,
        onRetry,
      })
      await vi.advanceTimersByTimeAsync(5000)
      await promise

      expect(onRetry).toHaveBeenCalledTimes(1)
      // Backoff would be 1ms; the server hint wins.
      expect(onRetry.mock.calls[0]?.[2]).toBe(750)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores a Retry-After hint unless respectRetryAfter is set', async () => {
    const { withRpcRetry } = await import('./utils.js')
    const rateLimited: any = new Error('Portfolio API 429: Too many requests')
    rateLimited.status = 429
    rateLimited.retryAfterMs = 750
    const fn = vi.fn().mockRejectedValueOnce(rateLimited).mockResolvedValueOnce('recovered')

    const onRetry = vi.fn()
    await withRpcRetry(fn, {
      maxRetries: 2,
      initialDelayMs: 1,
      maxDelayMs: 100,
      jitter: false,
      onRetry,
    })

    expect(onRetry.mock.calls[0]?.[2]).toBe(1)
  })

  it('caps an absurd Retry-After hint instead of sleeping for it', async () => {
    vi.useFakeTimers()
    try {
      const { withRpcRetry } = await import('./utils.js')
      const rateLimited: any = new Error('Portfolio API 429: Too many requests')
      rateLimited.status = 429
      rateLimited.retryAfterMs = 60 * 60 * 1000
      const fn = vi.fn().mockRejectedValueOnce(rateLimited).mockResolvedValueOnce('recovered')

      const onRetry = vi.fn()
      const promise = withRpcRetry(fn, {
        maxRetries: 2,
        initialDelayMs: 1,
        maxDelayMs: 100,
        jitter: false,
        respectRetryAfter: true,
        onRetry,
      })
      await vi.advanceTimersByTimeAsync(60_000)
      await promise

      expect(onRetry.mock.calls[0]?.[2]).toBe(10_000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('logs retries under a custom tag so HTTP retries are not reported as RPC failures', async () => {
    const { withRpcRetry } = await import('./utils.js')
    const { log } = await import('./logger.js')
    const fn = vi.fn().mockRejectedValueOnce(new Error('503 Service Unavailable')).mockResolvedValueOnce('ok')

    await withRpcRetry(fn, {
      maxRetries: 1,
      initialDelayMs: 1,
      jitter: false,
      logTag: 'positions_warn',
      label: 'Meteora portfolio API',
    })

    expect(vi.mocked(log)).toHaveBeenCalledWith('positions_warn', expect.stringContaining('Meteora portfolio API'))
    const logged = vi.mocked(log).mock.calls.map((call) => String(call[1]))
    expect(logged.some((message) => message.includes('RPC call failed'))).toBe(false)
  })
})
