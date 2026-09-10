import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  decryptKeystore,
  encryptKeystore,
  isEncryptedKeystore,
  readKeystoreFile,
  readKeystoreObject,
  writeKeystoreFile,
} from './keystore.js'

const wallet = { publicKey: 'PUB', privateKey: 'PRIVBASE58' }

describe('keystore encryption', () => {
  const original = process.env.ETEMARO_KEYSTORE_PASSPHRASE
  afterEach(() => {
    if (original === undefined) delete process.env.ETEMARO_KEYSTORE_PASSPHRASE
    else process.env.ETEMARO_KEYSTORE_PASSPHRASE = original
  })

  it('round-trips a private key through encrypt/decrypt', () => {
    const envelope = encryptKeystore(wallet, 'secret')
    expect(isEncryptedKeystore(envelope)).toBe(true)
    expect(JSON.stringify(envelope)).not.toContain('PRIVBASE58')
    expect(decryptKeystore(envelope, 'secret')).toEqual(wallet)
  })

  it('rejects the wrong passphrase', () => {
    const envelope = encryptKeystore(wallet, 'secret')
    expect(() => decryptKeystore(envelope, 'wrong')).toThrow()
  })

  it('reads plaintext keystores', () => {
    expect(readKeystoreObject({ publicKey: 'PUB', privateKey: 'PRIVBASE58' }, null)).toEqual(wallet)
  })

  it('requires the passphrase for encrypted keystores', () => {
    const envelope = encryptKeystore(wallet, 'secret')
    expect(() => readKeystoreObject(envelope, null)).toThrow(/ETEMARO_KEYSTORE_PASSPHRASE/)
    expect(readKeystoreObject(envelope, 'secret')).toEqual(wallet)
  })

  it('writes encrypted files when the passphrase is set', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystore-'))
    const file = path.join(dir, 'w.json')
    try {
      const result = writeKeystoreFile(file, wallet, 'secret')
      expect(result.encrypted).toBe(true)
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
      expect(raw.encrypted).toBe(true)
      expect(raw.privateKey).toBeUndefined()
      expect(readKeystoreFile(file, 'secret')).toEqual(wallet)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes plaintext files when no passphrase is set', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystore-'))
    const file = path.join(dir, 'w.json')
    try {
      const result = writeKeystoreFile(file, wallet, null)
      expect(result.encrypted).toBe(false)
      expect(JSON.parse(fs.readFileSync(file, 'utf8')).privateKey).toBe('PRIVBASE58')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
