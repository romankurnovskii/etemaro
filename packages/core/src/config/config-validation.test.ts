import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateConfigDocument, validateConfigFile } from './config-validation.js'
import { DEFAULT_USER_CONFIG } from './defaultUserConfig.js'

const base = DEFAULT_USER_CONFIG as any

describe('config-validation', () => {
  it('accepts a structurally valid config when env refs are optional', () => {
    const report = validateConfigDocument(base, { envOptional: true })
    expect(report.ok).toBe(true)
    expect(report.entries[0]?.status).toBe('VALID')
    expect(report.totals).toEqual({ checked: 1, valid: 1, invalid: 0 })
  })

  it('reports unknown top-level keys as errors and unused fields', () => {
    const report = validateConfigDocument({ ...base, madeUp: 1 }, { envOptional: true })
    expect(report.ok).toBe(false)
    expect(report.entries[0]?.unknownFields).toContain('madeUp')
  })

  it('reports unknown nested keys with dotted paths', () => {
    const report = validateConfigDocument({ ...base, risk: { ...base.risk, unknownRisk: 1 } }, { envOptional: true })
    expect(report.ok).toBe(false)
    expect(report.entries[0]?.unknownFields.some((k) => k.endsWith('unknownRisk'))).toBe(true)
  })

  it('treats unset env refs as errors by default and warnings with envOptional', () => {
    const doc = {
      ...base,
      connection: { ...base.connection, rpcUrl: 'env.__ETEMARO_VALIDATION_MISSING__' },
    }
    const strict = validateConfigDocument(doc, { envOptional: false })
    expect(strict.ok).toBe(false)
    expect(strict.entries[0]?.errors.join('\n')).toMatch(/Environment variable/)

    const lenient = validateConfigDocument(doc, { envOptional: true })
    expect(lenient.ok).toBe(true)
    expect(lenient.entries[0]?.warnings.join('\n')).toMatch(/Environment variable/)
  })

  it('reports invalid JSON from a file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-val-'))
    const file = path.join(dir, 'bad.json')
    fs.writeFileSync(file, '{ not json')
    const report = validateConfigFile(file, { envOptional: true })
    expect(report.ok).toBe(false)
    expect(report.parseError).toMatch(/invalid JSON/)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
