import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPnlConnection } from '../adapters/PnLAdapter.js'
import { config } from '../config/Config.js'
import {
  getConnection,
  getNamedConnection,
  getRpcUrl,
  getWalletAddress,
  getWalletKeypair,
  hasFallbackRpc,
  resetConnectionState,
  withRpcFailover,
} from './connection.js'

describe('connection module', () => {
  const originalEnv = { ...process.env }
  const originalConnectionConfig = { ...config.connection }
  const originalPnlConfig = { ...config.pnl }

  beforeEach(() => {
    resetConnectionState()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    config.connection = { ...originalConnectionConfig }
    config.pnl = { ...originalPnlConfig }
    resetConnectionState()
  })

  describe('getRpcUrl and getConnection', () => {
    it('returns primary RPC URL from config.connection.rpcUrl', () => {
      config.connection = {
        ...config.connection,
        rpcUrl: 'https://primary-test.solana.com',
      }

      expect(getRpcUrl(false)).toBe('https://primary-test.solana.com')
      const conn = getConnection(false)
      expect(conn.rpcEndpoint).toBe('https://primary-test.solana.com')
    })

    it('returns fallback RPC URL from config.connection.rpcUrl2 when fallback is true', () => {
      config.connection = {
        ...config.connection,
        rpcUrl: 'https://primary-test.solana.com',
        rpcUrl2: 'https://fallback-test.solana.com',
      }

      expect(getRpcUrl(true)).toBe('https://fallback-test.solana.com')
      const fallbackConn = getConnection(true)
      expect(fallbackConn.rpcEndpoint).toBe('https://fallback-test.solana.com')
    })

    it('falls back to primary RPC when rpcUrl2 is not set', () => {
      config.connection = {
        ...config.connection,
        rpcUrl: 'https://primary-only.solana.com',
        rpcUrl2: null,
      }
      delete process.env.RPC_URL_2

      expect(getRpcUrl(true)).toBe('https://primary-only.solana.com')
    })
  })

  describe('getNamedConnection', () => {
    it('caches and returns same Connection instance for same slot and URL', () => {
      const conn1 = getNamedConnection('custom-slot', 'https://custom-rpc.solana.com')
      const conn2 = getNamedConnection('custom-slot', 'https://custom-rpc.solana.com')
      expect(conn1).toBe(conn2)
      expect(conn1.rpcEndpoint).toBe('https://custom-rpc.solana.com')
    })

    it('recreates Connection instance when URL changes for the slot', () => {
      const conn1 = getNamedConnection('custom-slot', 'https://custom-rpc-1.solana.com')
      const conn2 = getNamedConnection('custom-slot', 'https://custom-rpc-2.solana.com')
      expect(conn1).not.toBe(conn2)
      expect(conn2.rpcEndpoint).toBe('https://custom-rpc-2.solana.com')
    })

    it('maintains isolated connections across different named slots', () => {
      const pnlConn = getNamedConnection('pnl', 'https://pnl.solana.com')
      const customConn = getNamedConnection('custom', 'https://custom.solana.com')
      expect(pnlConn).not.toBe(customConn)
      expect(pnlConn.rpcEndpoint).toBe('https://pnl.solana.com')
      expect(customConn.rpcEndpoint).toBe('https://custom.solana.com')
    })

    it('clears all cached named connections on resetConnectionState', () => {
      const conn1 = getNamedConnection('slot-a', 'https://slot-a.solana.com')
      resetConnectionState()
      const conn2 = getNamedConnection('slot-a', 'https://slot-a.solana.com')
      expect(conn1).not.toBe(conn2)
    })

    it('getPnlConnection delegates to pnl named slot with dynamic URL support', () => {
      config.pnl = { ...config.pnl, rpcUrl: 'https://helius-pnl.solana.com' }
      const conn1 = getPnlConnection()
      expect(conn1.rpcEndpoint).toBe('https://helius-pnl.solana.com')

      config.pnl = { ...config.pnl, rpcUrl: 'https://updated-helius-pnl.solana.com' }
      const conn2 = getPnlConnection()
      expect(conn2.rpcEndpoint).toBe('https://updated-helius-pnl.solana.com')
      expect(conn1).not.toBe(conn2)
    })
  })

  describe('getWalletKeypair and getWalletAddress', () => {
    it('resolves wallet from config.connection.walletPrivateKey', () => {
      const kp = Keypair.generate()
      config.connection = {
        ...config.connection,
        walletPrivateKey: bs58.encode(kp.secretKey),
      }

      const resolved = getWalletKeypair()
      expect(resolved.publicKey.toString()).toBe(kp.publicKey.toString())
      expect(getWalletAddress()).toBe(kp.publicKey.toString())
    })

    it('throws when config walletPrivateKey is absent even if env var is set (config-as-contract)', () => {
      const kp = Keypair.generate()
      delete config.connection?.walletPrivateKey
      process.env.WALLET_PRIVATE_KEY = bs58.encode(kp.secretKey)

      // Env var alone is no longer a fallback — key must come from config.connection.walletPrivateKey
      // (which is resolved from env.WALLET_PRIVATE_KEY at config load time via schema envString transform)
      expect(() => getWalletKeypair()).toThrow(/Wallet private key is not configured/)
    })

    it('returns null for getWalletAddress when unconfigured', () => {
      delete config.connection?.walletPrivateKey
      delete process.env.WALLET_PRIVATE_KEY

      expect(getWalletAddress()).toBeNull()
      expect(() => getWalletKeypair()).toThrow(/Wallet private key is not configured/)
    })
  })

  describe('hasFallbackRpc and withRpcFailover', () => {
    it('detects when fallback RPC is configured vs not configured', () => {
      config.connection = { ...config.connection, rpcUrl2: null }
      delete process.env.RPC_URL_2
      expect(hasFallbackRpc()).toBe(false)

      config.connection = { ...config.connection, rpcUrl2: 'https://fallback.solana.com' }
      expect(hasFallbackRpc()).toBe(true)
    })

    it('withRpcFailover succeeds on primary RPC when no error occurs', async () => {
      config.connection = {
        ...config.connection,
        rpcUrl: 'https://primary.solana.com',
        rpcUrl2: 'https://fallback.solana.com',
      }

      const result = await withRpcFailover(async (conn) => {
        expect(conn.rpcEndpoint).toBe('https://primary.solana.com')
        return 'primary-success'
      })

      expect(result).toBe('primary-success')
    })

    it('withRpcFailover fails over to fallback RPC on transient 429 error', async () => {
      config.connection = {
        ...config.connection,
        rpcUrl: 'https://primary.solana.com',
        rpcUrl2: 'https://fallback.solana.com',
      }

      let attempts = 0
      const result = await withRpcFailover(
        async (conn) => {
          attempts++
          if (conn.rpcEndpoint === 'https://primary.solana.com') {
            throw new Error('429 Too Many Requests: rate limit exceeded')
          }
          expect(conn.rpcEndpoint).toBe('https://fallback.solana.com')
          return 'fallback-success'
        },
        { initialDelayMs: 1, maxRetries: 1 },
      )

      expect(result).toBe('fallback-success')
      expect(attempts).toBeGreaterThan(1)
    })

    it('withRpcFailover does not catch non-transient errors', async () => {
      config.connection = {
        ...config.connection,
        rpcUrl: 'https://primary.solana.com',
        rpcUrl2: 'https://fallback.solana.com',
      }

      await expect(
        withRpcFailover(async () => {
          throw new Error('Invalid account public key')
        }),
      ).rejects.toThrow('Invalid account public key')
    })
  })
})
