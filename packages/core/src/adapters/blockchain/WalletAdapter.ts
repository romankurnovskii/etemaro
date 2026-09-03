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
import { configPath } from '../../shared/constants.js'
import { createTimer, log, logStructured } from '../../shared/logger.js'
import { loadJsonFile, saveJsonFile, withRpcRetry } from '../../shared/utils.js'
import { sleep } from '../../utils/time.js'
import { getConnection, getWalletAddress, getWalletKeypair, withRpcFailover } from '../../shared/connection.js'
import type { WalletBalancesResult } from '../../shared/types.js'

export interface GeneratedWallet {
  publicKey: string
  privateKey: string
  createdAt: string
  label?: string
}

export interface WalletsStore {
  wallets: GeneratedWallet[]
}

/**
 * Generates a fresh Solana keypair, stores it in wallets.json under the config directory,
 * and returns the public key and base58 private key.
 */
/**
 * Import a wallet from a Base58 private key and store it with a label.
 * If a file path is provided, reads a Solana CLI keypair JSON array.
 */
export function importWallet(opts: {
  label: string
  privateKey?: string
  filePath?: string
}): GeneratedWallet {
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
  const wallet: GeneratedWallet = {
    publicKey: kp.publicKey.toBase58(),
    privateKey: key,
    createdAt: new Date().toISOString(),
    label: opts.label,
  }
  // Persist
  const targetFile = configPath('wallets.json')
  const existing = loadJsonFile<WalletsStore>(targetFile, { wallets: [] })
  existing.wallets = existing.wallets || []
  existing.wallets.push(wallet)
  saveJsonFile(targetFile, existing)
log('wallet', `Imported wallet ${wallet.publicKey} as ${opts.label}`)
  return wallet
}

/**
 * Generates a fresh Solana keypair, stores it in wallets.json under the config directory,
 * and returns the public key and base58 private key.
 */
