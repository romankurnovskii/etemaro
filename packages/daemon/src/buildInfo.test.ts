import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveBuildId } from './buildInfo.js'

describe('resolveBuildId', () => {
  let dir: string | null = null

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
    dir = null
  })

  it('reads the short SHA behind .git/HEAD', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buildid-'))
    fs.mkdirSync(path.join(dir, '.git', 'refs', 'heads'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n')
    fs.writeFileSync(path.join(dir, '.git', 'refs', 'heads', 'main'), 'abcdef1234567890abcdef1234567890abcdef12\n')
    expect(resolveBuildId(dir)).toBe('abcdef123456')
  })

  it('returns unknown outside a git worktree', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buildid-'))
    expect(resolveBuildId(dir)).toBe('unknown')
  })
})
