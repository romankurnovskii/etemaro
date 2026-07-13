/**
 * @file PnLAdapter.ts
 * @description Computes live position PnL from on-chain DLMM state and Meteora deposit-history API, using Jupiter for token prices.
 *
 * @features
 * - computePositions fetches all DLMM positions for a wallet via SDK and enriches them with PnL
 * - getPnlConnection lazily creates a Solana RPC connection (pump.helius)
 * - Deposit-history cache is invalidated by latest on-chain signature and TTL
 * - Supports SOL and USD valuation modes via config.management.solMode
 *
 * @dependencies @solana/web3.js, @meteora-ag/dlmm
 * @sideEffects Reads on-chain state; fetches Jupiter and Meteora APIs; updates in-memory position range flags
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { config } from "../config/Config.js";
import { log } from "../shared/logger.js";
// State module not yet converted to TS — import from repo root
// @ts-ignore — state.js has no type declarations yet
import { getTrackedPosition, markOutOfRange, markInRange, minutesOutOfRange } from "../domain/state.js";

// ─── Public-infra PnL engine ───────────────────────────────────
// Live position value (current liquidity + claimable fees) is read ON-CHAIN
// via the Meteora DLMM SDK on a public RPC (pump.helius). Deposit history
// (cost basis, withdrawals, claimed fees) comes ONLY from the Meteora /pnl
// API — its precomputed live pnl/balances are intentionally ignored. Token
// USD prices come from Jupiter. No LPAgent / agentmeridian dependency, so the
// poller can run aggressively on fully public resources.

const JUP_SEARCH = "https://datapi.jup.ag/v1/assets/search";
const METEORA_PNL = "https://dlmm.datapi.meteora.ag/positions";

// Lazy SDK load — mirrors tools/dlmm.js (CJS dir-imports break in ESM at import time).
let _DLMM: any = null;
async function loadDlmmSdk(): Promise<any> {
  if (!_DLMM) {
    const mod = await import("@meteora-ag/dlmm");
    _DLMM = mod.default;
  }
  return _DLMM;
}

let _pnlConnection: Connection | null = null;
export function getPnlConnection(): Connection {
  if (!_pnlConnection) {
    _pnlConnection = new Connection(config.pnl.rpcUrl, "confirmed");
  }
  return _pnlConnection;
}

function safeNum(value: unknown): number {
  const n = parseFloat(String(value ?? 0));
  return Number.isFinite(n) ? n : 0;
}

function round(value: number, decimals = 4): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

function maybeNum(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

function uniqueArr<T>(arr: T[]): T[] {
  return [...new Set(arr.filter(Boolean as any))];
}

// ─── Meteora /pnl per pool (deposit history) ────────────────────
// Exported because tools/dlmm.js (getPositionPnl + the Meteora fallback path)
// also reads it.
export async function fetchDlmmPnlForPool(
  poolAddress: string,
  walletAddress: string,
): Promise<Record<string, any>> {
  const url = `${METEORA_PNL}/${poolAddress}/pnl?user=${walletAddress}&status=open&pageSize=100&page=1`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log("pnl_api", `HTTP ${res.status} for pool ${poolAddress.slice(0, 8)}: ${body.slice(0, 120)}`);
      return {};
    }
    const data = await res.json() as any;
    const positions = data.positions || data.data || [];
    const byAddress: Record<string, any> = {};
    for (const p of positions) {
      const addr = p.positionAddress || p.address || p.position;
      if (addr) byAddress[addr] = p;
    }
    return byAddress;
  } catch (e: any) {
    log("pnl_api", `Fetch error for pool ${poolAddress.slice(0, 8)}: ${e.message}`);
    return {};
  }
}

// ─── Jupiter prices (never cached) ──────────────────────────────
async function getJupiterPrices(mints: string[]): Promise<Record<string, number | null>> {
  const list = uniqueArr(mints.map((m) => String(m).trim()));
  if (!list.length) return {};
  try {
    const res = await fetch(`${JUP_SEARCH}?query=${list.join(",")}`, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`Jupiter ${res.status}`);
    const assets = await res.json() as any[];
    const out: Record<string, number | null> = {};
    for (const a of assets) out[a.id] = maybeNum(a.usdPrice);
    return out;
  } catch (e: any) {
    log("pnl_price", `Jupiter price fetch failed: ${e.message}`);
    return {};
  }
}

// ─── Deposit-history cache (sig-invalidated + TTL) ──────────────
// Deposits/withdrawals/claimed fees change only on a position tx; feePerTvl24h
// is a slow 24h pool stat. Cache per pool, refetch when any position's latest
// signature changes or the TTL lapses.
const _meteoraCache = new Map<string, { at: number; byPosition: Record<string, any>; sigByPosition: Record<string, string | null> }>();
let _pollCount = 0;

async function getLatestSig(conn: Connection, addr: string): Promise<string | null> {
  try {
    const sigs = await conn.getSignaturesForAddress(new PublicKey(addr), { limit: 1 });
    return sigs?.[0]?.signature ?? null;
  } catch {
    return null;
  }
}

interface FlatPosition {
  position: string;
  pool: string;
  baseMint: string | null;
  decX: number;
  decY: number;
  active: number | null;
  lower: number | null;
  upper: number | null;
  xRaw: unknown;
  yRaw: unknown;
  feeXRaw: unknown;
  feeYRaw: unknown;
}

async function getMeteoraData(
  conn: Connection,
  walletAddress: string,
  flat: FlatPosition[],
): Promise<Record<string, any>> {
  const ttlMs = Math.max(0, Number(config.pnl.depositCacheTtlSec ?? 300)) * 1000;
  const positionsByPool = new Map<string, string[]>();
  for (const f of flat) {
    if (!positionsByPool.has(f.pool)) positionsByPool.set(f.pool, []);
    positionsByPool.get(f.pool)!.push(f.position);
  }

  const byPosition: Record<string, any> = {};
  await Promise.all([...positionsByPool.entries()].map(async ([pool, positionAddrs]) => {
    const cached = _meteoraCache.get(pool);
    const sigByPosition: Record<string, string | null> = {};
    await Promise.all(positionAddrs.map(async (addr) => { sigByPosition[addr] = await getLatestSig(conn, addr); }));

    const ageOk = cached && Date.now() - cached.at < ttlMs;
    const sigsMatch = cached && positionAddrs.every((a) => cached.sigByPosition?.[a] === sigByPosition[a]);

    let data: Record<string, any>;
    if (ageOk && sigsMatch) {
      data = cached!.byPosition;
    } else {
      data = await fetchDlmmPnlForPool(pool, walletAddress);
      _meteoraCache.set(pool, { at: Date.now(), byPosition: data, sigByPosition });
    }
    for (const addr of positionAddrs) byPosition[addr] = data[addr] || null;
  }));

  return byPosition;
}

// ─── Build the shaped position object (matches getMyPositions output) ──
interface BuiltPosition {
  position: string;
  pool: string;
  pair: string;
  base_mint: string | null;
  lower_bin: number | null;
  upper_bin: number | null;
  active_bin: number | null;
  in_range: boolean;
  unclaimed_fees_usd: number;
  unclaimed_fees_true_usd: number;
  total_value_usd: number;
  total_value_true_usd: number;
  collected_fees_usd: number;
  collected_fees_true_usd: number;
  pnl_usd: number;
  pnl_true_usd: number;
  pnl_pct: number;
  pnl_pct_derived: number;
  pnl_pct_diff: number | null;
  pnl_pct_suspicious: boolean;
  fee_per_tvl_24h: number | null;
  age_minutes: number | null;
  minutes_out_of_range: number;
  instruction: string | null;
}

function buildPosition(
  f: FlatPosition,
  prices: Record<string, number | null>,
  solUsd: number | null,
  meteora: any,
  solMode: boolean,
): BuiltPosition {
  const priceX = f.baseMint ? (prices[f.baseMint] ?? 0) : 0;

  const xHuman = safeNum(f.xRaw) / 10 ** f.decX;
  const yHuman = safeNum(f.yRaw) / 10 ** f.decY;
  const balancesUsd = xHuman * priceX + yHuman * (solUsd ?? 0);
  const balancesSol = solUsd ? balancesUsd / solUsd : yHuman;

  const feeXHuman = safeNum(f.feeXRaw) / 10 ** f.decX;
  const feeYHuman = safeNum(f.feeYRaw) / 10 ** f.decY;
  const claimableUsd = feeXHuman * priceX + feeYHuman * (solUsd ?? 0);
  const claimableSol = solUsd ? claimableUsd / solUsd : feeYHuman;

  const depositsUsd = safeNum(meteora?.allTimeDeposits?.total?.usd);
  const depositsSol = safeNum(meteora?.allTimeDeposits?.total?.sol);
  const withdrawUsd = safeNum(meteora?.allTimeWithdrawals?.total?.usd);
  const withdrawSol = safeNum(meteora?.allTimeWithdrawals?.total?.sol);
  const claimedUsd = safeNum(meteora?.allTimeFees?.total?.usd);
  const claimedSol = safeNum(meteora?.allTimeFees?.total?.sol);

  const pnlUsd = balancesUsd + withdrawUsd + claimableUsd + claimedUsd - depositsUsd;
  const pnlSol = balancesSol + withdrawSol + claimableSol + claimedSol - depositsSol;
  const pctUsd = depositsUsd > 0 ? (pnlUsd / depositsUsd) * 100 : 0;
  const pctSol = depositsSol > 0 ? (pnlSol / depositsSol) * 100 : 0;

  const ourPct = solMode ? pctSol : pctUsd;

  const reportedPct = solMode ? maybeNum(meteora?.pnlSolPctChange) : maybeNum(meteora?.pnlPctChange);
  const pnlPctDiff = reportedPct != null ? Math.abs(ourPct - reportedPct) : null;

  const holdsTokenX = xHuman > 0 || feeXHuman > 0;
  const priceMissing = !(solUsd! > 0) || (holdsTokenX && !!f.baseMint && !(priceX > 0));
  const depositsMissing = (solMode ? depositsSol : depositsUsd) <= 0;
  const pnlPctSuspicious = priceMissing || depositsMissing;
  if (pnlPctSuspicious) {
    log("pnl_warn", `${f.position.slice(0, 8)} suspicious tick — priceMissing=${priceMissing} depositsMissing=${depositsMissing} (solUsd=${solUsd}, priceX=${priceX})`);
  }

  const inRange = f.active != null && f.lower != null && f.upper != null
    ? f.active >= f.lower && f.active <= f.upper
    : (meteora ? !meteora.isOutOfRange : true);

  if (inRange) markInRange(f.position);
  else markOutOfRange(f.position);

  const tracked = getTrackedPosition(f.position);
  const ageFromState = tracked?.deployed_at
    ? Math.floor((Date.now() - new Date(tracked.deployed_at).getTime()) / 60000)
    : null;
  const ageMinutes = meteora?.createdAt ? Math.floor((Date.now() - meteora.createdAt * 1000) / 60000) : ageFromState;

  return {
    position:           f.position,
    pool:               f.pool,
    pair:               tracked?.pool_name || (meteora ? `${meteora.tokenX ?? "?"}/${meteora.tokenY ?? "SOL"}` : "?/SOL"),
    base_mint:          f.baseMint,
    lower_bin:          f.lower ?? tracked?.bin_range?.min ?? null,
    upper_bin:          f.upper ?? tracked?.bin_range?.max ?? null,
    active_bin:         f.active ?? tracked?.bin_range?.active ?? null,
    in_range:           inRange,
    unclaimed_fees_usd: round(solMode ? claimableSol : claimableUsd),
    unclaimed_fees_true_usd: round(claimableUsd),
    total_value_usd:    round(solMode ? balancesSol : balancesUsd),
    total_value_true_usd: round(balancesUsd),
    collected_fees_usd: round(solMode ? claimedSol : claimedUsd),
    collected_fees_true_usd: round(claimedUsd),
    pnl_usd:            round(solMode ? pnlSol : pnlUsd),
    pnl_true_usd:       round(pnlUsd),
    pnl_pct:            round(ourPct, 2),
    pnl_pct_derived:    round(ourPct, 2),
    pnl_pct_diff:       pnlPctDiff != null ? round(pnlPctDiff, 2) : null,
    pnl_pct_suspicious: !!pnlPctSuspicious,
    fee_per_tvl_24h:    meteora ? Math.round(safeNum(meteora.feePerTvl24h) * 100) / 100 : null,
    age_minutes:        ageMinutes,
    minutes_out_of_range: minutesOutOfRange(f.position),
    instruction:        tracked?.instruction ?? null,
  };
}

// ─── Main entry: compute positions from public infra ────────────
// Returns the same shape as getMyPositions, or throws so the caller can
// fall back to the Meteora-API path.
interface ComputePositionsResult {
  wallet: string;
  total_positions: number;
  positions: BuiltPosition[];
  source: string;
}

export async function computePositions(walletAddress: string): Promise<ComputePositionsResult> {
  const solMode = !!config.management?.solMode;
  const SOL_MINT = config.tokens.SOL;
  const conn = getPnlConnection();
  const DLMM = await loadDlmmSdk();

  const map = await DLMM.getAllLbPairPositionsByUser(conn, new PublicKey(walletAddress));
  _pollCount++;
  if (_pollCount % 20 === 1) {
    const n = [...mapEntries(map)].reduce((s, [, i]) => s + (i?.lbPairPositionsData?.length ?? 0), 0);
    log("pnl_tick", `poller alive — ${n} position(s) tracked (tick #${_pollCount})`);
  }

  const flat: FlatPosition[] = [];
  for (const [lbPairKey, info] of mapEntries(map)) {
    const decX = info?.tokenX?.mint?.decimals ?? 9;
    const decY = info?.tokenY?.mint?.decimals ?? 9;
    const baseMint: string | null = info?.tokenX?.mint?.address?.toString?.() ?? null;
    const active: number | null = info?.lbPair?.activeId ?? null;
    for (const p of info?.lbPairPositionsData || []) {
      const d = p.positionData || {};
      flat.push({
        position: p.publicKey.toString(),
        pool: lbPairKey,
        baseMint,
        decX,
        decY,
        active,
        lower: d.lowerBinId ?? null,
        upper: d.upperBinId ?? null,
        xRaw: d.totalXAmount,
        yRaw: d.totalYAmount,
        feeXRaw: d.feeX?.toString?.() ?? d.feeX ?? 0,
        feeYRaw: d.feeY?.toString?.() ?? d.feeY ?? 0,
      });
    }
  }

  if (flat.length === 0) {
    return { wallet: walletAddress, total_positions: 0, positions: [], source: "rpc" };
  }

  const [prices, meteoraByPosition] = await Promise.all([
    getJupiterPrices([SOL_MINT, ...flat.map((f) => f.baseMint).filter(Boolean) as string[]]),
    getMeteoraData(conn, walletAddress, flat),
  ]);
  const solUsd = prices[SOL_MINT] ?? null;

  const positions = flat.map((f) => buildPosition(f, prices, solUsd, meteoraByPosition[f.position], solMode));

  return { wallet: walletAddress, total_positions: positions.length, positions, source: "rpc" };
}

function mapEntries(map: any): [string, any][] {
  return map instanceof Map ? [...map.entries()] : Object.entries(map || {});
}
