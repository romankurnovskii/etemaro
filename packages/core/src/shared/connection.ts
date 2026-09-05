/**
 * @file connection.ts
 * @description Centralized Solana RPC connection and wallet manager.
 * Uses config.connection as the single source of truth with automatic RPC fallback support.
 */

import fs from 'node:fs'
import { Connection, Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { config } from '../config/Config.js'
import { credentialsPath } from './constants.js'
import { log } from './logger.js'
import { isTransientRpcError, type RpcRetryOptions, withRpcRetry } from './utils.js'

interface ConnectionSlot {
  conn: Connection
  url: string
}

const _connections = new Map<string, ConnectionSlot>()

let _walletKeypair: Keypair | null = null
let _walletAlias: string | null = null

/**
 * Returns the configured primary or fallback RPC URL.
 * Reads from config.connection only; env vars must be wired through config.
 */
export function getRpcUrl(fallback = false): string {
  if (fallback && config.connection?.rpcUrl2) {
    return config.connection.rpcUrl2
  }
  return config.connection?.rpcUrl || 'https://api.mainnet-beta.solana.com'
}

/**
 * Returns a cached Connection instance for a named slot and target RPC endpoint URL.
 * Dynamically re-initializes if the target URL changes.
 */
export function getNamedConnection(slot: string, rpcUrl?: string): Connection {
  const url = rpcUrl || getRpcUrl(slot === 'fallback')
  const cached = _connections.get(slot)
  if (!cached || cached.url !== url) {
    const conn = new Connection(url, 'confirmed')
    _connections.set(slot, { conn, url })
    return conn
  }
  return cached.conn
}

/**
 * Returns a cached Connection instance for primary or fallback RPC endpoint.
 * Dynamically re-initializes if configuration changes.
 */
export function getConnection(fallback = false): Connection {
  const slot = fallback ? 'fallback' : 'primary'
  const rpc = getRpcUrl(fallback)
  return getNamedConnection(slot, rpc)
}

/**
 * Returns the Keypair for the configured wallet.
 * Resolves the keypair from the secure keystore using config.connection.wallet alias.
 */
export function getWalletKeypair(): Keypair {
  if (_walletKeypair) {
    return _walletKeypair
  }

  const alias = config.connection?.wallet?.trim()
  if (!alias) {
    throw new Error('Wallet is not configured. Set connection.wallet (alias) in your configuration.')
  }

  const walletPath = credentialsPath(`${alias}.json`)
  if (!fs.existsSync(walletPath)) {
    throw new Error(
      `Wallet keystore not found for alias "${alias}" at ${walletPath}. Import or generate a wallet first (e.g. etemaro wallet import --name ${alias}).`,
    )
  }

  // Enforce strict permissions on POSIX systems
  if (process.platform !== 'win32') {
    const stats = fs.statSync(walletPath)
    if ((stats.mode & 0o777) > 0o600) {
      try {
        fs.chmodSync(walletPath, 0o600)
      } catch {
        throw new Error(
          `[wallet] FATAL: Insecure file permissions on ${walletPath} (0${(stats.mode & 0o777).toString(8)}). Must be 0600 (owner read/write only).`,
        )
      }
    }
  }

  let key: string | null = null
  try {
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'))
    if (typeof walletData !== 'object' || walletData === null || Array.isArray(walletData)) {
      throw new Error(
        `Invalid keystore format: must be a JSON object with "publicKey" and "privateKey" (bare string or array format is not supported).`,
      )
    }
    if (typeof walletData.privateKey !== 'string' || walletData.privateKey.trim().length === 0) {
      throw new Error(
        `Missing mandatory "privateKey" in wallet keystore file at ${walletPath}. Expected format: { "publicKey": "...", "privateKey": "..." }`,
      )
    }
    key = walletData.privateKey.trim()
  } catch (err: any) {
    throw new Error(`Failed to parse wallet keystore file at ${walletPath}: ${err?.message || err}`)
  }

  if (!key) {
    throw new Error(`Wallet keystore file at ${walletPath} does not contain a valid private key.`)
  }

  try {
    _walletKeypair = Keypair.fromSecretKey(bs58.decode(key))
  } catch (err: any) {
    throw new Error(`Invalid secret key in wallet keystore at ${walletPath}: ${err?.message || err}`)
  }

  _walletAlias = alias
  return _walletKeypair
}

/**
 * Returns the public key (base58) of the configured wallet, or null if unconfigured.
 */
export function getWalletAddress(): string | null {
  try {
    return getWalletKeypair().publicKey.toString()
  } catch {
    return null
  }
}

/**
 * Returns true if a fallback RPC URL is configured in config.
 */
export function hasFallbackRpc(): boolean {
  return Boolean(config.connection?.rpcUrl2)
}

/**
 * Executes an asynchronous RPC operation with automatic failover between primary and fallback RPC connections.
 * If the operation on the primary connection encounters a transient RPC error (429, timeout, 502/503/504),
 * it seamlessly switches to the fallback connection and retries with backoff.
 */
export async function withRpcFailover<T>(
  fn: (connection: Connection) => Promise<T>,
  options: RpcRetryOptions = {},
): Promise<T> {
  const primaryConn = getConnection(false)
  if (!hasFallbackRpc()) {
    try {
      return await withRpcRetry(() => fn(primaryConn), options)
    } catch (err) {
      if (isTransientRpcError(err)) {
        const errMessage = err instanceof Error ? err.message : String(err)
        const label = options.label ? ` [${options.label}]` : ''
        log(
          'rpc_warn',
          `Primary RPC failed${label} (${errMessage.slice(0, 100)}) — no fallback RPC configured (set connection.rpcUrl2 in user-config.json or RPC_URL_2 in .env to enable failover)`,
        )
      }
      throw err
    }
  }

  try {
    return await withRpcRetry(() => fn(primaryConn), {
      ...options,
      maxRetries: options.maxRetries ?? 2,
    })
  } catch (primaryErr) {
    if (isTransientRpcError(primaryErr)) {
      const fallbackConn = getConnection(true)
      const fallbackUrl = getRpcUrl(true)
      const errMessage = primaryErr instanceof Error ? primaryErr.message : String(primaryErr)
      const label = options.label ? ` [${options.label}]` : ''
      log(
        'rpc_warn',
        `Primary RPC failed${label} (${errMessage.slice(0, 100)}) — switching to fallback RPC: ${fallbackUrl}`,
      )
      return await withRpcRetry(() => fn(fallbackConn), {
        ...options,
        maxRetries: options.maxRetries ?? 2,
      })
    }
    throw primaryErr
  }
}

/**
 * Resets cached connection and wallet singletons (primarily used for test isolation).
 */
export function resetConnectionState(): void {
  _connections.clear()
  _walletKeypair = null
  _walletAlias = null
}

/**
 * Sets or overrides the active wallet keypair directly (used for test isolation).
 */
export function setWalletKeypair(kp: Keypair | null): void {
  _walletKeypair = kp
  _walletAlias = kp ? config.connection?.wallet || 'mock' : null
}
