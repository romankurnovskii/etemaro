/**
 * @file WalletAdapter.ts
 * @description Wallet management adapter for SOL/SPL token balance queries and Jupiter DEX swaps.
 *
 * @features
 * - Resolves keypairs from base58 strings and connects to Solana RPC
 * - Fetches SOL and token balances with pricing conversions
 * - Executes Jupiter Ultra swap transactions
 *
 * @dependencies @solana/web3.js, Jupiter API, Config
 * @sideEffects Solana RPC queries and DEX swap transactions
 */

import fs from 'node:fs'
import path from 'node:path'
import { Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js'
import bs58 from 'bs58'
import { config } from '../../config/Config.js'
import { getConnection, getWalletKeypair, withRpcFailover } from '../../shared/connection.js'
import { credentialsPath } from '../../shared/constants.js'
import { createTimer, log, logStructured } from '../../shared/logger.js'
import type { SwapErrorCategory, WalletBalancesResult } from '../../shared/types.js'
import { withRpcRetry } from '../../shared/utils.js'
import { sleep } from '../../utils/time.js'
import { binanceProvider, coinbaseProvider, priceProvider } from '../external/PriceProvider.js'

export interface GeneratedWallet {
  publicKey: string
  privateKey: string
  createdAt: string
  label?: string
  savedTo?: string
}

/**
 * Import a wallet from a Base58 private key and store it with a label.
 * If a file path is provided, reads a Solana CLI keypair JSON array.
 */
export function importWallet(opts: { label: string; privateKey?: string; filePath?: string }): GeneratedWallet {
  let key: string | undefined = opts.privateKey
  if (!key && opts.filePath) {
    const raw = JSON.parse(fs.readFileSync(opts.filePath, 'utf8'))
    // Solana CLI keypair file is an array of numbers
    if (Array.isArray(raw)) {
      key = bs58.encode(Uint8Array.from(raw))
    } else if (typeof raw === 'string') {
      key = raw
    } else if (raw.privateKey) {
      key = raw.privateKey
    }
  }
  if (!key) {
    throw new Error('No private key provided for import')
  }
  const kp = Keypair.fromSecretKey(bs58.decode(key))
  const credFile = credentialsPath(`${opts.label}.json`)
  const wallet: GeneratedWallet = {
    publicKey: kp.publicKey.toBase58(),
    privateKey: key,
    createdAt: new Date().toISOString(),
    label: opts.label,
    savedTo: credFile,
  }

  // Persist to secure individual keystore file
  try {
    const credDir = path.dirname(credFile)
    if (!fs.existsSync(credDir)) {
      fs.mkdirSync(credDir, { recursive: true, mode: 0o700 })
    }
    const payload = {
      publicKey: wallet.publicKey,
      privateKey: key,
    }
    fs.writeFileSync(credFile, JSON.stringify(payload, null, 2), { mode: 0o600 })
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(credFile, 0o600)
      } catch {
        /* ignore */
      }
    }
  } catch (err: any) {
    log('wallet', `Warning: Failed to persist individual keystore file: ${err?.message || err}`)
  }

  log('wallet', `Imported wallet ${wallet.publicKey} as ${opts.label}`)
  return wallet
}

/**
 * Generates a fresh Solana keypair, stores it in an individual keystore under .credentials/wallets,
 * and returns the public key, base58 private key, and saved location.
 */
export function generateNewWallet(opts?: {
  label?: string
  credentialsDir?: string
  /** @deprecated use credentialsDir */
  configDir?: string
}): GeneratedWallet {
  const kp = Keypair.generate()
  const publicKey = kp.publicKey.toBase58()
  const privateKey = bs58.encode(kp.secretKey)
  const label = opts?.label || 'Generated Keypair'
  const credFile = opts?.credentialsDir
    ? path.join(opts.credentialsDir, `${label}.json`)
    : credentialsPath(`${label}.json`)
  const wallet: GeneratedWallet = {
    publicKey,
    privateKey,
    createdAt: new Date().toISOString(),
    label,
    savedTo: credFile,
  }

  try {
    const credDir = path.dirname(credFile)
    if (!fs.existsSync(credDir)) {
      fs.mkdirSync(credDir, { recursive: true, mode: 0o700 })
    }
    const payload = {
      publicKey: wallet.publicKey,
      privateKey,
    }
    fs.writeFileSync(credFile, JSON.stringify(payload, null, 2), { mode: 0o600 })
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(credFile, 0o600)
      } catch {
        /* ignore */
      }
    }
    log('wallet', `Generated and stored new wallet ${publicKey} to ${credFile}`)
  } catch (err: any) {
    log('wallet', `Warning: Failed to persist individual keystore file: ${err?.message || err}`)
  }

  return wallet
}

