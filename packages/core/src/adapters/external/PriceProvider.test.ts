import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../../config/Config.js'
import {
  BinanceProvider,
  CoinbaseProvider,
  CompositePriceProvider,
  JupiterProvider,
  type PriceProvider,
  priceProvider,
} from './PriceProvider.js'

const SOL_MINT = config.tokens.SOL
const USDC_MINT = config.tokens.USDC

type FetchUrl = Parameters<typeof fetch>[0]

function mockResponse(ok: boolean, status: number, body: unknown): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    headers: new Headers(),
    json: async () => body,
  } as Response
}

describe('PriceProvider', () => {
  const originalConfig = { ...config }

  beforeEach(() => {
    vi.restoreAllMocks()
    config.jupiter = { ...originalConfig.jupiter }
  })

  afterEach(() => {
    config.jupiter = { ...originalConfig.jupiter }
  })

  describe('JupiterProvider', () => {
    it('fetches prices for multiple mints in a single batch', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(true, 200, {
          data: {
            [SOL_MINT]: { price: '160.5' },
            [USDC_MINT]: { price: '1.0' },
          },
        }),
      )

      const provider = new JupiterProvider()
      const prices = await provider.getPrices([SOL_MINT, USDC_MINT])

      expect(prices[SOL_MINT]).toBe(160.5)
      expect(prices[USDC_MINT]).toBe(1.0)
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('jup.ag/price/v2?ids=')
    })

    it('includes x-api-key header when configured', async () => {
      config.jupiter.apiKey = 'test-jup-key'
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(mockResponse(true, 200, { data: { [SOL_MINT]: { price: '100' } } }))

      const provider = new JupiterProvider()
      await provider.getPrice(SOL_MINT)

      const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined
      expect((init?.headers as Record<string, string> | undefined)?.['x-api-key']).toBe('test-jup-key')
    })

    it('omits x-api-key header when no API key configured', async () => {
      config.jupiter.apiKey = ''
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(true, 200, { data: {} }))

      const provider = new JupiterProvider()
      await provider.getPrice(SOL_MINT)

      const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined
      expect((init?.headers as Record<string, string> | undefined)?.['x-api-key']).toBeUndefined()
    })

    it('returns null on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(false, 500, {}))

      const provider = new JupiterProvider()
      const price = await provider.getPrice(SOL_MINT)
      expect(price).toBeNull()
    })

    it('returns null on network error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))

      const provider = new JupiterProvider()
      const price = await provider.getPrice(SOL_MINT)
      expect(price).toBeNull()
    })

    it('deduplicates mints', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(true, 200, {
          data: { [SOL_MINT]: { price: '100' } },
        }),
      )

      const provider = new JupiterProvider()
      await provider.getPrices([SOL_MINT, SOL_MINT, SOL_MINT])

      const url = String(fetchSpy.mock.calls[0]?.[0])
      const idsParam = new URL(url).searchParams.get('ids')
      expect(idsParam).toBe(SOL_MINT)
    })

    it('returns empty record for empty input', async () => {
      const provider = new JupiterProvider()
      const prices = await provider.getPrices([])
      expect(prices).toEqual({})
    })

    it('handles 429 with retry using x-ratelimit-reset', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Headers({ 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 1) }),
          statusText: 'Too Many Requests',
        } as Response)
        .mockResolvedValueOnce(mockResponse(true, 200, { data: { [SOL_MINT]: { price: '123' } } }))

      const provider = new JupiterProvider()
      const price = await provider.getPrice(SOL_MINT)

      expect(fetchSpy).toHaveBeenCalledTimes(2)
      expect(price).toBe(123)
    })

    it('returns null after exhausted retries on persistent 429', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers(),
        statusText: 'Too Many Requests',
      } as Response)

      const provider = new JupiterProvider()
      const price = await provider.getPrice(SOL_MINT)
      expect(price).toBeNull()
    })

    it('filters out non-finite or zero prices', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(true, 200, {
          data: {
            [SOL_MINT]: { price: '0' },
            TokenA: { price: 'not-a-number' },
            TokenB: { price: '' },
            TokenC: { price: '99.9' },
          },
        }),
      )

      const provider = new JupiterProvider()
      const prices = await provider.getPrices([SOL_MINT, 'TokenA', 'TokenB', 'TokenC'])

      expect(prices[SOL_MINT]).toBeUndefined()
      expect(prices.TokenA).toBeUndefined()
      expect(prices.TokenB).toBeUndefined()
      expect(prices.TokenC).toBe(99.9)
    })
  })

  describe('BinanceProvider', () => {
    it('returns SOL price for SOL mint', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(true, 200, { price: '150.25' }))

      const provider = new BinanceProvider()
      const price = await provider.getPrice(SOL_MINT)
      expect(price).toBe(150.25)

      const url = String(fetchSpy.mock.calls[0]?.[0])
      expect(url).toContain('api.binance.com')
      expect(url).toContain('symbol=SOLUSDT')
    })

    it('returns null for non-SOL mints', async () => {
      const provider = new BinanceProvider()
      const price = await provider.getPrice('SomeOtherMint123')
      expect(price).toBeNull()
    })

    it('returns null on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(false, 404, {}))

      const provider = new BinanceProvider()
      const price = await provider.getPrice(SOL_MINT)
      expect(price).toBeNull()
    })

    it('returns null on invalid price', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(true, 200, { price: '0' }))

      const provider = new BinanceProvider()
      const price = await provider.getPrice(SOL_MINT)
      expect(price).toBeNull()
    })

    it('batched getPrices handles mixed mints', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(true, 200, { price: '200' }))

      const provider = new BinanceProvider()
      const prices = await provider.getPrices([SOL_MINT, 'Unknown'])

      expect(prices[SOL_MINT]).toBe(200)
      expect(prices.Unknown).toBeUndefined()
    })
  })

  describe('CoinbaseProvider', () => {
    it('returns SOL price for SOL mint', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(mockResponse(true, 200, { data: { amount: '145.75' } }))

      const provider = new CoinbaseProvider()
      const price = await provider.getPrice(SOL_MINT)
      expect(price).toBe(145.75)

      const url = String(fetchSpy.mock.calls[0]?.[0])
      expect(url).toContain('api.coinbase.com')
      expect(url).toContain('SOL-USD')
    })

    it('returns null for non-SOL mints', async () => {
      const provider = new CoinbaseProvider()
      const price = await provider.getPrice('SomeOtherMint123')
      expect(price).toBeNull()
    })

    it('returns null on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(false, 404, {}))

      const provider = new CoinbaseProvider()
      const price = await provider.getPrice(SOL_MINT)
      expect(price).toBeNull()
    })

    it('returns null on invalid price', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(true, 200, { data: { amount: '' } }))

      const provider = new CoinbaseProvider()
      const price = await provider.getPrice(SOL_MINT)
      expect(price).toBeNull()
    })
  })

  describe('CompositePriceProvider', () => {
    it('returns first successful price across providers', async () => {
      const primary: PriceProvider = {
        name: 'primary',
        getPrice: vi.fn().mockResolvedValue(null),
        getPrices: vi.fn().mockResolvedValue({}),
      }
      const fallback: PriceProvider = {
        name: 'fallback',
        getPrice: vi.fn().mockResolvedValue(200),
        getPrices: vi.fn().mockResolvedValue({}),
      }

      const composite = new CompositePriceProvider([primary, fallback])
      const price = await composite.getPrice(SOL_MINT)

      expect(price).toBe(200)
      expect(primary.getPrice).toHaveBeenCalledWith(SOL_MINT)
      expect(fallback.getPrice).toHaveBeenCalledWith(SOL_MINT)
    })

    it('returns null when all providers fail', async () => {
      const primary: PriceProvider = {
        name: 'primary',
        getPrice: vi.fn().mockResolvedValue(null),
        getPrices: vi.fn().mockResolvedValue({}),
      }

      const composite = new CompositePriceProvider([primary])
      const price = await composite.getPrice(SOL_MINT)
      expect(price).toBeNull()
    })

    it('batch getPrices fills gaps progressively across providers', async () => {
      const jupiter: PriceProvider = {
        name: 'jupiter',
        getPrice: vi.fn().mockResolvedValue(100),
        getPrices: vi.fn().mockResolvedValue({ [SOL_MINT]: 100 }),
      }
      const binance: PriceProvider = {
        name: 'binance',
        getPrice: vi.fn().mockResolvedValue(200),
        getPrices: vi.fn().mockResolvedValue({}),
      }

      const composite = new CompositePriceProvider([jupiter, binance])
      const prices = await composite.getPrices([SOL_MINT, 'UnknownMint'])

      // Jupiter provided SOL, but not UnknownMint
      expect(prices[SOL_MINT]).toBe(100)
      // Binance was only called for mints not yet priced
      const binanceCalls = vi.mocked(binance.getPrices).mock.calls
      expect(binanceCalls[0]?.[0]).toEqual(['UnknownMint'])
    })

    it('stops calling providers when all mints are priced', async () => {
      const jupiter: PriceProvider = {
        name: 'jupiter',
        getPrice: vi.fn(),
        getPrices: vi.fn().mockResolvedValue({ [SOL_MINT]: 100 }),
      }
      const binance: PriceProvider = {
        name: 'binance',
        getPrice: vi.fn(),
        getPrices: vi.fn().mockResolvedValue({}),
      }

      const composite = new CompositePriceProvider([jupiter, binance])
      const prices = await composite.getPrices([SOL_MINT])

      expect(prices[SOL_MINT]).toBe(100)
      expect(binance.getPrices).not.toHaveBeenCalled()
    })

    it('default priceProvider chains Jupiter → Binance → Coinbase', async () => {
      expect(priceProvider.name).toBe('composite')

      // When Jupiter succeeds, no fallback providers are called
      const jupiterSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: FetchUrl) => {
        const urlStr = String(url)
        if (urlStr.includes('jup.ag/price/v2')) {
          return mockResponse(true, 200, { data: { [SOL_MINT]: { price: '150' } } })
        }
        return mockResponse(false, 404, {})
      })

      const price = await priceProvider.getPrice(SOL_MINT)
      expect(price).toBe(150)

      // Only Jupiter should have been called
      const jupiterCalls = jupiterSpy.mock.calls.filter((c) => String(c[0]).includes('jup.ag'))
      const binanceCalls = jupiterSpy.mock.calls.filter((c) => String(c[0]).includes('binance.com'))
      const coinbaseCalls = jupiterSpy.mock.calls.filter((c) => String(c[0]).includes('coinbase.com'))
      expect(jupiterCalls).toHaveLength(1)
      expect(binanceCalls).toHaveLength(0)
      expect(coinbaseCalls).toHaveLength(0)
    })

    it('default priceProvider falls back to Binance when Jupiter fails', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: FetchUrl) => {
        const urlStr = String(url)
        if (urlStr.includes('jup.ag/price/v2')) {
          return mockResponse(false, 500, {})
        }
        if (urlStr.includes('api.binance.com')) {
          return mockResponse(true, 200, { price: '140' })
        }
        return mockResponse(false, 404, {})
      })

      const price = await priceProvider.getPrice(SOL_MINT)
      expect(price).toBe(140)
    })

    it('default priceProvider falls back to Coinbase when Jupiter and Binance fail', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: FetchUrl) => {
        const urlStr = String(url)
        if (urlStr.includes('jup.ag/price/v2')) {
          return mockResponse(false, 500, {})
        }
        if (urlStr.includes('api.binance.com')) {
          return mockResponse(false, 500, {})
        }
        if (urlStr.includes('api.coinbase.com')) {
          return mockResponse(true, 200, { data: { amount: '155' } })
        }
        return mockResponse(false, 404, {})
      })

      const price = await priceProvider.getPrice(SOL_MINT)
      expect(price).toBe(155)
    })

    it('deduplicates mints in batch getPrices', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: FetchUrl) => {
        const urlStr = String(url)
        if (urlStr.includes('jup.ag/price/v2')) {
          const ids = new URL(urlStr).searchParams.get('ids')
          const safeIds = ids ?? ''
          return mockResponse(true, 200, {
            data: Object.fromEntries(safeIds.split(',').map((m) => [m, { price: '100' }])),
          })
        }
        return mockResponse(false, 404, {})
      })

      const prices = await priceProvider.getPrices([SOL_MINT, SOL_MINT, 'TestMint', 'TestMint'])
      expect(Object.keys(prices)).toEqual([SOL_MINT, 'TestMint'])
    })

    it('returns empty record for empty input', async () => {
      const prices = await priceProvider.getPrices([])
      expect(prices).toEqual({})
    })
  })
})
