import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  generateNewWallet,
  WalletsStore,
  getWalletBalances,
  invalidateBalanceCache,
  BALANCE_CACHE_TTL,
  swapToken,
} from './WalletAdapter.js';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';

describe('WalletAdapter', () => {
  let tempDir: string;
  let testKeypair: Keypair;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etemaro-wallet-test-'));
    testKeypair = Keypair.generate();
    process.env.WALLET_PRIVATE_KEY = bs58.encode(testKeypair.secretKey);
    process.env.RPC_URL = 'https://api.mainnet-beta.solana.com';
    invalidateBalanceCache();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    invalidateBalanceCache();
  });

  describe('generateNewWallet', () => {
    it('generates a valid Solana keypair and saves it to wallets.json', () => {
      const result = generateNewWallet({
        configDir: tempDir,
        label: 'Test Generated Wallet',
      });

      expect(result).toBeDefined();
      expect(result.publicKey).toBeDefined();
      expect(result.privateKey).toBeDefined();
      expect(result.label).toBe('Test Generated Wallet');
      expect(typeof result.createdAt).toBe('string');

      // Verify public key is base58 string with correct length
      expect(result.publicKey.length).toBeGreaterThanOrEqual(32);

      // Verify private key can be decoded back to 64-byte keypair secret
      const decodedSecret = bs58.decode(result.privateKey);
      expect(decodedSecret.length).toBe(64);

      // Verify wallets.json was created and populated
      const targetFile = path.join(tempDir, 'wallets.json');
      expect(fs.existsSync(targetFile)).toBe(true);

      const store: WalletsStore = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
      expect(store.wallets).toHaveLength(1);
      expect(store.wallets[0]?.publicKey).toBe(result.publicKey);
      expect(store.wallets[0]?.privateKey).toBe(result.privateKey);
      expect(store.wallets[0]?.label).toBe('Test Generated Wallet');
    });

    it('appends multiple generated wallets without overwriting existing entries', () => {
      const w1 = generateNewWallet({ configDir: tempDir, label: 'Wallet 1' });
      const w2 = generateNewWallet({ configDir: tempDir, label: 'Wallet 2' });

      expect(w1.publicKey).not.toBe(w2.publicKey);
      expect(w1.privateKey).not.toBe(w2.privateKey);

      const targetFile = path.join(tempDir, 'wallets.json');
      const store: WalletsStore = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
      expect(store.wallets).toHaveLength(2);
      expect(store.wallets[0]?.publicKey).toBe(w1.publicKey);
      expect(store.wallets[1]?.publicKey).toBe(w2.publicKey);
    });
  });

  describe('getWalletBalances caching and fallback', () => {
    it('exports BALANCE_CACHE_TTL of 30,000ms', () => {
      expect(BALANCE_CACHE_TTL).toBe(30_000);
    });

    it('caches getWalletBalances responses within TTL and bypasses with force: true', async () => {
      process.env.HELIUS_API_KEY = 'test-key';
      let fetchCount = 0;

      const mockHeliusResponse = {
        totalUsdValue: 150.5,
        balances: [
          {
            mint: 'So11111111111111111111111111111111111111112',
            symbol: 'SOL',
            balance: 1.0,
            pricePerToken: 140.0,
            usdValue: 140.0,
          },
          {
            mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            symbol: 'USDC',
            balance: 10.5,
            pricePerToken: 1.0,
            usdValue: 10.5,
          },
        ],
      };

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        if (String(url).includes('api.helius.xyz')) {
          fetchCount++;
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => mockHeliusResponse,
          } as any;
        }
        return { ok: false, status: 404 } as any;
      });

      // Call 1: cold cache -> hits Helius API
      const res1 = await getWalletBalances();
      expect(fetchCount).toBe(1);
      expect(res1.sol).toBe(1.0);
      expect(res1.usdc).toBe(10.5);
      expect(res1.total_usd).toBe(150.5);

      // Call 2: warm cache -> returns cached data without calling fetch again
      const res2 = await getWalletBalances();
      expect(fetchCount).toBe(1);
      expect(res2).toEqual(res1);

      // Call 3: force: true -> bypasses cache and increments fetch count
      const res3 = await getWalletBalances({ force: true });
      expect(fetchCount).toBe(2);
      expect(res3).toEqual(res1);

      // Call 4: invalidateBalanceCache() -> next call hits network
      invalidateBalanceCache();
      const res4 = await getWalletBalances();
      expect(fetchCount).toBe(3);
      expect(res4).toEqual(res1);
    });

    it('falls back to Solana RPC + Jupiter Price API when HELIUS_API_KEY is not set', async () => {
      delete process.env.HELIUS_API_KEY;

      // Mock Jupiter Price API fetch
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        if (String(url).includes('jup.ag/price/v2')) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Headers(),
            json: async () => ({
              data: {
                So11111111111111111111111111111111111111112: { price: '150.0' },
                EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { price: '1.0' },
              },
            }),
          } as any;
        }
        return { ok: false, status: 404, headers: new Headers() } as any;
      });

      const res = await getWalletBalances();
      expect(res.wallet).toBe(testKeypair.publicKey.toString());
      expect(res.error).toBeUndefined();
      expect(typeof res.sol).toBe('number');
      expect(typeof res.sol_price).toBe('number');
      expect(typeof res.total_usd).toBe('number');
    });

    it('falls back to Solana RPC when Helius API responds with error', async () => {
      process.env.HELIUS_API_KEY = 'failing-key';

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        if (String(url).includes('api.helius.xyz')) {
          return {
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            headers: new Headers(),
          } as any;
        }
        if (String(url).includes('jup.ag/price/v2')) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Headers(),
            json: async () => ({
              data: {
                So11111111111111111111111111111111111111112: { price: '150.0' },
              },
            }),
          } as any;
        }
        return { ok: false, status: 404, headers: new Headers() } as any;
      });

      const res = await getWalletBalances();
      expect(res.wallet).toBe(testKeypair.publicKey.toString());
      expect(res.error).toBeUndefined();
      expect(typeof res.sol).toBe('number');
      expect(res.sol_price).toBe(150.0);
    });

    it('invalidates balance cache when swapToken completes successfully', async () => {
      process.env.HELIUS_API_KEY = 'test-key';
      process.env.JUPITER_API_KEY = 'test-jup-key';
      delete process.env.DRY_RUN;

      let heliusFetchCount = 0;

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init?: any) => {
        const urlStr = String(url);
        if (urlStr.includes('api.helius.xyz')) {
          heliusFetchCount++;
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Headers(),
            json: async () => ({
              totalUsdValue: 100,
              balances: [{ mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', balance: 1, usdValue: 100 }],
            }),
          } as any;
        }
        if (urlStr.includes('jup.ag/swap/v2/order')) {
          // Mock versioned transaction
          const tx = new (await import('@solana/web3.js')).Transaction();
          tx.recentBlockhash = '11111111111111111111111111111111';
          tx.feePayer = testKeypair.publicKey;
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Headers(),
            json: async () => ({
              transaction: Buffer.from(tx.serialize({ requireAllSignatures: false })).toString('base64'),
              requestId: 'req_123',
            }),
          } as any;
        }
        if (urlStr.includes('jup.ag/swap/v2/execute')) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Headers(),
            json: async () => ({
              status: 'Success',
              signature: 'mock_tx_signature_123',
              inputAmountResult: 1,
              outputAmountResult: 100,
            }),
          } as any;
        }
        return { ok: false, status: 404, headers: new Headers() } as any;
      });

      // Warm the balance cache
      await getWalletBalances();
      expect(heliusFetchCount).toBe(1);

      // Verify cached
      await getWalletBalances();
      expect(heliusFetchCount).toBe(1);

      // Execute swap
      const swapRes = await swapToken({
        input_mint: 'So11111111111111111111111111111111111111112',
        output_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 0.1,
      });
      expect('success' in swapRes && swapRes.success).toBe(true);

      // Next balance query should bust cache and hit Helius API
      await getWalletBalances();
      expect(heliusFetchCount).toBe(2);
    });
  });
});


