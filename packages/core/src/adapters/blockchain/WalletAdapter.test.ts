import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Connection, Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../../config/Config.js'
import { resetConnectionState } from '../../shared/connection.js'
import {
  BALANCE_CACHE_TTL,
  clearMintDecimalsCache,
  generateNewWallet,
  getCachedMintDecimals,
  getWalletBalances,
  invalidateBalanceCache,
  setCachedMintDecimals,
  swapToken,
  type WalletsStore,
} from './WalletAdapter.js'

describe('WalletAdapter', () => {
  let tempDir: string
  let testKeypair: Keypair
  const originalEnv = { ...process.env }
  const originalConnectionConfig = { ...config.connection }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etemaro-wallet-test-'))
    testKeypair = Keypair.generate()
    const privKey = bs58.encode(testKeypair.secretKey)
    process.env.WALLET_PRIVATE_KEY = privKey
    process.env.RPC_URL = 'https://api.mainnet-beta.solana.com'
    config.connection = {
      ...config.connection,
      walletPrivateKey: privKey,
      rpcUrl: 'https://api.mainnet-beta.solana.com',
    }
    resetConnectionState()
    invalidateBalanceCache()
    clearMintDecimalsCache()

    vi.spyOn(Connection.prototype, 'getBalance').mockResolvedValue(1_000_000_000)
    vi.spyOn(Connection.prototype, 'getParsedTokenAccountsByOwner').mockResolvedValue({
      value: [
        {
          account: {
            data: {
              parsed: {
                info: {
                  mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                  tokenAmount: { uiAmount: 10.5 },
                },
              },
            },
          },
        },
      ],
    } as any)
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
    process.env = { ...originalEnv }
    config.connection = { ...originalConnectionConfig }
    resetConnectionState()
    vi.restoreAllMocks()
    invalidateBalanceCache()
  })

  describe('generateNewWallet', () => {
    it('generates a valid Solana keypair and saves it to wallets.json', () => {
      const result = generateNewWallet({
        configDir: tempDir,
        label: 'Test Generated Wallet',
      })

      expect(result).toBeDefined()
      expect(result.publicKey).toBeDefined()
      expect(result.privateKey).toBeDefined()
      expect(result.label).toBe('Test Generated Wallet')
      expect(typeof result.createdAt).toBe('string')

      // Verify public key is base58 string with correct length
      expect(result.publicKey.length).toBeGreaterThanOrEqual(32)

      // Verify private key can be decoded back to 64-byte keypair secret
      const decodedSecret = bs58.decode(result.privateKey)
      expect(decodedSecret.length).toBe(64)

      // Verify wallets.json was created and populated
      const targetFile = path.join(tempDir, 'wallets.json')
      expect(fs.existsSync(targetFile)).toBe(true)

      const store: WalletsStore = JSON.parse(fs.readFileSync(targetFile, 'utf8'))
      expect(store.wallets).toHaveLength(1)
      expect(store.wallets[0]?.publicKey).toBe(result.publicKey)
      expect(store.wallets[0]?.privateKey).toBe(result.privateKey)
      expect(store.wallets[0]?.label).toBe('Test Generated Wallet')
    })

    it('appends multiple generated wallets without overwriting existing entries', () => {
      const w1 = generateNewWallet({ configDir: tempDir, label: 'Wallet 1' })
      const w2 = generateNewWallet({ configDir: tempDir, label: 'Wallet 2' })

      expect(w1.publicKey).not.toBe(w2.publicKey)
      expect(w1.privateKey).not.toBe(w2.privateKey)

      const targetFile = path.join(tempDir, 'wallets.json')
      const store: WalletsStore = JSON.parse(fs.readFileSync(targetFile, 'utf8'))
      expect(store.wallets).toHaveLength(2)
      expect(store.wallets[0]?.publicKey).toBe(w1.publicKey)
      expect(store.wallets[1]?.publicKey).toBe(w2.publicKey)
    })
  })

  describe('getWalletBalances caching and fallback', () => {
    it('exports BALANCE_CACHE_TTL of 30,000ms', () => {
      expect(BALANCE_CACHE_TTL).toBe(30_000)
    })

    it('uses standard Solana RPC + Jupiter Price API as primary default and caches for 30s', async () => {
      let jupFetchCount = 0

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        if (String(url).includes('jup.ag/price/v2')) {
          jupFetchCount++
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Headers(),
            json: async () => ({
              data: {
                So11111111111111111111111111111111111111112: { price: '160.0' },
                EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { price: '1.0' },
              },
            }),
          } as any
        }
        return { ok: false, status: 404, headers: new Headers() } as any
      })

      // Call 1: cold cache -> queries RPC + Jupiter Price
      const res1 = await getWalletBalances()
      expect(jupFetchCount).toBe(1)
      expect(res1.wallet).toBe(testKeypair.publicKey.toString())
      expect(res1.sol_price).toBe(160.0)
      expect(res1.error).toBeUndefined()

      // Call 2: warm cache -> returns cached object without calling network
      const res2 = await getWalletBalances()
      expect(jupFetchCount).toBe(1)
      expect(res2).toEqual(res1)

      // Call 3: force: true -> bypasses cache and queries again
      const res3 = await getWalletBalances({ force: true })
      expect(jupFetchCount).toBe(2)
      expect(res3).toEqual(res1)

      // Call 4: invalidateBalanceCache() -> next call hits network
      invalidateBalanceCache()
      const res4 = await getWalletBalances()
      expect(jupFetchCount).toBe(3)
      expect(res4).toEqual(res1)
    })

    it('falls back to Helius API when standard RPC query fails', async () => {
      process.env.HELIUS_API_KEY = 'fallback-helius-key'
      vi.spyOn(Connection.prototype, 'getBalance').mockRejectedValue(new Error('Solana RPC rate limited 429'))

      let heliusHit = false
      const mockHeliusResponse = {
        totalUsdValue: 200.0,
        balances: [
          {
            mint: 'So11111111111111111111111111111111111111112',
            symbol: 'SOL',
            balance: 2.0,
            pricePerToken: 100.0,
            usdValue: 200.0,
          },
        ],
      }

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        if (String(url).includes('api.helius.xyz')) {
          heliusHit = true
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => mockHeliusResponse,
          } as any
        }
        return { ok: false, status: 404, headers: new Headers() } as any
      })

      const res = await getWalletBalances({ force: true })
      expect(heliusHit).toBe(true)
      expect(res.wallet).toBe(testKeypair.publicKey.toString())
      expect(res.sol).toBe(2.0)
      expect(res.total_usd).toBe(200.0)
    })

