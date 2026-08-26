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

import { Connection, PublicKey, VersionedTransaction, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import path from 'node:path';
import { log, logStructured, createTimer } from '../../shared/logger.js';
import { config } from '../../config/Config.js';
import { configPath } from '../../shared/constants.js';
import { loadJsonFile, saveJsonFile } from '../../shared/utils.js';

export interface GeneratedWallet {
  publicKey: string;
  privateKey: string;
  createdAt: string;
  label?: string;
}

export interface WalletsStore {
  wallets: GeneratedWallet[];
}

/**
 * Generates a fresh Solana keypair, stores it in wallets.json under the config directory,
 * and returns the public key and base58 private key.
 */
export function generateNewWallet(opts?: { label?: string; configDir?: string }): GeneratedWallet {
  const kp = Keypair.generate();
  const publicKey = kp.publicKey.toBase58();
  const privateKey = bs58.encode(kp.secretKey);
  const wallet: GeneratedWallet = {
    publicKey,
    privateKey,
    createdAt: new Date().toISOString(),
    label: opts?.label || 'Generated Keypair',
  };

  try {
    const targetFile = opts?.configDir ? path.join(opts.configDir, 'wallets.json') : configPath('wallets.json');
    const existing = loadJsonFile<WalletsStore>(targetFile, { wallets: [] });
    existing.wallets = existing.wallets || [];
    existing.wallets.push(wallet);
    saveJsonFile(targetFile, existing);
    log('wallet', `Generated and stored new wallet ${publicKey} to ${targetFile}`);
  } catch (err: any) {
    log('wallet', `Warning: Failed to persist generated wallet to wallets.json: ${err.message}`);
  }

  return wallet;
}

let _connection: Connection | null = null;
let _wallet: Keypair | null = null;

function getConnection(): Connection {
  if (!_connection) _connection = new Connection(process.env.RPC_URL!, 'confirmed');
  return _connection;
}

function getWallet(): Keypair {
  if (!_wallet) {
    if (!process.env.WALLET_PRIVATE_KEY) throw new Error('WALLET_PRIVATE_KEY not set');
    _wallet = Keypair.fromSecretKey(bs58.decode(process.env.WALLET_PRIVATE_KEY));
  }
  return _wallet;
}

const JUPITER_SWAP_V2_API = 'https://api.jup.ag/swap/v2';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface RateLimitRetryOptions {
  attempts?: number;
  fallbackDelayMs?: number;
}

/**
 * Fetch with retry on transient Jupiter rate-limit responses (429) and
 * misdirected-request (421) responses. Jupiter exposes `x-ratelimit-reset`
 * (Unix seconds) on 429 responses — wait until that moment so the sliding
 * window frees a slot, falling back to a fixed delay when the header is absent.
 */
async function fetchWithRateLimitRetry(url: string, init: RequestInit = {}, opts: RateLimitRetryOptions = {}): Promise<Response> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const fallbackDelayMs = Math.max(0, opts.fallbackDelayMs ?? 2000);
  let lastResponse: Response | null = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = await fetch(url, init);
    if (res.status !== 429 && res.status !== 421) return res;
    lastResponse = res;
    const resetHeader = res.headers.get('x-ratelimit-reset');
    const waitMs = resetHeader ? Math.max(0, Number(resetHeader) * 1000 - Date.now()) : fallbackDelayMs;
    log('swap_warn', `Jupiter responded ${res.status} (attempt ${attempt}/${attempts}) — waiting ${waitMs}ms before retry`);
    if (attempt < attempts) await sleep(waitMs);
  }
  return lastResponse!;
}

function getJupiterApiKey(): string | undefined {
  return config.jupiter.apiKey || process.env.JUPITER_API_KEY;
}

interface JupiterReferralParams {
  referralAccount: string;
  referralFee: number;
}

function getJupiterReferralParams(): JupiterReferralParams | null {
  const referralAccount = String(config.jupiter.referralAccount || '').trim();
  const referralFee = Number(config.jupiter.referralFeeBps || 0);
  if (!referralAccount || !Number.isFinite(referralFee) || referralFee <= 0) {
    return null;
  }
  if (referralFee < 50 || referralFee > 255) {
    log('swap_warn', `Ignoring Jupiter referral fee ${referralFee}; Ultra requires 50-255 bps`);
    return null;
  }
  try {
    new PublicKey(referralAccount);
  } catch {
    log('swap_warn', 'Ignoring invalid Jupiter referral account');
    return null;
  }
  return { referralAccount, referralFee: Math.round(referralFee) };
}