const JUPITER_SWAP_V2_API = 'https://api.jup.ag/swap/v2'

interface RateLimitRetryOptions {
  attempts?: number
  fallbackDelayMs?: number
}

/**
 * Fetch with retry on transient Jupiter rate-limit responses (429) and
 * misdirected-request (421) responses. Jupiter exposes `x-ratelimit-reset`
 * (Unix seconds) on 429 responses — wait until that moment so the sliding
 * window frees a slot, falling back to a fixed delay when the header is absent.
 */
async function fetchWithRateLimitRetry(
  url: string,
  init: RequestInit = {},
  opts: RateLimitRetryOptions = {},
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
      'swap_warn',
      `Jupiter responded ${res.status} (attempt ${attempt}/${attempts}) — waiting ${waitMs}ms before retry`,
    )
    if (attempt < attempts) await sleep(waitMs)
  }
  if (!lastResponse) throw new Error('All retry attempts failed')
  return lastResponse
}

function getJupiterApiKey(): string | undefined {
  return config.jupiter.apiKey
}

interface JupiterReferralParams {
  referralAccount: string
  referralFee: number
}

function getJupiterReferralParams(): JupiterReferralParams | null {
  const referralAccount = String(config.jupiter.referralAccount || '').trim()
  const referralFee = Number(config.jupiter.referralFeeBps || 0)
  if (!referralAccount || !Number.isFinite(referralFee) || referralFee <= 0) {
    return null
  }
  if (referralFee < 50 || referralFee > 255) {
    log('swap_warn', `Ignoring Jupiter referral fee ${referralFee}; Ultra requires 50-255 bps`)
    return null
  }
  try {
    new PublicKey(referralAccount)
  } catch {
    log('swap_warn', 'Ignoring invalid Jupiter referral account')
    return null
  }
  return { referralAccount, referralFee: Math.round(referralFee) }
}

export const BALANCE_CACHE_TTL = 30_000
const SOL_MINT = 'So11111111111111111111111111111111111111112'
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') // Token Program
export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') // Token-2022 Program

const _mintDecimalsCache = new Map<string, number>([
  [SOL_MINT, 9],
  [USDC_MINT, 6],
])

export function getCachedMintDecimals(mint: string): number | undefined {
  return _mintDecimalsCache.get(mint)
}

export function setCachedMintDecimals(mint: string, decimals: number): void {
  if (Number.isInteger(decimals) && decimals >= 0 && decimals <= 18) {
    _mintDecimalsCache.set(mint, decimals)
  }
}

export function clearMintDecimalsCache(): void {
  _mintDecimalsCache.clear()
  _mintDecimalsCache.set(SOL_MINT, 9)
  _mintDecimalsCache.set(USDC_MINT, 6)
}

let _balanceCache: WalletBalancesResult | null = null
let _balanceCacheAt = 0
let _balanceInflight: Promise<WalletBalancesResult> | null = null

export function invalidateBalanceCache(): void {
  _balanceCache = null
  _balanceCacheAt = 0
}

let _solPriceCache: number | null = null
let _solPriceCacheAt = 0
const SOL_PRICE_CACHE_TTL = 60_000

/**
 * Fetch current SOL/USD price. Delegates to the Binance provider (primary)
 * and Coinbase provider (fallback) via the shared price-provider abstraction.
 * Caches price for 60 seconds.
 */
