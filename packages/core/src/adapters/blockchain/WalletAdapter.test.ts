import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Connection, Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../../config/Config.js'
import * as connectionModule from '../../shared/connection.js'

const { resetConnectionState, setWalletKeypair } = connectionModule

import {
  BALANCE_CACHE_TTL,
  classifyJupiterError,
  clearMintDecimalsCache,
  generateNewWallet,
  getCachedMintDecimals,
  getWalletBalances,
  invalidateBalanceCache,
  setCachedMintDecimals,
  swapToken,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from './WalletAdapter.js'

describe('WalletAdapter', () => {
  let tempDir: string
  let testKeypair: Keypair
  const originalEnv = { ...process.env }
  const originalConnectionConfig = { ...config.connection }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etemaro-wallet-test-'))
    resetConnectionState()
    testKeypair = Keypair.generate()
    setWalletKeypair(testKeypair)
    config.connection = {
      ...config.connection,
      wallet: 'default',
      rpcUrl: 'https://api.mainnet-beta.solana.com',
    }
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
    it('generates a valid Solana keypair and saves it to individual keystore', () => {
      const result = generateNewWallet({
        credentialsDir: tempDir,
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

      // Verify keystore file was created and populated
      const targetFile = path.join(tempDir, 'Test Generated Wallet.json')
      expect(result.savedTo).toBe(targetFile)
      expect(fs.existsSync(targetFile)).toBe(true)

      const payload = JSON.parse(fs.readFileSync(targetFile, 'utf8'))
      expect(payload.publicKey).toBe(result.publicKey)
      expect(payload.privateKey).toBe(result.privateKey)
    })

    it('creates separate keystore files for multiple generated wallets', () => {
      const w1 = generateNewWallet({ credentialsDir: tempDir, label: 'Wallet 1' })
      const w2 = generateNewWallet({ credentialsDir: tempDir, label: 'Wallet 2' })

      expect(w1.publicKey).not.toBe(w2.publicKey)
      expect(w1.privateKey).not.toBe(w2.privateKey)

      const f1 = path.join(tempDir, 'Wallet 1.json')
      const f2 = path.join(tempDir, 'Wallet 2.json')
      expect(fs.existsSync(f1)).toBe(true)
      expect(fs.existsSync(f2)).toBe(true)

      const p1 = JSON.parse(fs.readFileSync(f1, 'utf8'))
      const p2 = JSON.parse(fs.readFileSync(f2, 'utf8'))
      expect(p1.publicKey).toBe(w1.publicKey)
      expect(p2.publicKey).toBe(w2.publicKey)
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
      config.connection = {
        ...config.connection,
        heliusApiKey: 'fallback-helius-key',
      }
      // Verify heliusApiKey is set
      expect(config.connection?.heliusApiKey).toBe('fallback-helius-key')
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
        const urlStr = String(url)
        if (urlStr.includes('api.helius.xyz')) {
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

    it('queries both standard SPL Token and Token-2022 programs concurrently and discovers Token-2022 accounts', async () => {
      const getParsedTokenAccountsSpy = vi.spyOn(Connection.prototype, 'getParsedTokenAccountsByOwner')
      getParsedTokenAccountsSpy.mockImplementation(async (_owner, filter: any) => {
        if (filter.programId.equals(TOKEN_PROGRAM_ID)) {
          return {
            value: [
              {
                account: {
                  data: {
                    parsed: {
                      info: {
                        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                        tokenAmount: { uiAmount: 10.5, decimals: 6 },
                      },
                    },
                  },
                },
              },
            ],
          } as any
        }
        if (filter.programId.equals(TOKEN_2022_PROGRAM_ID)) {
          return {
            value: [
              {
                account: {
                  data: {
                    parsed: {
                      info: {
                        mint: 'Token2022MintAddress111111111111111111111111',
                        tokenAmount: { uiAmount: 1397.91, decimals: 9 },
                      },
                    },
                  },
                },
              },
            ],
          } as any
        }
        return { value: [] } as any
      })

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        if (String(url).includes('jup.ag/price/v2')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({
              data: {
                So11111111111111111111111111111111111111112: { price: '150.0' },
                EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { price: '1.0' },
                Token2022MintAddress111111111111111111111111: { price: '0.02' },
              },
            }),
          } as any
        }
        return { ok: false, status: 404, headers: new Headers() } as any
      })

      const balances = await getWalletBalances({ force: true })
      expect(getParsedTokenAccountsSpy).toHaveBeenCalledTimes(2)
      const token2022Item = balances.tokens.find((t) => t.mint === 'Token2022MintAddress111111111111111111111111')
      expect(token2022Item).toBeDefined()
      expect(token2022Item?.balance).toBe(1397.91)
      expect(token2022Item?.usd).toBe(27.96)
      expect(token2022Item?.program).toBe('token-2022')
    })

    it('aggregates multiple token accounts for the same mint across programs', async () => {
      const getParsedTokenAccountsSpy = vi.spyOn(Connection.prototype, 'getParsedTokenAccountsByOwner')
      getParsedTokenAccountsSpy.mockImplementation(async (_owner, filter: any) => {
        if (filter.programId.equals(TOKEN_PROGRAM_ID)) {
          return {
            value: [
              {
                account: {
                  data: {
                    parsed: {
                      info: {
                        mint: 'DUAL_MINT_1111111111111111111111111111111111',
                        tokenAmount: { uiAmount: 50, decimals: 6 },
                      },
                    },
                  },
                },
              },
            ],
          } as any
        }
        if (filter.programId.equals(TOKEN_2022_PROGRAM_ID)) {
          return {
            value: [
              {
                account: {
                  data: {
                    parsed: {
                      info: {
                        mint: 'DUAL_MINT_1111111111111111111111111111111111',
                        tokenAmount: { uiAmount: 25, decimals: 6 },
                      },
                    },
                  },
                },
              },
            ],
          } as any
        }
        return { value: [] } as any
      })

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        if (String(url).includes('jup.ag/price/v2')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({
              data: {
                So11111111111111111111111111111111111111112: { price: '150.0' },
                DUAL_MINT_1111111111111111111111111111111111: { price: '2.0' },
              },
            }),
          } as any
        }
        return { ok: false, status: 404, headers: new Headers() } as any
      })

      const balances = await getWalletBalances({ force: true })
      const item = balances.tokens.find((t) => t.mint === 'DUAL_MINT_1111111111111111111111111111111111')
      expect(item).toBeDefined()
      expect(item?.balance).toBe(75) // 50 + 25 aggregated
      expect(item?.usd).toBe(150)
    })

    it('enriches unpriced tokens with Helius balances API when heliusApiKey is present', async () => {
      config.connection = {
        ...config.connection,
        heliusApiKey: 'enrich-helius-key',
      }
      const unpricedMint = 'UNPRICED_MEME_TOKEN_MINT_11111111111111111111'
      const getParsedTokenAccountsSpy = vi.spyOn(Connection.prototype, 'getParsedTokenAccountsByOwner')
      getParsedTokenAccountsSpy.mockImplementation(async (_owner, filter: any) => {
        if (filter.programId.equals(TOKEN_PROGRAM_ID)) {
          return {
            value: [
              {
                account: {
                  data: {
                    parsed: {
                      info: {
                        mint: unpricedMint,
                        tokenAmount: { uiAmount: 1000, decimals: 6 },
                      },
                    },
                  },
                },
              },
            ],
          } as any
        }
        return { value: [] } as any
      })

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        const urlStr = String(url)
        if (urlStr.includes('jup.ag/price/v2')) {
          // Jupiter returns no price for this unpriced meme token
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({
              data: {
                So11111111111111111111111111111111111111112: { price: '150.0' },
              },
            }),
          } as any
        }
        if (urlStr.includes('api.helius.xyz')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({
              balances: [
                {
                  mint: unpricedMint,
                  symbol: 'MEME',
                  balance: 1000,
                  pricePerToken: 0.05,
                  usdValue: 50.0,
                },
              ],
            }),
          } as any
        }
        return { ok: false, status: 404, headers: new Headers() } as any
      })

      const balances = await getWalletBalances({ force: true })
      const memeToken = balances.tokens.find((t) => t.mint === unpricedMint)
      expect(memeToken).toBeDefined()
      expect(memeToken?.symbol).toBe('MEME')
      expect(memeToken?.usd).toBe(50.0)
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

    describe('Jupiter swap error normalization and classification (Issue #271)', () => {
      it('classifies Jupiter error codes and messages into expected categories', () => {
        // liquidity.unavailable
        expect(classifyJupiterError('TOKEN_NOT_TRADABLE')).toBe('liquidity.unavailable')
        expect(classifyJupiterError('NO_ROUTES_FOUND')).toBe('liquidity.unavailable')
        expect(classifyJupiterError('COULD_NOT_FIND_ANY_ROUTE')).toBe('liquidity.unavailable')
        expect(classifyJupiterError('MARKET_NOT_FOUND')).toBe('liquidity.unavailable')
        expect(classifyJupiterError('Failed to get quotes')).toBe('liquidity.unavailable')
        expect(classifyJupiterError('Swap V2 order failed: 400 {"error":"Failed to get quotes"}')).toBe(
          'liquidity.unavailable',
        )

        // liquidity.partial
        expect(classifyJupiterError('ROUTE_PLAN_DOES_NOT_CONSUME_ALL_THE_AMOUNT')).toBe('liquidity.partial')
        expect(classifyJupiterError('The route plan does not consume all the amount')).toBe('liquidity.partial')

        // slippage.exceeded
        expect(classifyJupiterError('SlippageToleranceExceeded')).toBe('slippage.exceeded')
        expect(classifyJupiterError('ExactOutAmountNotMatched')).toBe('slippage.exceeded')
        expect(classifyJupiterError('6001')).toBe('slippage.exceeded')
        expect(classifyJupiterError('Program failed: Custom:6001')).toBe('slippage.exceeded')

        // balance.insufficient
        expect(classifyJupiterError('InsufficientFunds')).toBe('balance.insufficient')
        expect(classifyJupiterError('0x1')).toBe('balance.insufficient')
        expect(classifyJupiterError('insufficient lamports for transfer')).toBe('balance.insufficient')

        // unknown
        expect(classifyJupiterError('SomeRandomNetworkError')).toBe('unknown')
        expect(classifyJupiterError(null)).toBe('unknown')
        expect(classifyJupiterError(undefined)).toBe('unknown')
      })

      it('parses structured errorCode and requestId on HTTP 400 order failure', async () => {
        process.env.JUPITER_API_KEY = 'test-jup-key'
        config.jupiter.apiKey = 'test-jup-key'
        config.connection.dryRun = false

        const testMint = Keypair.generate().publicKey.toBase58()
        setCachedMintDecimals(testMint, 6)

        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          headers: new Headers(),
          text: async () =>
            JSON.stringify({
              requestId: 'req-dead-akira-1',
              errorCode: 'TOKEN_NOT_TRADABLE',
              errorMessage: 'Token is not tradable',
            }),
        } as any)

        const res = await swapToken({
          input_mint: testMint,
          output_mint: 'So11111111111111111111111111111111111111112',
          amount: 100,
        })

        expect('success' in res && res.success).toBe(false)
        if ('success' in res && !res.success) {
          expect(res.error_code).toBe('TOKEN_NOT_TRADABLE')
          expect(res.error_category).toBe('liquidity.unavailable')
          expect(res.request_id).toBe('req-dead-akira-1')
        }
      })

      it('parses error message when body only contains error property', async () => {
        process.env.JUPITER_API_KEY = 'test-jup-key'
        config.jupiter.apiKey = 'test-jup-key'
        config.connection.dryRun = false

        const testMint = Keypair.generate().publicKey.toBase58()
        setCachedMintDecimals(testMint, 6)

        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          headers: new Headers(),
          text: async () =>
            JSON.stringify({
              requestId: 'req-dead-og-2',
              error: 'Failed to get quotes',
            }),
        } as any)

        const res = await swapToken({
          input_mint: testMint,
          output_mint: 'So11111111111111111111111111111111111111112',
          amount: 50,
        })

        expect('success' in res && res.success).toBe(false)
        if ('success' in res && !res.success) {
          expect(res.error_code).toBe('Failed to get quotes')
          expect(res.error_category).toBe('liquidity.unavailable')
          expect(res.request_id).toBe('req-dead-og-2')
        }
      })

      it('supports slippageBps parameter and appends it to order URL', async () => {
        process.env.JUPITER_API_KEY = 'test-jup-key'
        config.jupiter.apiKey = 'test-jup-key'
        config.connection.dryRun = false

        const testMint = Keypair.generate().publicKey.toBase58()
        setCachedMintDecimals(testMint, 6)

        let capturedUrl: string | null = null
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
          const urlStr = String(url)
          if (urlStr.includes('jup.ag/swap/v2/order')) {
            capturedUrl = urlStr
            return {
              ok: false,
              status: 400,
              statusText: 'Bad Request',
              headers: new Headers(),
              text: async () =>
                JSON.stringify({
                  errorCode: 'ROUTE_PLAN_DOES_NOT_CONSUME_ALL_THE_AMOUNT',
                }),
            } as any
          }
          return { ok: true, json: async () => ({}) } as any
        })

        const res = await swapToken({
          input_mint: testMint,
          output_mint: 'So11111111111111111111111111111111111111112',
          amount: 10,
          slippageBps: 250,
        })

        expect('success' in res && res.success).toBe(false)
        expect(capturedUrl).toContain('slippageBps=250')
        if ('success' in res && !res.success) {
          expect(res.error_code).toBe('ROUTE_PLAN_DOES_NOT_CONSUME_ALL_THE_AMOUNT')
          expect(res.error_category).toBe('liquidity.partial')
        }
      })
    })
  })
})
