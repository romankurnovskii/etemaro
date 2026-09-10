/**
 * @file TelegramAdapter.offset.test.ts
 * @description Unit tests for persisted Telegram getUpdates offset state.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readTelegramOffset, writeTelegramOffset } from './TelegramAdapter.js'

let dir: string
let file: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-offset-'))
  file = path.join(dir, 'telegram_offset.json')
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('Telegram offset persistence', () => {
  it('returns defaults for a missing file', () => {
    expect(readTelegramOffset(file)).toEqual({ offset: 0, seen: [] })
  })

  it('round-trips the offset and handled update ids', () => {
    writeTelegramOffset(file, { offset: 12345, seen: [1, 2, 3] })
    expect(readTelegramOffset(file)).toEqual({ offset: 12345, seen: [1, 2, 3] })
  })

  it('caps the seen list at 500 entries', () => {
    const seen = Array.from({ length: 600 }, (_v, i) => i)
    writeTelegramOffset(file, { offset: 600, seen })
    expect(readTelegramOffset(file).seen).toHaveLength(500)
    expect(readTelegramOffset(file).seen[0]).toBe(100)
  })
})
