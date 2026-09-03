/**
 * @file connection.ts
 * @description Centralized Solana RPC connection and wallet manager.
 * Uses config.connection as the single source of truth with automatic RPC fallback support.
 */

import path from 'node:path'
import fs from 'node:fs'
import { Connection, Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { config } from '../config/Config.js'
import { etemaroHome } from './constants.js'
import { log } from './logger.js'
import { isTransientRpcError, type RpcRetryOptions, withRpcRetry } from './utils.js'

interface ConnectionSlot {
  conn: Connection
  url: string
}

const _connections = new Map<string, ConnectionSlot>()

let _walletKeypair: Keypair | null = null
let _walletPrivateKey: string | null = null

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
 * Reads private key from config.connection.walletPrivateKey with WALLET_PRIVATE_KEY fallback.
 */
export function getWalletKeypair(): Keypair {
  let key = config.connection?.walletPrivateKey

  // New: keystore alias support
  if (!key && config.connection?.wallet) {
    const alias = config.connection.wallet
    const walletPath = path.join(etemaroHome, '.credentials', 'wallets', `${alias}.json`)
    
    if (fs.existsSync(walletPath)) {
      try {
        // Enforce strict permissions on POSIX systems
        if (process.platform !== 'win32') {
          const stats = fs.statSync(walletPath)
          if ((stats.mode & 0o777) > 0o600) {
            try {
              fs.chmodSync(walletPath, 0o600)
            } catch (chmodErr) {
              throw new Error(
                `[wallet] FATAL: Insecure file permissions on ${walletPath} (0${(stats.mode & 0o777).toString(8)}). Must be 0600 (owner read/write only).`
              )
            }
          }
        }
        
        const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'))
        // Support both Base58 strings and Solana CLI JSON arrays
        if (Array.isArray(walletData)) {
          key = bs58.encode(Uint8Array.from(walletData))
        } else if (typeof walletData === 'string') {
          key = walletData
        } else if (walletData.privateKey) {
          key = walletData.privateKey
        }
      } catch (err) {
        log('wallet', `Failed to load wallet from keystore ${walletPath}: ${err}`)
      }
    }
  }

  if (!key) {
    throw new Error(
      'Wallet private key is not configured. Set connection.wallet (alias) or connection.walletPrivateKey in user-config.json.',
    )
  }
  if (!_walletKeypair || _walletPrivateKey !== key) {
    _walletKeypair = Keypair.fromSecretKey(bs58.decode(key))
    _walletPrivateKey = key
  }
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
    return withRpcRetry(() => fn(primaryConn), options)
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
  _walletPrivateKey = null
}