export async function getSolPrice(options?: { force?: boolean }): Promise<number | null> {
  const force = options?.force ?? false
  if (!force && _solPriceCache && Date.now() - _solPriceCacheAt < SOL_PRICE_CACHE_TTL) {
    return _solPriceCache
  }
  try {
    const price = (await binanceProvider.getPrice(SOL_MINT)) ?? (await coinbaseProvider.getPrice(SOL_MINT))
    if (price != null && price > 0) {
      _solPriceCache = price
      _solPriceCacheAt = Date.now()
      return price
    }
  } catch (err: unknown) {
    const e = err as { message?: string }
    log('wallet_warn', `SOL price fetch failed: ${e.message || err}`)
  }
  return _solPriceCache
}

export type { WalletBalancesResult }

/**
 * Get current wallet balances: SOL, USDC, and all SPL & Token-2022 tokens.
 * Primary method: standard on-chain Solana dual RPC scan + free Jupiter Price API v2 (0 Helius credit cost).
 * Optional fallback / enrichment: Helius Enhanced API if on-chain RPC fails or unpriced tokens exist.
 * Caches results in memory for 30 seconds unless force=true is passed.
 */
export async function getWalletBalances(options?: { force?: boolean }): Promise<WalletBalancesResult> {
  const force = options?.force ?? false
  if (!force && _balanceCache && Date.now() - _balanceCacheAt < BALANCE_CACHE_TTL) {
    return _balanceCache
  }
  if (!force && _balanceInflight) {
    return _balanceInflight
  }

  let walletAddress: string | null
  let walletPubkey: PublicKey
  try {
    const kp = getWalletKeypair()
    walletPubkey = kp.publicKey
    walletAddress = walletPubkey.toString()
  } catch {
    return {
      wallet: null,
      sol: 0,
      sol_price: 0,
      sol_usd: 0,
      usdc: 0,
      tokens: [],
      total_usd: 0,
      error: 'Wallet not configured',
    }
  }

  const fetchBalances = async (): Promise<WalletBalancesResult> => {
    // ─── 1. Primary Method: Standard Solana RPC + composite price provider ─
    try {
      const [solLamports, tokenAccounts, token2022Accounts] = await Promise.all([
        withRpcFailover((conn) => conn.getBalance(walletPubkey), { label: 'getBalance' }),
        withRpcFailover((conn) => conn.getParsedTokenAccountsByOwner(walletPubkey, { programId: TOKEN_PROGRAM_ID }), {
          label: 'getParsedTokenAccountsByOwner(Token)',
        }),
        withRpcFailover(
          (conn) => conn.getParsedTokenAccountsByOwner(walletPubkey, { programId: TOKEN_2022_PROGRAM_ID }),
          { label: 'getParsedTokenAccountsByOwner(Token-2022)' },
        ).catch((err: unknown) => {
          const e = err as { message?: string }
          log('wallet_warn', `Token-2022 scan failed (${e.message || err}); continuing with standard tokens`)
          return { value: [] }
        }),
      ])
      const solBalance = (solLamports || 0) / 1e9

      const tokensMap = new Map<
        string,
        {
          mint: string
          symbol: string
          balance: number
          usd: number | null
          program: 'spl-token' | 'token-2022'
        }
      >()
      const mintsToPrice: string[] = [SOL_MINT, USDC_MINT]

      const processAccounts = (
        accounts: Array<{ account?: { data?: { parsed?: { info?: any } } } }>,
        program: 'spl-token' | 'token-2022',
      ) => {
        for (const item of accounts) {
          const info = item.account?.data?.parsed?.info
          if (!info) continue
          const mint = info.mint
          if (!mint || typeof mint !== 'string') continue
          const decimals = info.tokenAmount?.decimals
          if (typeof decimals === 'number') {
            _mintDecimalsCache.set(mint, decimals)
          }
          const uiAmount = info.tokenAmount?.uiAmount ?? 0
          if (uiAmount <= 0) continue

          if (!mintsToPrice.includes(mint)) {
            mintsToPrice.push(mint)
          }

          const existing = tokensMap.get(mint)
          if (existing) {
            existing.balance += uiAmount
          } else {
            tokensMap.set(mint, {
              mint,
              symbol: mint === USDC_MINT ? 'USDC' : mint.slice(0, 8),
              balance: uiAmount,
              usd: null,
              program,
            })
          }
        }
      }

      processAccounts(tokenAccounts.value || [], 'spl-token')
      processAccounts(token2022Accounts.value || [], 'token-2022')

      const tokensList = Array.from(tokensMap.values())

      // Fetch SOL price via Binance/Coinbase (cached) — fallback if composite doesn't return SOL
      const binanceSolPrice = (await getSolPrice()) ?? 0

      // Fetch token prices via the composite price provider (Jupiter primary,
      // Binance/Coinbase fallback for SOL)
      const prices = await priceProvider.getPrices(mintsToPrice)

      // Use provider SOL price if available, otherwise fall back to cached Binance
      const solPrice = prices[SOL_MINT] ?? binanceSolPrice
      const solUsd = solBalance * solPrice
      const usdcEntry = tokensList.find((t) => t.mint === USDC_MINT)
      const usdcBalance = usdcEntry ? usdcEntry.balance : 0

      let tokenUsdSum = 0
      for (const t of tokensList) {
        if (t.mint === USDC_MINT) {
          t.usd = Math.round(t.balance * 100) / 100
        } else {
          const p = prices[t.mint]
          if (p !== undefined) {
            t.usd = Math.round(t.balance * p * 100) / 100
          }
        }
        if (t.usd) tokenUsdSum += t.usd
      }

      // Optional enrichment: if heliusApiKey is configured and there are tokens with missing price or symbol
      let HELIUS_API_KEY = config.connection?.heliusApiKey
      if (HELIUS_API_KEY) {
        HELIUS_API_KEY = HELIUS_API_KEY.trim().replace(/^api-key=/i, '')
      }
      const hasUnpricedTokens = tokensList.some((t) => t.usd === null)
      if (HELIUS_API_KEY && hasUnpricedTokens) {
        try {
          const url = `https://api.helius.xyz/v1/wallet/${walletAddress}/balances?api-key=${HELIUS_API_KEY}`
          const res = await fetch(url)
          if (res.ok) {
            const data = (await res.json()) as {
              balances?: Array<{
                mint: string
                symbol?: string
                balance: number
                pricePerToken?: number
                usdValue?: number
              }>
            }
            const heliusBalances = data.balances || []
            const heliusMap = new Map(heliusBalances.map((b) => [b.mint, b]))
            tokenUsdSum = 0
            for (const t of tokensList) {
              const h = heliusMap.get(t.mint)
              if (t.usd === null && h) {
                if (h.usdValue != null) {
                  t.usd = Math.round(h.usdValue * 100) / 100
                } else if (h.pricePerToken != null) {
                  t.usd = Math.round(t.balance * h.pricePerToken * 100) / 100
                }
              }
              if ((!t.symbol || t.symbol === t.mint.slice(0, 8)) && h?.symbol) {
                t.symbol = h.symbol
              }
              if (t.usd) tokenUsdSum += t.usd
            }
          }
        } catch (enrichErr: unknown) {
          log('wallet_warn', `Helius token enrichment failed: ${(enrichErr as Error)?.message || enrichErr}`)
        }
      }

      const totalUsd = Math.round((solUsd + tokenUsdSum) * 100) / 100

      const result: WalletBalancesResult = {
        wallet: walletAddress,
        sol: Math.round(solBalance * 1e6) / 1e6,
        sol_price: Math.round(solPrice * 100) / 100,
        sol_usd: Math.round(solUsd * 100) / 100,
        usdc: Math.round(usdcBalance * 100) / 100,
        tokens: tokensList,
        total_usd: totalUsd,
      }

      _balanceCache = result
      _balanceCacheAt = Date.now()
      return result
    } catch (rpcErr: unknown) {
      const e = rpcErr as { message?: string }
      log(
        'wallet_warn',
        `Standard RPC balance fetch failed (${e.message || rpcErr}); attempting Helius fallback if configured...`,
      )
    }

    // ─── 2. Optional Fallback: Helius Enhanced API ──────────────
    let HELIUS_API_KEY = config.connection?.heliusApiKey
    if (HELIUS_API_KEY) {
      HELIUS_API_KEY = HELIUS_API_KEY.trim().replace(/^api-key=/i, '')
    }

    if (HELIUS_API_KEY) {
      try {
        const url = `https://api.helius.xyz/v1/wallet/${walletAddress}/balances?api-key=${HELIUS_API_KEY}`
        const data = await withRpcRetry(
          async () => {
            const res = await fetch(url)
            if (!res.ok) {
              throw new Error(`Helius API error: ${res.status} ${res.statusText}`)
            }
            return (await res.json()) as {
              balances?: Array<{
                mint: string
                symbol?: string
                balance: number
                pricePerToken?: number
                usdValue?: number
              }>
              totalUsdValue?: number
            }
          },
          { label: 'Helius getWalletBalances' },
        )
        const balances = data.balances || []

        const solEntry = balances.find((b) => b.mint === config.tokens.SOL || b.symbol === 'SOL')
        const usdcEntry = balances.find((b) => b.mint === config.tokens.USDC || b.symbol === 'USDC')

        const solBalance = solEntry?.balance || 0
        const solPrice = solEntry?.pricePerToken || 0
        const solUsd = solEntry?.usdValue || 0
        const usdcBalance = usdcEntry?.balance || 0

        const enrichedTokens = balances.map((b) => ({
          mint: b.mint,
          symbol: b.symbol || b.mint.slice(0, 8),
          balance: b.balance,
          usd: b.usdValue ? Math.round(b.usdValue * 100) / 100 : null,
        }))

        const result: WalletBalancesResult = {
          wallet: walletAddress,
          sol: Math.round(solBalance * 1e6) / 1e6,
          sol_price: Math.round(solPrice * 100) / 100,
          sol_usd: Math.round(solUsd * 100) / 100,
          usdc: Math.round(usdcBalance * 100) / 100,
          tokens: enrichedTokens,
          total_usd: Math.round((data.totalUsdValue || 0) * 100) / 100,
        }

        _balanceCache = result
        _balanceCacheAt = Date.now()
        return result
      } catch (heliusErr: unknown) {
        const e = heliusErr as { message?: string }
        log('wallet_error', `Helius balance fallback also failed: ${e.message || heliusErr}`)
      }
    }

    const fallbackResult: WalletBalancesResult = _balanceCache
      ? {
          ..._balanceCache,
          error: 'Failed to refresh balances via Solana RPC or Helius API (using cached values)',
        }
      : {
          wallet: walletAddress,
          sol: 0,
          sol_price: 0,
          sol_usd: 0,
          usdc: 0,
          tokens: [],
          total_usd: 0,
          error: 'Failed to fetch balances via Solana RPC or Helius API',
        }

    _balanceCache = fallbackResult
    _balanceCacheAt = Date.now()
    return fallbackResult
  }

  _balanceInflight = fetchBalances().finally(() => {
    _balanceInflight = null
  })

  return _balanceInflight
}

