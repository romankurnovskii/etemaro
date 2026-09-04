/**
 * @file PriceProvider.ts
 * @description Token price provider abstraction with pluggable external providers (Jupiter, Binance, Coinbase).
 *
 * @features
 * - Defines a uniform PriceProvider interface for fetching USD token prices by mint
 * - JupiterProvider: batch price fetch via Jupiter Price API v2 (supports API key + 429/421 retry)
 * - BinanceProvider: single-price via Binance public ticker (SOL/USD)
 * - CoinbaseProvider: single-price via Coinbase public spot price (SOL/USD)
 * - CompositePriceProvider: chains providers in priority order with fallback
 *
 * @dependencies fetch, Config, logger
 * @sideEffects External HTTP API requests to Jupiter, Binance, Coinbase
 */

import { config } from '../../config/Config.js'
import { log } from '../../shared/logger.js'
import { sleep } from '../../utils/time.js'

export interface PriceProvider {
  readonly name: string
  /** Get the USD price of a single token mint. Returns null if unavailable. */
  getPrice(mint: string): Promise<number | null>
  /** Get USD prices for multiple mints. Only successfully priced mints appear in the result. */
  getPrices(mints: string[]): Promise<Record<string, number>>
}

interface JupiterPriceData {
  price?: string
}

interface JupiterPriceResponse {
  data?: Record<string, JupiterPriceData>
}

interface BinancePriceResponse {
  price: string
}

interface CoinbasePriceResponse {
  data?: { amount?: string }
}

/**
 * Fetch with retry on transient Jupiter rate-limit responses (429) and
 * misdirected-request (421) responses. Jupiter exposes `x-ratelimit-reset`
 * (Unix seconds) on 429 responses — wait until that moment so the sliding
 * window frees a slot, falling back to a fixed delay when the header is absent.
 */
async function jupiterFetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: { attempts?: number; fallbackDelayMs?: number } = {},
): Promise<Response> {
  const attempts = Math.max(1, opts.attempts ?? 3)
  const fallbackDelayMs = Math.max(0, opts.fallbackDelayMs ?? 2000)
  let lastResponse: Response | null = null
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = await fetch(url, init)
    if (res.status !== 429 && res.status !== 421) return res
    lastResponse = res
    const resetHeader = res.headers.get('x-ratelimit-reset')
    const waitMs = resetHeader ? Math.max(0, Number(resetHeader) * 1000 - Date.now()) : fallbackDelayMs
    log(
      'price_warn',
      `Jupiter responded ${res.status} (attempt ${attempt}/${attempts}) — waiting ${waitMs}ms before retry`,
    )
    if (attempt < attempts) await sleep(waitMs)
  }
  if (!lastResponse) throw new Error('All retry attempts failed')
  return lastResponse
}

function getJupiterApiKey(): string | undefined {
  return config.jupiter?.apiKey
}

const JUPITER_PRICE_API = 'https://api.jup.ag/price/v2'
const BINANCE_TICKER_API = 'https://api.binance.com/api/v3/ticker/price'
const COINBASE_SPOT_API = 'https://api.coinbase.com/v2/prices'

/** SOL mint used across the codebase for native SOL pricing. */
const SOL_MINT = config.tokens.SOL

/**
 * Jupiter price provider — fetches token prices via Jupiter Price API v2.
 * Supports batch queries (multiple mints in a single request) and the
 * `x-api-key` header for higher rate limits.
 */
export class JupiterProvider implements PriceProvider {
  readonly name = 'jupiter'

  async getPrice(mint: string): Promise<number | null> {
    const prices = await this.getPrices([mint])
    return prices[mint] ?? null
  }

  async getPrices(mints: string[]): Promise<Record<string, number>> {
    const clean = [...new Set(mints.filter(Boolean))]
    if (clean.length === 0) return {}
    const url = `${JUPITER_PRICE_API}?ids=${clean.join(',')}`
    const headers: Record<string, string> = {}
    const apiKey = getJupiterApiKey()
    if (apiKey) headers['x-api-key'] = apiKey
    try {
      const res = await jupiterFetchWithRetry(url, { headers }, { attempts: 2 })
      if (!res.ok) return {}
      const payload = (await res.json()) as JupiterPriceResponse
      const prices: Record<string, number> = {}
      if (payload?.data) {
        for (const [mint, obj] of Object.entries(payload.data)) {
          const p = Number(obj?.price)
          if (Number.isFinite(p) && p > 0) prices[mint] = p
        }
      }
      return prices
    } catch (err: unknown) {
      const e = err as { message?: string }
      log('price_warn', `Jupiter price fetch failed: ${e.message || err}`)
      return {}
    }
  }
}