export function generateNewWallet(opts?: { label?: string; configDir?: string }): GeneratedWallet {
  const kp = Keypair.generate()
  const publicKey = kp.publicKey.toBase58()
  const privateKey = bs58.encode(kp.secretKey)
  const wallet: GeneratedWallet = {
    publicKey,
    privateKey,
    createdAt: new Date().toISOString(),
    label: opts?.label || 'Generated Keypair',
  }

  try {
    const targetFile = opts?.configDir ? path.join(opts.configDir, 'wallets.json') : configPath('wallets.json')
    const existing = loadJsonFile<WalletsStore>(targetFile, { wallets: [] })
    existing.wallets = existing.wallets || []
    existing.wallets.push(wallet)
    saveJsonFile(targetFile, existing)
    log('wallet', `Generated and stored new wallet ${publicKey} to ${targetFile}`)
  } catch (err: unknown) {
    const e = err as { message?: string }
    log('wallet', `Warning: Failed to persist generated wallet to wallets.json: ${e.message || err}`)
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
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')

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

export type { WalletBalancesResult }

/**
 * Get current wallet balances: SOL, USDC, and all SPL tokens.
 * Primary method: standard on-chain Solana RPC + free Jupiter Price API v2 (0 Helius credit cost).
 * Optional fallback: Helius Enhanced API if on-chain RPC fails.
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
    // ─── 1. Primary Method: Standard Solana RPC + Jupiter Price API ─
    try {
      const solLamports = await withRpcFailover((conn) => conn.getBalance(walletPubkey), { label: 'getBalance' })
      const solBalance = (solLamports || 0) / 1e9

      const tokenAccounts = await withRpcFailover(
        (conn) => conn.getParsedTokenAccountsByOwner(walletPubkey, { programId: TOKEN_PROGRAM_ID }),
        { label: 'getParsedTokenAccountsByOwner' },
      )

      const tokensList: Array<{ mint: string; symbol: string; balance: number; usd: number | null }> = []
      const mintsToPrice: string[] = [SOL_MINT, USDC_MINT]

      for (const item of tokenAccounts.value || []) {
        const info = item.account?.data?.parsed?.info
        if (!info) continue
        const mint = info.mint
        const decimals = info.tokenAmount?.decimals
        if (typeof decimals === 'number') {
          _mintDecimalsCache.set(mint, decimals)
        }
        const uiAmount = info.tokenAmount?.uiAmount ?? 0
        if (uiAmount <= 0) continue
        if (!mintsToPrice.includes(mint)) mintsToPrice.push(mint)
        tokensList.push({
          mint,
          symbol: mint === USDC_MINT ? 'USDC' : mint.slice(0, 8),
          balance: uiAmount,
          usd: null,
        })
      }

      // Fetch prices from Jupiter Price API v2
      const prices: Record<string, number> = {}
      try {
        const priceUrl = `https://api.jup.ag/price/v2?ids=${mintsToPrice.join(',')}`
        const jupHeaders: Record<string, string> = {}
        const jupApiKey = getJupiterApiKey()
        if (jupApiKey) jupHeaders['x-api-key'] = jupApiKey
        const pRes = await fetchWithRateLimitRetry(priceUrl, { headers: jupHeaders }, { attempts: 2 })
        if (pRes.ok) {
          const pData = (await pRes.json()) as { data?: Record<string, { price?: string }> }
          if (pData?.data) {
            for (const [m, pObj] of Object.entries(pData.data)) {
              const pNum = Number(pObj?.price)
              if (Number.isFinite(pNum)) prices[m] = pNum
            }
          }
        }
} catch (pErr: unknown) {
    const e = pErr as { message?: string }
    log('wallet_warn', `Jupiter Price API fetch failed: ${e.message || pErr}`)
  }

      const solPrice = prices[SOL_MINT] || 0
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
    let HELIUS_API_KEY = config.connection?.heliusApiKey || process.env.HELIUS_API_KEY
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
            return (await res.json()) as { balances?: Array<{ mint: string; symbol?: string; balance: number; pricePerToken?: number; usdValue?: number }>; totalUsdValue?: number }
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

    return {
      wallet: walletAddress,
      sol: 0,
      sol_price: 0,
      sol_usd: 0,
      usdc: 0,
      tokens: [],
      total_usd: 0,
      error: 'Failed to fetch balances via Solana RPC or Helius API',
    }
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

interface SwapTokenArgs {
  input_mint: string
  output_mint: string
  amount: number
}

interface SwapDryRunResult {
  dry_run: true
  would_swap: SwapTokenArgs
  message: string
}

interface SwapSuccessResult {
  success: true
  tx: string
  input_mint: string
  output_mint: string
  amount_in: number
  amount_out: number
  referral_account: string | null
  referral_fee_bps_requested: number
  fee_bps_applied: number | null
  fee_mint: string | null
}

interface SwapErrorResult {
  success: false
  error: string
}

type SwapResult = SwapDryRunResult | SwapSuccessResult | SwapErrorResult

export async function swapToken({ input_mint, output_mint, amount }: SwapTokenArgs): Promise<SwapResult> {
  input_mint = normalizeMint(input_mint)
  output_mint = normalizeMint(output_mint)

  if (config.connection.dryRun) {
    return {
      dry_run: true,
      would_swap: { input_mint, output_mint, amount },
      message: 'DRY RUN — no transaction sent',
    }
  }

  const swapTimer = createTimer()
  try {
    log('swap', `${amount} of ${input_mint} → ${output_mint}`)
    logStructured({
      category: 'swap_start',
      message: `Swap initiated: ${amount} ${input_mint} → ${output_mint}`,
      metadata: { input_mint, output_mint, amount },
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
      logStructured({
        category: 'api_error',
        message: `Jupiter order failed: HTTP ${orderRes.status}`,
        metadata: {
          api: 'jup.ag/swap/v2/order',
          status: orderRes.status,
          statusText: orderRes.statusText,
          rateLimitReset: orderRes.headers.get('x-ratelimit-reset'),
          bodySnippet: body.slice(0, 200),
        },
      })
      throw new Error(`Swap V2 order failed: ${orderRes.status} ${body}`)
    }

    const order = (await orderRes.json()) as { errorCode?: string; errorMessage?: string; transaction?: string; requestId?: string; feeBps?: number; feeMint?: string }
    if (order.errorCode || order.errorMessage) {
      throw new Error(`Swap V2 order error: ${order.errorMessage || order.errorCode}`)
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
      throw new Error(`Swap V2 execute failed: ${execRes.status} ${await execRes.text()}`)
    }

    const result = (await execRes.json()) as { status?: string; code?: string; signature?: string; inputAmountResult?: number; outputAmountResult?: number }
    if (result.status === 'Failed') {
      throw new Error(`Swap failed on-chain: code=${result.code}`)
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
        amount_in: result.inputAmountResult!,
        amount_out: result.outputAmountResult!,
        referral_account: referralParams?.referralAccount || null,
        referral_fee_bps_requested: referralParams?.referralFee || 0,
        fee_bps_applied: order.feeBps ?? null,
        fee_mint: order.feeMint ?? null,
      }
  } catch (error: unknown) {
    const e = error as { message?: string }
    log('swap_error', e.message || String(error))
    logStructured({
      category: 'swap_error',
      message: `Swap failed: ${e.message || String(error)}`,
      metadata: {
        input_mint,
        output_mint,
        amount,
        error: e.message || String(error),
        duration_ms: swapTimer?.stop?.() ?? 0,
      },
    })
    return { success: false, error: e.message || String(error) }
  }
}
