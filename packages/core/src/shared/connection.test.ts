import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { config } from '../config/Config.js';
import {
  getConnection,
  getRpcUrl,
  getWalletAddress,
  getWalletKeypair,
  hasFallbackRpc,
  resetConnectionState,
  withRpcFailover,
} from './connection.js';

describe('connection module', () => {
  const originalEnv = { ...process.env };
  const originalConnectionConfig = { ...config.connection };

  beforeEach(() => {
    resetConnectionState();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    config.connection = { ...originalConnectionConfig };
    resetConnectionState();
  });

  describe('getRpcUrl and getConnection', () => {
    it('returns primary RPC URL from config.connection.rpcUrl', () => {
      config.connection = {
        ...config.connection,
        rpcUrl: 'https://primary-test.solana.com',
      };

      expect(getRpcUrl(false)).toBe('https://primary-test.solana.com');
      const conn = getConnection(false);
      expect(conn.rpcEndpoint).toBe('https://primary-test.solana.com');
    });

    it('returns fallback RPC URL from config.connection.rpcUrl2 when fallback is true', () => {
      config.connection = {
        ...config.connection,
        rpcUrl: 'https://primary-test.solana.com',
        rpcUrl2: 'https://fallback-test.solana.com',
      };

      expect(getRpcUrl(true)).toBe('https://fallback-test.solana.com');
      const fallbackConn = getConnection(true);
      expect(fallbackConn.rpcEndpoint).toBe('https://fallback-test.solana.com');
    });

    it('falls back to primary RPC when rpcUrl2 is not set', () => {
      config.connection = {
        ...config.connection,
        rpcUrl: 'https://primary-only.solana.com',
        rpcUrl2: null,
      };
      delete process.env.RPC_URL_2;

      expect(getRpcUrl(true)).toBe('https://primary-only.solana.com');
    });
  });

  describe('getWalletKeypair and getWalletAddress', () => {
    it('resolves wallet from config.connection.walletPrivateKey', () => {
      const kp = Keypair.generate();
      config.connection = {
        ...config.connection,
        walletPrivateKey: bs58.encode(kp.secretKey),
      };

      const resolved = getWalletKeypair();
      expect(resolved.publicKey.toString()).toBe(kp.publicKey.toString());
      expect(getWalletAddress()).toBe(kp.publicKey.toString());
    });

    it('resolves wallet from WALLET_PRIVATE_KEY when config is not set', () => {
      const kp = Keypair.generate();
      delete config.connection?.walletPrivateKey;
      process.env.WALLET_PRIVATE_KEY = bs58.encode(kp.secretKey);

      const resolved = getWalletKeypair();
      expect(resolved.publicKey.toString()).toBe(kp.publicKey.toString());
      expect(getWalletAddress()).toBe(kp.publicKey.toString());
    });

    it('returns null for getWalletAddress when unconfigured', () => {
      delete config.connection?.walletPrivateKey;
      delete process.env.WALLET_PRIVATE_KEY;

      expect(getWalletAddress()).toBeNull();
      expect(() => getWalletKeypair()).toThrow(/Wallet private key is not configured/);
    });
  });

  describe('hasFallbackRpc and withRpcFailover', () => {
    it('detects when fallback RPC is configured vs not configured', () => {
      config.connection = { ...config.connection, rpcUrl2: null };
      delete process.env.RPC_URL_2;
      expect(hasFallbackRpc()).toBe(false);

      config.connection = { ...config.connection, rpcUrl2: 'https://fallback.solana.com' };
      expect(hasFallbackRpc()).toBe(true);
    });

    it('withRpcFailover succeeds on primary RPC when no error occurs', async () => {
      config.connection = {
        ...config.connection,
        rpcUrl: 'https://primary.solana.com',
        rpcUrl2: 'https://fallback.solana.com',
      };

      const result = await withRpcFailover(async (conn) => {
        expect(conn.rpcEndpoint).toBe('https://primary.solana.com');
        return 'primary-success';
      });

      expect(result).toBe('primary-success');
    });

    it('withRpcFailover fails over to fallback RPC on transient 429 error', async () => {
      config.connection = {
        ...config.connection,
        rpcUrl: 'https://primary.solana.com',
        rpcUrl2: 'https://fallback.solana.com',
      };

      let attempts = 0;
      const result = await withRpcFailover(
        async (conn) => {
          attempts++;
          if (conn.rpcEndpoint === 'https://primary.solana.com') {
            throw new Error('429 Too Many Requests: rate limit exceeded');
          }
          expect(conn.rpcEndpoint).toBe('https://fallback.solana.com');
          return 'fallback-success';
        },
        { initialDelayMs: 1, maxRetries: 1 },
      );

      expect(result).toBe('fallback-success');
      expect(attempts).toBeGreaterThan(1);
    });

    it('withRpcFailover does not catch non-transient errors', async () => {
      config.connection = {
        ...config.connection,
        rpcUrl: 'https://primary.solana.com',
        rpcUrl2: 'https://fallback.solana.com',
      };

      await expect(
        withRpcFailover(async () => {
          throw new Error('Invalid account public key');
        }),
      ).rejects.toThrow('Invalid account public key');
    });
  });
});