/**
 * Binance price provider — fetches SOL/USD via the Binance public ticker.
 * Binance trades symbol pairs (e.g. SOLUSDT), so only mints with a
 * known symbol mapping (SOL) are supported.
 */
export class BinanceProvider implements PriceProvider {
  readonly name = 'binance'

  private mintToSymbol(mint: string): string | null {
    if (mint === SOL_MINT) return 'SOLUSDT'
    return null
  }

  async getPrice(mint: string): Promise<number | null> {
    const symbol = this.mintToSymbol(mint)
    if (!symbol) return null
    try {
      const res = await fetch(`${BINANCE_TICKER_API}?symbol=${symbol}`)
      if (!res.ok) return null
      const data = (await res.json()) as BinancePriceResponse
      const price = Number(data.price)
      return Number.isFinite(price) && price > 0 ? price : null
    } catch (err: unknown) {
      const e = err as { message?: string }
      log('price_warn', `Binance price fetch failed for ${symbol}: ${e.message || err}`)
      return null
    }
  }

  async getPrices(mints: string[]): Promise<Record<string, number>> {
    const result: Record<string, number> = {}
    for (const mint of mints) {
      const price = await this.getPrice(mint)
      if (price !== null) result[mint] = price
    }
    return result
  }
}

/**
 * Coinbase price provider — fetches SOL/USD via the Coinbase public spot price API.
 * Like Binance, Coinbase trades by symbol pair, so only SOL is supported.
 */
export class CoinbaseProvider implements PriceProvider {
  readonly name = 'coinbase'

  private mintToSymbol(mint: string): string | null {
    if (mint === SOL_MINT) return 'SOL-USD'
    return null
  }

  async getPrice(mint: string): Promise<number | null> {
    const symbol = this.mintToSymbol(mint)
    if (!symbol) return null
    try {
      const res = await fetch(`${COINBASE_SPOT_API}/${symbol}/spot`)
      if (!res.ok) return null
      const data = (await res.json()) as CoinbasePriceResponse
      const price = Number(data?.data?.amount)
      return Number.isFinite(price) && price > 0 ? price : null
    } catch (err: unknown) {
      const e = err as { message?: string }
      log('price_warn', `Coinbase price fetch failed for ${symbol}: ${e.message || err}`)
      return null
    }
  }

  async getPrices(mints: string[]): Promise<Record<string, number>> {
    const result: Record<string, number> = {}
    for (const mint of mints) {
      const price = await this.getPrice(mint)
      if (price !== null) result[mint] = price
    }
    return result
  }
}

/**
 * Composite price provider — tries providers in priority order and returns
 * the first successful price for each mint. The batch `getPrices` call
 * progressively fills gaps: Jupiter handles the batch first, then Binance
 * and Coinbase fill any mints Jupiter couldn't price.
 */
export class CompositePriceProvider implements PriceProvider {
  readonly name = 'composite'
  private readonly providers: PriceProvider[]

  constructor(providers: PriceProvider[]) {
    this.providers = providers
  }

  async getPrice(mint: string): Promise<number | null> {
    for (const provider of this.providers) {
      const price = await provider.getPrice(mint)
      if (price !== null) return price
    }
    return null
  }

  async getPrices(mints: string[]): Promise<Record<string, number>> {
    const result: Record<string, number> = {}
    const clean = [...new Set(mints.filter(Boolean))]
    if (clean.length === 0) return {}

    for (const provider of this.providers) {
      const missing = clean.filter((m) => result[m] === undefined)
      if (missing.length === 0) break
      const prices = await provider.getPrices(missing)
      for (const [mint, price] of Object.entries(prices)) {
        if (price !== undefined && result[mint] === undefined) {
          result[mint] = price
        }
      }
    }

    return result
  }
}

// ─── Default singleton: Jupiter → Binance → Coinbase ─────────────────

export const jupiterProvider = new JupiterProvider()
export const binanceProvider = new BinanceProvider()
export const coinbaseProvider = new CoinbaseProvider()

export const priceProvider: PriceProvider = new CompositePriceProvider([
  jupiterProvider,
  binanceProvider,
  coinbaseProvider,
])

export { SOL_MINT }