interface WalletBalancesResult {
  wallet: string | null;
  sol: number;
  sol_price: number;
  sol_usd: number;
  usdc: number;
  tokens: Array<{
    mint: string;
    symbol: string;
    balance: number;
    usd: number | null;
  }>;
  total_usd: number;
  error?: string;
}

/**
 * Get current wallet balances: SOL, USDC, and all SPL tokens using Helius Wallet API.
 * Returns USD-denominated values provided by Helius.
 */
export async function getWalletBalances(): Promise<WalletBalancesResult> {
  let walletAddress: string | null;
  try {
    walletAddress = getWallet().publicKey.toString();
  } catch {
    return { wallet: null, sol: 0, sol_price: 0, sol_usd: 0, usdc: 0, tokens: [], total_usd: 0, error: 'Wallet not configured' };
  }

  let HELIUS_API_KEY = process.env.HELIUS_API_KEY;
  if (!HELIUS_API_KEY) {
    log('wallet_error', 'HELIUS_API_KEY not set in .env');
    return { wallet: walletAddress, sol: 0, sol_price: 0, sol_usd: 0, usdc: 0, tokens: [], total_usd: 0, error: 'Helius API key missing' };
  }

  // Normalize: strip "api-key=" prefix if copy-pasted with parameter name
  // TODO: deprecate such workaround
  HELIUS_API_KEY = HELIUS_API_KEY.trim().replace(/^api-key=/i, '');

  try {
    const url = `https://api.helius.xyz/v1/wallet/${walletAddress}/balances?api-key=${HELIUS_API_KEY}`;
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`Helius API error: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as any;
    const balances = data.balances || [];

    // ─── Find SOL and USDC ────────────────────────────────────
    const solEntry = balances.find((b: any) => b.mint === config.tokens.SOL || b.symbol === 'SOL');
    const usdcEntry = balances.find((b: any) => b.mint === config.tokens.USDC || b.symbol === 'USDC');

    const solBalance = solEntry?.balance || 0;
    const solPrice = solEntry?.pricePerToken || 0;
    const solUsd = solEntry?.usdValue || 0;
    const usdcBalance = usdcEntry?.balance || 0;

    // ─── Map all tokens ───────────────────────────────────────
    const enrichedTokens = balances.map((b: any) => ({
      mint: b.mint,
      symbol: b.symbol || b.mint.slice(0, 8),
      balance: b.balance,
      usd: b.usdValue ? Math.round(b.usdValue * 100) / 100 : null,
    }));

    return {
      wallet: walletAddress,
      sol: Math.round(solBalance * 1e6) / 1e6,
      sol_price: Math.round(solPrice * 100) / 100,
      sol_usd: Math.round(solUsd * 100) / 100,
      usdc: Math.round(usdcBalance * 100) / 100,
      tokens: enrichedTokens,
      total_usd: Math.round((data.totalUsdValue || 0) * 100) / 100,
    };
  } catch (error: any) {
    log('wallet_error', error.message);
    return {
      wallet: walletAddress,
      sol: 0,
      sol_price: 0,
      sol_usd: 0,
      usdc: 0,
      tokens: [],
      total_usd: 0,
      error: error.message,
    };
  }
}

const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Normalize any SOL-like address to the correct wrapped SOL mint
export function normalizeMint(mint: string): string {
  if (!mint) return mint;
  if (
    mint === 'SOL' ||
    mint === 'native' ||
    /^So1+$/.test(mint) ||
    (mint.length >= 32 && mint.length <= 44 && mint.startsWith('So1') && mint !== SOL_MINT)
  ) {
    return SOL_MINT;
  }
  return mint;
}

interface SwapTokenArgs {
  input_mint: string;
  output_mint: string;
  amount: number;
}

interface SwapDryRunResult {
  dry_run: true;
  would_swap: SwapTokenArgs;
  message: string;
}

interface SwapSuccessResult {
  success: true;
  tx: string;
  input_mint: string;
  output_mint: string;
  amount_in: number;
  amount_out: number;
  referral_account: string | null;
  referral_fee_bps_requested: number;
  fee_bps_applied: number | null;
  fee_mint: string | null;
}

interface SwapErrorResult {
  success: false;
  error: string;
}

type SwapResult = SwapDryRunResult | SwapSuccessResult | SwapErrorResult;

export async function swapToken({ input_mint, output_mint, amount }: SwapTokenArgs): Promise<SwapResult> {
  input_mint = normalizeMint(input_mint);
  output_mint = normalizeMint(output_mint);

  if (process.env.DRY_RUN === 'true') {
    return {
      dry_run: true,
      would_swap: { input_mint, output_mint, amount },
      message: 'DRY RUN — no transaction sent',
    };
  }

  const swapTimer = createTimer();
  try {
    log('swap', `${amount} of ${input_mint} → ${output_mint}`);
    logStructured({
      category: 'swap_start',
      message: `Swap initiated: ${amount} ${input_mint} → ${output_mint}`,
      metadata: { input_mint, output_mint, amount },
    });
    const wallet = getWallet();
    const connection = getConnection();

    // ─── Convert to smallest unit ──────────────────────────────
    let decimals = 9; // SOL default
    if (input_mint !== config.tokens.SOL) {
      const mintInfo = await connection.getParsedAccountInfo(new PublicKey(input_mint));
      const parsedData = mintInfo.value?.data;
      decimals = parsedData && typeof parsedData === 'object' && 'parsed' in parsedData ? ((parsedData as any).parsed?.info?.decimals ?? 9) : 9;
    }
    const amountStr = Math.floor(amount * Math.pow(10, decimals)).toString();

    // ─── Get Swap V2 order (unsigned tx + requestId) ───────────
    const search = new URLSearchParams({
      inputMint: input_mint,
      outputMint: output_mint,
      amount: amountStr,
      taker: wallet.publicKey.toString(),
    });
    const referralParams = getJupiterReferralParams();
    if (referralParams) {
      search.set('referralAccount', referralParams.referralAccount);
      search.set('referralFee', String(referralParams.referralFee));
    }
    const orderUrl = `${JUPITER_SWAP_V2_API}/order?${search.toString()}`;
    const jupiterApiKey = getJupiterApiKey();

    // ─── Guard: Jupiter API key required for Swap V2 ──────────
    if (!jupiterApiKey) {
      const msg = 'JUPITER_API_KEY is not set — cannot execute swap. Get a free key at https://developers.jup.ag/portal/';
      log('swap_error', msg);
      throw new Error(msg);
    }

    const orderRes = await fetchWithRateLimitRetry(orderUrl, {
      headers: jupiterApiKey ? { 'x-api-key': jupiterApiKey } : {},
    });
    if (!orderRes.ok) {
      const body = await orderRes.text();
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
      });
      throw new Error(`Swap V2 order failed: ${orderRes.status} ${body}`);
    }

    const order = (await orderRes.json()) as any;
    if (order.errorCode || order.errorMessage) {
      throw new Error(`Swap V2 order error: ${order.errorMessage || order.errorCode}`);
    }

    const { transaction: unsignedTx, requestId } = order;

    // ─── Deserialize and sign ─────────────────────────────────
    const tx = VersionedTransaction.deserialize(Buffer.from(unsignedTx, 'base64'));
    tx.sign([wallet]);
    const signedTx = Buffer.from(tx.serialize()).toString('base64');

    // ─── Execute ───────────────────────────────────────────────
    const execRes = await fetchWithRateLimitRetry(`${JUPITER_SWAP_V2_API}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(jupiterApiKey ? { 'x-api-key': jupiterApiKey } : {}),
      },
      body: JSON.stringify({ signedTransaction: signedTx, requestId }),
    });
    if (!execRes.ok) {
      throw new Error(`Swap V2 execute failed: ${execRes.status} ${await execRes.text()}`);
    }

    const result = (await execRes.json()) as any;
    if (result.status === 'Failed') {
      throw new Error(`Swap failed on-chain: code=${result.code}`);
    }

    log('swap', `SUCCESS tx: ${result.signature}`);
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
    });
    if (referralParams && order.feeBps !== referralParams.referralFee) {
      log('swap_warn', `Jupiter referral fee requested ${referralParams.referralFee} bps but order applied ${order.feeBps ?? 'unknown'} bps`);
    }

    return {
      success: true,
      tx: result.signature,
      input_mint,
      output_mint,
      amount_in: result.inputAmountResult,
      amount_out: result.outputAmountResult,
      referral_account: referralParams?.referralAccount || null,
      referral_fee_bps_requested: referralParams?.referralFee || 0,
      fee_bps_applied: order.feeBps ?? null,
      fee_mint: order.feeMint ?? null,
    };
  } catch (error: any) {
    log('swap_error', error.message);
    logStructured({
      category: 'swap_error',
      message: `Swap failed: ${error.message}`,
      metadata: { input_mint, output_mint, amount, error: error.message, duration_ms: swapTimer?.stop?.() ?? 0 },
    });
    return { success: false, error: error.message };
  }
}

// ─── Expose wallet/connection for other adapters ─────────────
export function getWalletAddress(): string | null {
  try {
    return getWallet().publicKey.toString();
  } catch {
    return null;
  }
}

export function getWalletKeypair(): Keypair | null {
  try {
    return getWallet();
  } catch {
    return null;
  }
}