it('invalidates balance cache when swapToken completes successfully', async () => {
    process.env.JUPITER_API_KEY = 'test-jup-key'
    config.jupiter.apiKey = 'test-jup-key'
    delete process.env.DRY_RUN
    config.connection.dryRun = false

      let jupPriceCount = 0

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, _init?: any) => {
        const urlStr = String(url)
        if (urlStr.includes('jup.ag/price/v2')) {
          jupPriceCount++
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
          } as any
        }
        if (urlStr.includes('jup.ag/swap/v2/order')) {
          const tx = new (await import('@solana/web3.js')).Transaction()
          tx.recentBlockhash = '11111111111111111111111111111111'
          tx.feePayer = testKeypair.publicKey
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Headers(),
            json: async () => ({
              transaction: Buffer.from(tx.serialize({ requireAllSignatures: false })).toString('base64'),
              requestId: 'req_123',
            }),
          } as any
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
          } as any
        }
        return { ok: false, status: 404, headers: new Headers() } as any
      })

      // Warm balance cache
      await getWalletBalances()
      expect(jupPriceCount).toBe(1)

      // Verify cached
      await getWalletBalances()
      expect(jupPriceCount).toBe(1)

      // Execute swap
      const swapRes = await swapToken({
        input_mint: 'So11111111111111111111111111111111111111112',
        output_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 0.1,
      })
      expect('success' in swapRes && swapRes.success).toBe(true)

      // Next balance query should bust cache and query fresh data
      await getWalletBalances()
      expect(jupPriceCount).toBe(2)
    })

    describe('mint decimals caching and swapToken resolution', () => {
      const mockJupiterSwap = (onOrder?: (searchParams: URLSearchParams) => void) => {
        process.env.JUPITER_API_KEY = 'test-jup-key'
        config.jupiter.apiKey = 'test-jup-key'
        delete process.env.DRY_RUN
        config.connection.dryRun = false

        return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
          const urlStr = String(url)
          if (urlStr.includes('jup.ag/price/v2')) {
            return {
              ok: true,
              status: 200,
              statusText: 'OK',
              headers: new Headers(),
              json: async () => ({ data: {} }),
            } as any
          }
          if (urlStr.includes('jup.ag/swap/v2/order')) {
            const parsedUrl = new URL(urlStr)
            if (onOrder) onOrder(parsedUrl.searchParams)
            const tx = new (await import('@solana/web3.js')).Transaction()
            tx.recentBlockhash = '11111111111111111111111111111111'
            tx.feePayer = testKeypair.publicKey
            return {
              ok: true,
              status: 200,
              statusText: 'OK',
              headers: new Headers(),
              json: async () => ({
                transaction: Buffer.from(tx.serialize({ requireAllSignatures: false })).toString('base64'),
                requestId: 'req_mock_swap',
              }),
            } as any
          }
          if (urlStr.includes('jup.ag/swap/v2/execute')) {
            return {
              ok: true,
              status: 200,
              statusText: 'OK',
              headers: new Headers(),
              json: async () => ({
                status: 'Success',
                signature: 'mock_tx_swap_ok',
                inputAmountResult: 10,
                outputAmountResult: 1,
              }),
            } as any
          }
          return { ok: false, status: 404, headers: new Headers() } as any
        })
      }

      it('validates and boundaries for setCachedMintDecimals', () => {
        const testMint = 'TEST_MINT_VALIDATION_11111111111111111111'

        // Valid integers in range [0, 18]
        setCachedMintDecimals(testMint, 0)
        expect(getCachedMintDecimals(testMint)).toBe(0)

        setCachedMintDecimals(testMint, 6)
        expect(getCachedMintDecimals(testMint)).toBe(6)

        setCachedMintDecimals(testMint, 9)
        expect(getCachedMintDecimals(testMint)).toBe(9)

        setCachedMintDecimals(testMint, 18)
        expect(getCachedMintDecimals(testMint)).toBe(18)

        // Invalid: non-integer float
        setCachedMintDecimals(testMint, 6.5)
        expect(getCachedMintDecimals(testMint)).toBe(18) // unchanged

        // Invalid: negative integer
        setCachedMintDecimals(testMint, -1)
        expect(getCachedMintDecimals(testMint)).toBe(18) // unchanged

        // Invalid: exceeds max decimals (> 18)
        setCachedMintDecimals(testMint, 19)
        expect(getCachedMintDecimals(testMint)).toBe(18) // unchanged

        // Invalid: NaN / Infinity
        setCachedMintDecimals(testMint, Number.NaN)
        expect(getCachedMintDecimals(testMint)).toBe(18) // unchanged
        setCachedMintDecimals(testMint, Number.POSITIVE_INFINITY)
        expect(getCachedMintDecimals(testMint)).toBe(18) // unchanged
      })

      it('pre-seeded mints (SOL and USDC) are cached by default and avoid RPC lookups during swapToken', async () => {
        const solMint = 'So11111111111111111111111111111111111111112'
        const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

        expect(getCachedMintDecimals(solMint)).toBe(9)
        expect(getCachedMintDecimals(usdcMint)).toBe(6)

        let lastOrderParams: any = null
        mockJupiterSwap((params) => {
          lastOrderParams = params
        })

        const getParsedAccountInfoSpy = vi.spyOn(Connection.prototype, 'getParsedAccountInfo')

        // Swap USDC (6 decimals) -> 5.5 USDC should convert to 5,500,000
        const usdcSwap = await swapToken({
          input_mint: usdcMint,
          output_mint: solMint,
          amount: 5.5,
        })
        expect('success' in usdcSwap && usdcSwap.success).toBe(true)
        expect(getParsedAccountInfoSpy).not.toHaveBeenCalled()
        expect(lastOrderParams?.get('amount')).toBe('5500000')

        // Swap SOL (9 decimals) -> 1.25 SOL should convert to 1,250,000,000
        const solSwap = await swapToken({
          input_mint: solMint,
          output_mint: usdcMint,
          amount: 1.25,
        })
        expect('success' in solSwap && solSwap.success).toBe(true)
        expect(getParsedAccountInfoSpy).not.toHaveBeenCalled()
        expect(lastOrderParams?.get('amount')).toBe('1250000000')
      })

      it('falls back to getParsedAccountInfo on cache miss, caches result, and reuses on subsequent swaps', async () => {
        const uncachedMint = Keypair.generate().publicKey.toString()
        expect(getCachedMintDecimals(uncachedMint)).toBeUndefined()

        let lastOrderParams: any = null
        mockJupiterSwap((params) => {
          lastOrderParams = params
        })

        const getParsedAccountInfoSpy = vi.spyOn(Connection.prototype, 'getParsedAccountInfo').mockResolvedValue({
          value: {
            data: {
              parsed: {
                info: {
                  decimals: 8,
                },
              },
            },
          },
        } as any)

        // First swap: cache miss -> queries RPC, gets 8 decimals, converts 2.5 tokens to 250,000,000
        const firstSwap = await swapToken({
          input_mint: uncachedMint,
          output_mint: 'So11111111111111111111111111111111111111112',
          amount: 2.5,
        })
        expect('success' in firstSwap && firstSwap.success).toBe(true)
        expect(getParsedAccountInfoSpy).toHaveBeenCalledTimes(1)
        expect(lastOrderParams?.get('amount')).toBe('250000000')
        expect(getCachedMintDecimals(uncachedMint)).toBe(8)

        // Second swap: cache hit -> 0 new RPC calls, converts 10 tokens to 1,000,000,000
        const secondSwap = await swapToken({
          input_mint: uncachedMint,
          output_mint: 'So11111111111111111111111111111111111111112',
          amount: 10,
        })
        expect('success' in secondSwap && secondSwap.success).toBe(true)
        expect(getParsedAccountInfoSpy).toHaveBeenCalledTimes(1)
        expect(lastOrderParams?.get('amount')).toBe('1000000000')
      })

      it('clearMintDecimalsCache resets custom entries and forces fresh RPC lookup on next swap', async () => {
        const customMint = Keypair.generate().publicKey.toString()
        setCachedMintDecimals(customMint, 4)
        expect(getCachedMintDecimals(customMint)).toBe(4)

        // Clear cache
        clearMintDecimalsCache()

        // Custom mint is cleared, pre-seeded remain
        expect(getCachedMintDecimals(customMint)).toBeUndefined()
        expect(getCachedMintDecimals('So11111111111111111111111111111111111111112')).toBe(9)
        expect(getCachedMintDecimals('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(6)

        mockJupiterSwap()
        const getParsedAccountInfoSpy = vi.spyOn(Connection.prototype, 'getParsedAccountInfo').mockResolvedValue({
          value: {
            data: {
              parsed: {
                info: {
                  decimals: 4,
                },
              },
            },
          },
        } as any)

        // Next swap must query RPC again
        const swapRes = await swapToken({
          input_mint: customMint,
          output_mint: 'So11111111111111111111111111111111111111112',
          amount: 1,
        })
        expect('success' in swapRes && swapRes.success).toBe(true)
        expect(getParsedAccountInfoSpy).toHaveBeenCalledTimes(1)
        expect(getCachedMintDecimals(customMint)).toBe(4)
      })

      it('populates decimals cache for multiple tokens from getWalletBalances and reuses across swaps', async () => {
        const tokenA = Keypair.generate().publicKey.toString()
        const tokenB = Keypair.generate().publicKey.toString()

        vi.spyOn(Connection.prototype, 'getParsedTokenAccountsByOwner').mockResolvedValueOnce({
          value: [
            {
              account: {
                data: {
                  parsed: {
                    info: {
                      mint: tokenA,
                      tokenAmount: { uiAmount: 100, decimals: 6 },
                    },
                  },
                },
              },
            },
            {
              account: {
                data: {
                  parsed: {
                    info: {
                      mint: tokenB,
                      tokenAmount: { uiAmount: 50, decimals: 9 },
                    },
                  },
                },
              },
            },
          ],
        } as any)

        let lastOrderParams: any = null
        mockJupiterSwap((params) => {
          lastOrderParams = params
        })

        const getParsedAccountInfoSpy = vi.spyOn(Connection.prototype, 'getParsedAccountInfo')

        // 1. Fetch wallet balances -> populates both tokenA and tokenB into cache
        await getWalletBalances({ force: true })
        expect(getCachedMintDecimals(tokenA)).toBe(6)
        expect(getCachedMintDecimals(tokenB)).toBe(9)

        // 2. Perform swap with tokenA -> uses cached 6 decimals (amount 10 -> 10,000,000)
        const resA = await swapToken({
          input_mint: tokenA,
          output_mint: 'So11111111111111111111111111111111111111112',
          amount: 10,
        })
        expect('success' in resA && resA.success).toBe(true)
        expect(lastOrderParams?.get('amount')).toBe('10000000')

        // 3. Perform swap with tokenB -> uses cached 9 decimals (amount 2 -> 2,000,000,000)
        const resB = await swapToken({
          input_mint: tokenB,
          output_mint: 'So11111111111111111111111111111111111111112',
          amount: 2,
        })
        expect('success' in resB && resB.success).toBe(true)
        expect(lastOrderParams?.get('amount')).toBe('2000000000')

        // 0 RPC network calls for decimals because both were in cache!
        expect(getParsedAccountInfoSpy).not.toHaveBeenCalled()
      })
    })
  })
})
