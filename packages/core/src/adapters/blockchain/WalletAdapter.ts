import { Connection, PublicKey, VersionedTransaction, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { log } from '../../shared/logger.js';
import { config } from '../../config/Config.js';

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
const DEFAULT_JUPITER_API_KEY = 'b15d42e9-e0e4-4f90-a424-ae41ceeaa382';

function getJupiterApiKey(): string {
  return config.jupiter.apiKey || process.env.JUPITER_API_KEY || DEFAULT_JUPITER_API_KEY;
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

  let HELIUS_KEY = process.env.HELIUS_API_KEY;
  if (!HELIUS_KEY) {
    log('wallet_error', 'HELIUS_API_KEY not set in .env');
    return { wallet: walletAddress, sol: 0, sol_price: 0, sol_usd: 0, usdc: 0, tokens: [], total_usd: 0, error: 'Helius API key missing' };
  }

  // Normalize: strip "api-key=" prefix if copy-pasted with parameter name
  // TODO: deprecate such workaround
  HELIUS_KEY = HELIUS_KEY.trim().replace(/^api-key=/i, '');

  try {
    const url = `https://api.helius.xyz/v1/wallet/${walletAddress}/balances?api-key=${HELIUS_KEY}`;
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

  try {
    log('swap', `${amount} of ${input_mint} → ${output_mint}`);
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

    const orderRes = await fetch(orderUrl, {
      headers: jupiterApiKey ? { 'x-api-key': jupiterApiKey } : {},
    });
    if (!orderRes.ok) {
      const body = await orderRes.text();
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
    const execRes = await fetch(`${JUPITER_SWAP_V2_API}/execute`, {
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