// Normalize any SOL-like address to the correct wrapped SOL mint
export function normalizeMint(mint: string): string {
  if (!mint) return mint
  if (
    mint === 'SOL' ||
    mint === 'native' ||
    /^So1+$/.test(mint) ||
    (mint.length >= 32 && mint.length <= 44 && mint.startsWith('So1') && mint !== SOL_MINT)
  ) {
    return SOL_MINT
  }
  return mint
}

/**
 * Classify a raw Jupiter error code or message into an internal error category.
 */
export function classifyJupiterError(rawCodeOrMessage?: string | null): SwapErrorCategory {
  if (!rawCodeOrMessage) return 'unknown'
  const str = String(rawCodeOrMessage).trim()
  const upper = str.toUpperCase()

  // 1. Permanent no-liquidity / dead / unroutable tokens -> liquidity.unavailable
  if (
    upper === 'TOKEN_NOT_TRADABLE' ||
    upper === 'NO_ROUTES_FOUND' ||
    upper === 'COULD_NOT_FIND_ANY_ROUTE' ||
    upper === 'MARKET_NOT_FOUND' ||
    upper.includes('TOKEN_NOT_TRADABLE') ||
    upper.includes('NO_ROUTES_FOUND') ||
    upper.includes('COULD_NOT_FIND_ANY_ROUTE') ||
    upper.includes('MARKET_NOT_FOUND') ||
    upper.includes('FAILED TO GET QUOTES') ||
    upper.includes('NOT TRADABLE') ||
    upper.includes('NO ROUTES FOUND')
  ) {
    return 'liquidity.unavailable'
  }

  // 2. Partial liquidity (route cannot process full amount) -> liquidity.partial
  if (
    upper === 'ROUTE_PLAN_DOES_NOT_CONSUME_ALL_THE_AMOUNT' ||
    upper.includes('ROUTE_PLAN_DOES_NOT_CONSUME_ALL_THE_AMOUNT') ||
    upper.includes('DOES NOT CONSUME ALL THE AMOUNT')
  ) {
    return 'liquidity.partial'
  }

  // 3. Slippage tolerance exceeded on-chain or off-chain -> slippage.exceeded
  if (
    upper === 'SLIPPAGETOLERANCEEXCEEDED' ||
    upper === 'EXACTOUTAMOUNTNOTMATCHED' ||
    upper === '6001' ||
    upper.includes('SLIPPAGETOLERANCEEXCEEDED') ||
    upper.includes('EXACTOUTAMOUNTNOTMATCHED') ||
    upper.includes('SLIPPAGE TOLERANCE EXCEEDED') ||
    upper.includes('CUSTOM:6001') ||
    upper.includes('CODE=6001')
  ) {
    return 'slippage.exceeded'
  }

  // 4. Balance / lamports insufficient -> balance.insufficient
  if (
    upper === 'INSUFFICIENTFUNDS' ||
    upper === '0X1' ||
    upper.includes('INSUFFICIENTFUNDS') ||
    upper.includes('INSUFFICIENT FUNDS') ||
    upper.includes('INSUFFICIENT LAMPORTS')
  ) {
    return 'balance.insufficient'
  }

  return 'unknown'
}

