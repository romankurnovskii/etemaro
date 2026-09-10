/**
 * @file keystore.ts
 * @description Encrypted wallet keystore helpers — the single place that reads and
 *   writes `.credentials/wallets/<alias>.json`.
 *
 * Storage format:
 * - Encrypted (preferred): `{ version, encrypted: true, cipher: "aes-256-gcm",
 *   kdf: "scrypt", publicKey, salt, iv, tag, ciphertext }` where `ciphertext` is the
 *   base58 private key encrypted with a key derived from
 *   `ETEMARO_KEYSTORE_PASSPHRASE`.
 * - Plaintext (legacy/fallback): `{ publicKey, privateKey }` at mode 0600.
 *
 * When the passphrase is set, new keys are encrypted at rest and plaintext files are
 * migrated on first read. When it is not set, writes stay plaintext with a warning so
 * local development and existing installs keep working.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const KDF = 'scrypt' as const
const CIPHER = 'aes-256-gcm' as const
const KEY_LEN = 32
const SALT_LEN = 16
const IV_LEN = 12
// 128 * N * r = ~33.5 MB at N=2^15, r=8; raise maxmem accordingly.
const SCRYPT_OPTS = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const

export interface WalletKeystore {
  publicKey: string
  privateKey: string
}

export interface EncryptedKeystore {
  version: 1
  publicKey: string
  encrypted: true
  kdf: typeof KDF
  cipher: typeof CIPHER
  salt: string
  iv: string
  tag: string
  ciphertext: string
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Passphrase used to encrypt keystores, or null when not configured. */
export function getKeystorePassphrase(): string | null {
  const value = process.env.ETEMARO_KEYSTORE_PASSPHRASE?.trim()
  return value ? value : null
}

export function isKeystoreEncryptionEnabled(): boolean {
  return getKeystorePassphrase() !== null
}

export function isEncryptedKeystore(value: unknown): value is EncryptedKeystore {
  return (
    isObject(value) &&
    value.encrypted === true &&
    value.cipher === CIPHER &&
    typeof value.ciphertext === 'string' &&
    typeof value.iv === 'string' &&
    typeof value.salt === 'string' &&
    typeof value.tag === 'string'
  )
}

/** Encrypt a base58 private key into a self-describing envelope. */
export function encryptKeystore(wallet: WalletKeystore, passphrase: string): EncryptedKeystore {
  if (!wallet.privateKey) throw new Error('Cannot encrypt keystore: private key is empty')
  const salt = crypto.randomBytes(SALT_LEN)
  const iv = crypto.randomBytes(IV_LEN)
  const key = crypto.scryptSync(passphrase, salt, KEY_LEN, SCRYPT_OPTS)
  const cipher = crypto.createCipheriv(CIPHER, key, iv)
  const ciphertext = Buffer.concat([cipher.update(wallet.privateKey, 'utf8'), cipher.final()])
  return {
    version: 1,
    publicKey: wallet.publicKey,
    encrypted: true,
    kdf: KDF,
    cipher: CIPHER,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
}

/** Decrypt an envelope back into the base58 private key. */
export function decryptKeystore(envelope: EncryptedKeystore, passphrase: string): WalletKeystore {
  const salt = Buffer.from(envelope.salt, 'base64')
  const iv = Buffer.from(envelope.iv, 'base64')
  const key = crypto.scryptSync(passphrase, salt, KEY_LEN, SCRYPT_OPTS)
  const decipher = crypto.createDecipheriv(CIPHER, key, iv)
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  const privateKey = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8')
  return { publicKey: envelope.publicKey, privateKey }
}

/**
 * Normalise a parsed keystore document into `{ publicKey, privateKey }`.
 * Throws with an actionable message when the document is malformed or the
 * passphrase needed to decrypt it is missing/incorrect.
 */
export function readKeystoreObject(raw: unknown, passphrase: string | null = getKeystorePassphrase()): WalletKeystore {
  if (!isObject(raw)) {
    throw new Error(
      'Invalid keystore format: must be a JSON object with "publicKey" and "privateKey" (bare string or array format is not supported).',
    )
  }
  if (isEncryptedKeystore(raw)) {
    if (!passphrase) {
      throw new Error(
        'Wallet keystore is encrypted but ETEMARO_KEYSTORE_PASSPHRASE is not set. Set it to decrypt the wallet.',
      )
    }
    try {
      const wallet = decryptKeystore(raw, passphrase)
      if (!wallet.privateKey) throw new Error('decrypted private key is empty')
      return wallet
    } catch (err: any) {
      throw new Error(
        `Failed to decrypt encrypted wallet keystore (wrong ETEMARO_KEYSTORE_PASSPHRASE?): ${err?.message || err}`,
      )
    }
  }
  if (typeof raw.privateKey !== 'string' || raw.privateKey.trim().length === 0) {
    throw new Error('Missing mandatory "privateKey" in wallet keystore.')
  }
  return {
    publicKey: typeof raw.publicKey === 'string' ? raw.publicKey : '',
    privateKey: raw.privateKey.trim(),
  }
}

/** Read and normalise a keystore file (supports encrypted and plaintext formats). */
export function readKeystoreFile(
  filePath: string,
  passphrase: string | null = getKeystorePassphrase(),
): WalletKeystore {
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (err: any) {
    throw new Error(`Failed to parse wallet keystore file at ${filePath}: ${err?.message || err}`)
  }
  return readKeystoreObject(parsed, passphrase)
}

/** Write a keystore file, encrypting it when a passphrase is configured. */
export function writeKeystoreFile(
  filePath: string,
  wallet: WalletKeystore,
  passphrase: string | null = getKeystorePassphrase(),
): { encrypted: boolean } {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
  const payload: unknown = passphrase
    ? encryptKeystore(wallet, passphrase)
    : { publicKey: wallet.publicKey, privateKey: wallet.privateKey }
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), { mode: 0o600 })
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(filePath, 0o600)
    } catch {
      /* best effort */
    }
  }
  return { encrypted: Boolean(passphrase) }
}