export class JupiterSwapError extends Error {
  errorCode: string | null
  errorCategory: SwapErrorCategory
  requestId: string | null

  constructor(
    message: string,
    errorCode: string | null = null,
    errorCategory: SwapErrorCategory = 'unknown',
    requestId: string | null = null,
  ) {
    super(message)
    this.name = 'JupiterSwapError'
    this.errorCode = errorCode
    this.errorCategory = errorCategory
    this.requestId = requestId
  }
}

export interface SwapTokenArgs {
  input_mint: string
  output_mint: string
  amount: number
  slippageBps?: number
}

export interface SwapDryRunResult {
  dry_run: true
  would_swap: SwapTokenArgs
  message: string
}

export interface SwapSuccessResult {
  success: true
  tx: string
  input_mint: string
  output_mint: string
  /** Amount of input token consumed, in human-readable units (SOL, not lamports). */
  amount_in: number
  /** Amount of output token received, in human-readable units (SOL, not lamports). */
  amount_out: number
  referral_account: string | null
  referral_fee_bps_requested: number
  fee_bps_applied: number | null
  fee_mint: string | null
}

export interface SwapErrorResult {
  success: false
  error: string
  error_code?: string | null
  error_category?: SwapErrorCategory
  request_id?: string | null
}

export type SwapResult = SwapDryRunResult | SwapSuccessResult | SwapErrorResult

export async function swapToken({ input_mint, output_mint, amount, slippageBps }: SwapTokenArgs): Promise<SwapResult> {
  input_mint = normalizeMint(input_mint)
  output_mint = normalizeMint(output_mint)

  if (config.connection.dryRun) {
    return {
      dry_run: true,
      would_swap: { input_mint, output_mint, amount, ...(slippageBps != null ? { slippageBps } : {}) },
      message: 'DRY RUN — no transaction sent',
    }
  }

  const swapTimer = createTimer()
  try {
    log('swap', `${amount} of ${input_mint} → ${output_mint}`)
    logStructured({
      category: 'swap_start',
      message: `Swap initiated: ${amount} ${input_mint} → ${output_mint}`,
      metadata: { input_mint, output_mint, amount, slippageBps },
    })
    const wallet = getWalletKeypair()
    const connection = getConnection()

    // ─── Convert to smallest unit ──────────────────────────────
    let decimals = 9 // SOL default
    if (input_mint !== config.tokens.SOL && input_mint !== 'SOL') {
      const cached = _mintDecimalsCache.get(input_mint)
      if (typeof cached === 'number') {
        decimals = cached
      } else {
        const mintInfo = await withRpcRetry(() => connection.getParsedAccountInfo(new PublicKey(input_mint)), {
          label: 'getParsedAccountInfo',
        })
        const parsedData = mintInfo.value?.data
        decimals =
          parsedData && typeof parsedData === 'object' && 'parsed' in parsedData
            ? ((parsedData as { parsed?: { info?: { decimals?: number } } }).parsed?.info?.decimals ?? 9)
            : 9
        _mintDecimalsCache.set(input_mint, decimals)
      }
    }
    const amountStr = Math.floor(amount * 10 ** decimals).toString()

    // ─── Get Swap V2 order (unsigned tx + requestId) ───────────
    const search = new URLSearchParams({
      inputMint: input_mint,
      outputMint: output_mint,
      amount: amountStr,
      taker: wallet.publicKey.toString(),
    })
    if (slippageBps != null && !Number.isNaN(slippageBps)) {
      search.set('slippageBps', String(slippageBps))
    }
    const referralParams = getJupiterReferralParams()
    if (referralParams) {
      search.set('referralAccount', referralParams.referralAccount)
      search.set('referralFee', String(referralParams.referralFee))
    }
    const orderUrl = `${JUPITER_SWAP_V2_API}/order?${search.toString()}`
    const jupiterApiKey = getJupiterApiKey()

    // ─── Guard: Jupiter API key required for Swap V2 ──────────
    if (!jupiterApiKey) {
      const msg =
        'JUPITER_API_KEY is not set — cannot execute swap. Get a free key at https://developers.jup.ag/portal/'
      log('swap_error', msg)
      throw new Error(msg)
    }

    const orderRes = await fetchWithRateLimitRetry(orderUrl, {
      headers: jupiterApiKey ? { 'x-api-key': jupiterApiKey } : {},
    })
    if (!orderRes.ok) {
      const body = await orderRes.text()
      let parsed: {
        errorCode?: string
        errorMessage?: string
        error?: string
        message?: string
        requestId?: string
      } | null = null
      try {
        parsed = JSON.parse(body)
      } catch {
        // body wasn't valid JSON
      }

      const rawCode = parsed?.errorCode || parsed?.error || null
      const errorCategory = classifyJupiterError(rawCode || parsed?.errorMessage || parsed?.message || body)
      const jupiterRequestId = parsed?.requestId || null

      logStructured({
        category: 'api_error',
        message: `Jupiter order failed: HTTP ${orderRes.status}`,
        metadata: {
          api: 'jup.ag/swap/v2/order',
          status: orderRes.status,
          statusText: orderRes.statusText,
          rateLimitReset: orderRes.headers?.get ? orderRes.headers.get('x-ratelimit-reset') : null,
          bodySnippet: body.slice(0, 200),
          errorCode: rawCode,
          errorCategory,
          jupiterRequestId,
        },
      })
      throw new JupiterSwapError(
        `Swap V2 order failed: ${orderRes.status} ${body}`,
        rawCode,
        errorCategory,
        jupiterRequestId,
      )
    }

    const order = (await orderRes.json()) as {
      errorCode?: string
      errorMessage?: string
      error?: string
      message?: string
      transaction?: string
      requestId?: string
      feeBps?: number
      feeMint?: string
    }
    if (order.errorCode || order.errorMessage || order.error) {
      const rawCode = order.errorCode || order.error || null
      const errorCategory = classifyJupiterError(rawCode || order.errorMessage || order.message)
      throw new JupiterSwapError(
        `Swap V2 order error: ${order.errorMessage || order.error || order.errorCode}`,
        rawCode,
        errorCategory,
        order.requestId || null,
      )
    }

    const { transaction: unsignedTx, requestId } = order
    if (!unsignedTx) {
      throw new Error('Swap V2 order missing transaction')
    }

    // ─── Deserialize and sign ─────────────────────────────────
    const tx = VersionedTransaction.deserialize(Buffer.from(unsignedTx, 'base64'))
    tx.sign([wallet])
    const signedTx = Buffer.from(tx.serialize()).toString('base64')

    // ─── Execute ───────────────────────────────────────────────
    const execRes = await fetchWithRateLimitRetry(`${JUPITER_SWAP_V2_API}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': jupiterApiKey!,
      },
      body: JSON.stringify({ signedTransaction: signedTx, requestId }),
    })
    if (!execRes.ok) {
      const body = await execRes.text()
      let parsed: any = null
      try {
        parsed = JSON.parse(body)
      } catch {}
      const rawCode = parsed?.errorCode || parsed?.error || null
      const errorCategory = classifyJupiterError(rawCode || parsed?.errorMessage || body)
      throw new JupiterSwapError(
        `Swap V2 execute failed: ${execRes.status} ${body}`,
        rawCode,
        errorCategory,
        parsed?.requestId || requestId || null,
      )
    }

    const result = (await execRes.json()) as {
      status?: string
      code?: string
      signature?: string
      // Jupiter V2 /execute returns raw on-chain integers (lamports for SOL / base-units for SPL).
      // Divide by 1e9 below before exposing to callers as human-readable SOL.
      inputAmountResult?: number
      outputAmountResult?: number
    }
    if (result.status === 'Failed') {
      const errorCategory = classifyJupiterError(result.code)
      throw new JupiterSwapError(
        `Swap failed on-chain: code=${result.code}`,
        result.code || null,
        errorCategory,
        requestId || null,
      )
    }

    log('swap', `SUCCESS tx: ${result.signature}`)
    invalidateBalanceCache()
    logStructured({
      category: 'swap_finish',
      message: `Swap completed: ${result.signature}`,
      metadata: {
        tx: result.signature,
        input_mint,
        output_mint,
        amount_in: result.inputAmountResult,
        amount_out: result.outputAmountResult,
        duration_ms: swapTimer.stop(),
      },
    })
    if (referralParams && order.feeBps !== referralParams.referralFee) {
      log(
        'swap_warn',
        `Jupiter referral fee requested ${referralParams.referralFee} bps but order applied ${order.feeBps ?? 'unknown'} bps`,
      )
    }

    return {
      success: true,
      tx: result.signature!,
      input_mint,
      output_mint,
      // Convert from Jupiter lamport integers to human-readable SOL units.
      amount_in: (result.inputAmountResult ?? 0) / 1e9,
      amount_out: (result.outputAmountResult ?? 0) / 1e9,
      referral_account: referralParams?.referralAccount || null,
      referral_fee_bps_requested: referralParams?.referralFee || 0,
      fee_bps_applied: order.feeBps ?? null,
      fee_mint: order.feeMint ?? null,
    }
  } catch (error: unknown) {
    const e = error as { message?: string }
    const jupiterError = error instanceof JupiterSwapError ? error : null
    const errorCode = jupiterError?.errorCode ?? null
    const errorCategory = jupiterError?.errorCategory ?? classifyJupiterError(e.message || String(error))
    const jupiterRequestId = jupiterError?.requestId ?? null

    log('swap_error', e.message || String(error))
    logStructured({
      category: 'swap_error',
      message: `Swap failed: ${e.message || String(error)}`,
      metadata: {
        input_mint,
        output_mint,
        amount,
        error: e.message || String(error),
        errorCode,
        errorCategory,
        jupiterRequestId,
        duration_ms: swapTimer?.stop?.() ?? 0,
      },
    })
    return {
      success: false,
      error: e.message || String(error),
      error_code: errorCode,
      error_category: errorCategory,
      request_id: jupiterRequestId,
    }
  }
}
