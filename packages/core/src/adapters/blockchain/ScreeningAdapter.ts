/**
 * Screening adapter — pool discovery, filtering, scoring, PVP detection.
 * Ported from tools/screening.js with full TypeScript types.
 */

import { config } from "../../config/Config.js";
import { log } from "../../shared/logger.js";

import { isBlacklisted } from "../../domain/token-blacklist.js";
import { isDevBlocked, getBlockedDevs } from "../../domain/dev-blocklist.js";
import { isBaseMintOnCooldown, isPoolOnCooldown } from "../../domain/pool-memory.js";
import { confirmIndicatorPreset } from "../indicators/ChartIndicatorsAdapter.js";
import type { IndicatorConfirmation } from "../indicators/ChartIndicatorsAdapter.js";
export type { IndicatorConfirmation } from "../indicators/ChartIndicatorsAdapter.js";
import { getAgentMeridianBase, getAgentMeridianHeaders } from "../external/AgentMeridianClient.js";

// ─── Constants ─────────────────────────────────────────────────

const DATAPI_JUP = "https://datapi.jup.ag/v1";
const POOL_DISCOVERY_BASE = "https://pool-discovery-api.datapi.meteora.ag";
const MIN_VOLATILITY_TIMEFRAME = "30m";
const TIMEFRAME_MINUTES: Record<string, number> = {
  "5m": 5,
  "30m": 30,
  "1h": 60,
  "2h": 120,
  "4h": 240,
  "12h": 720,
  "24h": 1440,
};
const DEGEN_REFERENCE_MINUTES = 30;
const PVP_SHORTLIST_LIMIT = 2;
const PVP_RIVAL_LIMIT = 2;
const PVP_MIN_ACTIVE_TVL = 5_000;
const PVP_MIN_HOLDERS = 500;
const PVP_MIN_GLOBAL_FEES_SOL = 30;

// ─── Types ─────────────────────────────────────────────────────

export interface RawPool {
  pool_address?: string;
  name?: string;
  token_x?: {
    symbol?: string;
    address?: string;
    organic_score?: number;
    market_cap?: number;
    warnings?: unknown[];
    dev?: string;
    created_at?: number;
    launchpad?: string;
    launchpad_platform?: string;
    [key: string]: unknown;
  };
  token_y?: {
    symbol?: string;
    address?: string;
    organic_score?: number;
    [key: string]: unknown;
  };
  base_token_holders?: number;
  base_token_market_cap?: number;
  base_token_launchpad?: string;
  base_token_has_critical_warnings?: boolean;
  quote_token_has_critical_warnings?: boolean;
  base_token_has_high_supply_concentration?: boolean;
  base_token_has_high_single_ownership?: boolean;
  pool_type?: string;
  tvl?: number;
  active_tvl?: number;
  fee?: number;
  volume?: number;
  fee_pct?: number;
  fee_active_tvl_ratio?: number;
  volatility?: number;
  volatility_timeframe?: string;
  bin_step?: number;
  dlmm_params?: { bin_step?: number };
  discord_signal?: boolean;
  discord_signal_count?: number;
  discord_signal_seen_count?: number;
  discord_signal_first_seen_at?: string | null;
  discord_signal_last_seen_at?: string | null;
  active_positions?: number;
  active_positions_pct?: number;
  open_positions?: number;
  pool_price?: number;
  pool_price_change_pct?: number;
  price_trend?: string;
  min_price?: number;
  max_price?: number;
  volume_change_pct?: number;
  fee_change_pct?: number;
  swap_count?: number;
  unique_traders?: number;
  volume_active_tvl_ratio?: number;
  unique_lps?: number;
  unique_lps_change_pct?: number;
  positions_created?: number;
  base?: { symbol?: string; mint?: string; [key: string]: unknown };
  quote?: { symbol?: string; mint?: string; [key: string]: unknown };
  pool?: string;
  dev?: string;
  is_pvp?: boolean;
  pvp_risk?: string;
  pvp_symbol?: string;
  pvp_rival_name?: string;
  pvp_rival_mint?: string;
  pvp_rival_pool?: string;
  pvp_rival_tvl?: number;
  pvp_rival_holders?: number;
  pvp_rival_fees?: number;
  indicator_confirmation?: IndicatorConfirmation | null;
  [key: string]: unknown;
}

export interface CondensedPool {
  pool: string;
  name: string | null;
  base: { symbol: string | null; mint: string | null; organic: number; warnings: number };
  quote: { symbol: string | null; mint: string | null };
  pool_type: string | null;
  bin_step: number | null;
  fee_pct: number | null;
  tvl: number | null;
  active_tvl: number | null;
  fee_window: number | null;
  volume_window: number | null;
  fee_active_tvl_ratio: number | null;
  volatility: number | null;
  volatility_timeframe: string | null;
  holders: number | null;
  mcap: number | null;
  organic_score: number;
  token_age_hours: number | null;
  dev: string | null;
  launchpad: string | null;
  active_positions: number | null;
  active_pct: number | null;
  open_positions: number | null;
  discord_signal: boolean;
  discord_signal_count: number;
  discord_signal_seen_count: number;
  discord_signal_last_seen_at: string | null;
  price: number | null;
  price_change_pct: number | null;
  price_trend: string | null;
  min_price: number | null;
  max_price: number | null;
  volume_change_pct: number | null;
  fee_change_pct: number | null;
  swap_count: number | null;
  unique_traders: number | null;
  volume_active_tvl_ratio: number | null;
  unique_lps: number | null;
  unique_lps_change_pct: number | null;
  positions_created: number | null;
  [key: string]: unknown;
}

export interface FilteredExample {
  name: string;
  reason: string;
}

export interface DiscoverPoolsResult {
  total: number;
  pools: CondensedPool[];
  filtered_examples: FilteredExample[];
}

export interface TopCandidatesResult {
  candidates: CondensedPool[];
  total_screened: number;
  filtered_examples: FilteredExample[];
}

export interface PoolDetailResult {
  [key: string]: unknown;
}

// ─── Helpers ───────────────────────────────────────────────────

function normalizeSymbol(symbol: unknown): string {
  return String(symbol || "").trim().toUpperCase();
}

function numeric(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isUsableVolatility(value: unknown): boolean {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function includesCaseInsensitive(values: string[] | undefined | null, value: string | null | undefined): boolean {
  if (!Array.isArray(values) || values.length === 0 || !value) return false;
  const needle = String(value).toLowerCase();
  return values.some((entry) => String(entry).toLowerCase() === needle);
}

function getPoolLaunchpad(pool: RawPool): string | null {
  const base = pool?.token_x || {};
  return (base as any)?.launchpad ||
    (base as any)?.launchpad_platform ||
    pool?.base_token_launchpad ||
    (pool as any)?.launchpad ||
    (pool as any)?.launchpad_platform ||
    null;
}

function getPoolBaseMint(pool: RawPool): string | null {
  return pool?.token_x?.address ||
    (pool as any)?.base_token_address ||
    (pool as any)?.base_mint ||
    (pool as any)?.base?.mint ||
    null;
}

function getVolatilityTimeframe(sourceTimeframe: string): string {
  const source = String(sourceTimeframe || "").trim();
  const sourceMinutes = TIMEFRAME_MINUTES[source];
  const minMinutes = TIMEFRAME_MINUTES[MIN_VOLATILITY_TIMEFRAME]!;
  return sourceMinutes != null && sourceMinutes >= minMinutes ? source : MIN_VOLATILITY_TIMEFRAME;
}

function round(n: number | null | undefined): number | null {
  return n != null ? Math.round(n) : null;
}

function fix(n: number | null | undefined, decimals: number): number | null {
  const value = Number(n);
  return Number.isFinite(value) ? Number(value.toFixed(decimals)) : null;
}

function pushFilteredReason(list: FilteredExample[], pool: CondensedPool | RawPool, reason: string): void {
  if (!list || !pool) return;
  list.push({
    name: (pool as any).name || `${(pool as any).base?.symbol || "?"}-${(pool as any).quote?.symbol || "?"}`,
    reason,
  });
}

// ─── Scoring ───────────────────────────────────────────────────

export function scoreCandidate(pool: CondensedPool | RawPool): number {
  const feeTvl = Number((pool as any).fee_active_tvl_ratio || 0);
  const organic = Number((pool as any).organic_score || 0);
  const volume = Number((pool as any).volume_window || 0);
  const holders = Number((pool as any).holders || 0);
  return feeTvl * 1000 + organic * 10 + volume / 100 + holders / 100;
}

export function degenScore(pool: CondensedPool | RawPool, targets: Record<string, number> = {}): number {
  const {
    targetVolRatio = 20,
    targetLpCount = 40,
    targetFeeRatio = 0.20,
    targetLiquidity = 20000,
  } = targets;

  const La = Number((pool as any).active_tvl ?? (pool as any).tvl ?? 0);
  if (!Number.isFinite(La) || La <= 0) return 0;

  const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

  const tfMinutes = TIMEFRAME_MINUTES[config.screening.timeframe] || DEGEN_REFERENCE_MINUTES;
  const tfScale = DEGEN_REFERENCE_MINUTES / tfMinutes;

  const volRatio = Number((pool as any).volume_active_tvl_ratio);
  const tradingRatio = (Number.isFinite(volRatio) ? volRatio : Number((pool as any).volume_window || 0) / La) * tfScale;
  const feeRatio = (Number.isFinite(Number((pool as any).fee_active_tvl_ratio))
    ? Number((pool as any).fee_active_tvl_ratio)
    : Number((pool as any).fee_window || 0) / La) * tfScale;
  const lpActivity = (Number((pool as any).unique_lps || 0) + Number((pool as any).positions_created || 0)) * tfScale;

  const sTrading = clamp01(tradingRatio / targetVolRatio);
  const sLp      = clamp01(lpActivity / targetLpCount);
  const sFees    = clamp01(feeRatio / targetFeeRatio);
  const sLiq     = clamp01(Math.log10(La) / Math.log10(targetLiquidity));

  return (sTrading * sLp * sFees * sLiq) ** 0.25 * 100;
}

// ─── Raw pool screening reject reason ──────────────────────────

function getRawPoolScreeningRejectReason(pool: RawPool, s: typeof config.screening): string | null {
  const base = pool?.token_x || {};
  const quote = pool?.token_y || {};
  const binStep = numeric(pool?.dlmm_params?.bin_step);
  const tvl = numeric(pool?.tvl ?? pool?.active_tvl);
  const feeActiveTvlRatio = numeric(pool?.fee_active_tvl_ratio);
  const volatility = numeric(pool?.volatility);
  const volume = numeric(pool?.volume);
  const holders = numeric(pool?.base_token_holders);
  const mcap = numeric(base?.market_cap);
  const baseOrganic = numeric(base?.organic_score);
  const quoteOrganic = numeric(quote?.organic_score);
  const launchpad = getPoolLaunchpad(pool);
  const createdAt = numeric(base?.created_at);

  if (s.excludeHighSupplyConcentration && pool?.base_token_has_high_supply_concentration === true) {
    return "base token has high supply concentration";
  }
  if (pool?.base_token_has_critical_warnings === true) return "base token has critical warnings";
  if (pool?.quote_token_has_critical_warnings === true) return "quote token has critical warnings";
  if (pool?.base_token_has_high_single_ownership === true) return "base token has high single ownership";
  if (pool?.pool_type && pool.pool_type !== "dlmm") return `pool_type ${pool.pool_type} is not dlmm`;

  if (mcap == null || mcap < s.minMcap) return `mcap ${mcap ?? "unknown"} below minMcap ${s.minMcap}`;
  if (mcap > s.maxMcap) return `mcap ${mcap} above maxMcap ${s.maxMcap}`;
  if (holders == null || holders < s.minHolders) return `holders ${holders ?? "unknown"} below minHolders ${s.minHolders}`;
  if (volume == null || volume < s.minVolume) return `volume ${volume ?? "unknown"} below minVolume ${s.minVolume}`;
  if (tvl == null || tvl < s.minTvl) return `TVL ${tvl ?? "unknown"} below minTvl ${s.minTvl}`;
  if (s.maxTvl != null && tvl > s.maxTvl) return `TVL ${tvl} above maxTvl ${s.maxTvl}`;
  if (binStep == null || binStep < s.minBinStep) return `bin_step ${binStep ?? "unknown"} below minBinStep ${s.minBinStep}`;
  if (binStep > s.maxBinStep) return `bin_step ${binStep} above maxBinStep ${s.maxBinStep}`;
  if (feeActiveTvlRatio == null || feeActiveTvlRatio < s.minFeeActiveTvlRatio) {
    return `fee/active-TVL ${feeActiveTvlRatio ?? "unknown"} below minFeeActiveTvlRatio ${s.minFeeActiveTvlRatio}`;
  }
  if (!isUsableVolatility(volatility)) {
    return `volatility ${volatility ?? "unknown"} is unusable`;
  }
  if (baseOrganic == null || baseOrganic < s.minOrganic) {
    return `base organic ${baseOrganic ?? "unknown"} below minOrganic ${s.minOrganic}`;
  }
  if (quoteOrganic == null || quoteOrganic < s.minQuoteOrganic) {
    return `quote organic ${quoteOrganic ?? "unknown"} below minQuoteOrganic ${s.minQuoteOrganic}`;
  }
  if (
    pool?.discord_signal &&
    Array.isArray(s.allowedLaunchpads) &&
    s.allowedLaunchpads.length > 0 &&
    launchpad &&
    !includesCaseInsensitive(s.allowedLaunchpads, launchpad)
  ) {
    return `launchpad ${launchpad} not in allow-list`;
  }
  if (includesCaseInsensitive(s.blockedLaunchpads, launchpad)) {
    return `blocked launchpad (${launchpad})`;
  }
  if (s.minTokenAgeHours != null) {
    const maxCreatedAt = Date.now() - s.minTokenAgeHours * 3_600_000;
    if (createdAt == null || createdAt > maxCreatedAt) return `token age below minTokenAgeHours ${s.minTokenAgeHours}`;
  }
  if (s.maxTokenAgeHours != null) {
    const minCreatedAt = Date.now() - s.maxTokenAgeHours * 3_600_000;
    if (createdAt == null || createdAt < minCreatedAt) return `token age above maxTokenAgeHours ${s.maxTokenAgeHours}`;
  }
  return null;
}

// ─── Fetch helpers ─────────────────────────────────────────────

async function fetchDiscordSignalCandidates(): Promise<unknown[]> {
  const res = await fetch(`${getAgentMeridianBase()}/signals/discord/candidates`, {
    headers: getAgentMeridianHeaders(),
  });
  if (!res.ok) throw new Error(`discord signal candidates ${res.status}`);
  const data = await res.json();
  return Array.isArray((data as any)?.candidates) ? (data as any).candidates : [];
}

async function fetchPoolDiscoveryPage({
  page_size,
  filters,
  timeframe,
  category,
}: {
  page_size: number;
  filters: string;
  timeframe: string;
  category: string;
}): Promise<{ data: RawPool[]; total: number }> {
  const url = `${POOL_DISCOVERY_BASE}/pools?` +
    `page_size=${page_size}` +
    `&filter_by=${encodeURIComponent(filters)}` +
    `&timeframe=${timeframe}` +
    `&category=${category}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Pool Discovery API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<{ data: RawPool[]; total: number }>;
}

async function fetchPoolDiscoveryDetail({
  poolAddress,
  timeframe,
}: {
  poolAddress: string;
  timeframe: string;
}): Promise<RawPool | null> {
  const url = `${POOL_DISCOVERY_BASE}/pools?` +
    `page_size=1` +
    `&filter_by=${encodeURIComponent(`pool_address=${poolAddress}`)}` +
    `&timeframe=${timeframe}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Pool detail API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return ((data as any).data || [])[0] ?? null;
}

// ─── Volatility timeframe enrichment ───────────────────────────

async function applyVolatilityTimeframe(rawPools: RawPool[], sourceTimeframe: string): Promise<RawPool[]> {
  if (!Array.isArray(rawPools) || rawPools.length === 0) return rawPools;
  const volatilityTimeframe = getVolatilityTimeframe(sourceTimeframe);

  for (const pool of rawPools) {
    if (!pool) continue;
    (pool as any)[`volume_${sourceTimeframe}`] = pool.volume ?? null;
    (pool as any)[`volatility_${sourceTimeframe}`] = pool.volatility ?? null;
    pool.volatility_timeframe = volatilityTimeframe;
  }

  if (sourceTimeframe === volatilityTimeframe) return rawPools;

  const uniquePoolAddresses = [...new Set(rawPools.map((pool) => pool?.pool_address).filter(Boolean))] as string[];
  const longResults = await Promise.allSettled(
    uniquePoolAddresses.map((poolAddress) =>
      fetchPoolDiscoveryDetail({ poolAddress, timeframe: volatilityTimeframe })
        .then((pool) => ({
          poolAddress,
          volatility: numeric(pool?.volatility),
          volume: numeric(pool?.volume),
        }))
    )
  );

  const metricsByPool = new Map<string, { poolAddress: string; volatility: number | null; volume: number | null }>();
  for (const result of longResults) {
    if (result.status !== "fulfilled") continue;
    metricsByPool.set(result.value.poolAddress, result.value);
  }

  for (const pool of rawPools) {
    if (!pool?.pool_address) continue;
    const metrics = metricsByPool.get(pool.pool_address);
    if (!metrics) continue;

    (pool as any)[`volume_${volatilityTimeframe}`] = metrics.volume;
    (pool as any)[`volatility_${volatilityTimeframe}`] = metrics.volatility;

    if (metrics.volatility != null) pool.volatility = metrics.volatility;
    if (metrics.volume != null) pool.volume = metrics.volume;
  }

  return rawPools;
}

// ─── Jupiter asset search ──────────────────────────────────────

async function searchAssetsBySymbol(symbol: string): Promise<unknown[]> {
  const res = await fetch(`${DATAPI_JUP}/assets/search?query=${encodeURIComponent(symbol)}`);
  if (!res.ok) throw new Error(`assets/search ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [data];
}

// ─── Discord signal launchpad enrichment ───────────────────────

async function enrichDiscordSignalLaunchpads(rawPools: RawPool[]): Promise<void> {
  const missing = rawPools.filter((pool) =>
    pool?.discord_signal &&
    !getPoolLaunchpad(pool) &&
    getPoolBaseMint(pool)
  );
  if (missing.length === 0) return;

  const uniqueMints = [...new Set(missing.map(getPoolBaseMint).filter(Boolean))] as string[];
  const results = await Promise.allSettled(
    uniqueMints.map(async (mint) => {
      const assets = await searchAssetsBySymbol(mint);
      const asset = assets.find((item: any) => item?.id === mint) || assets[0] || null;
      return { mint, asset };
    })
  );

  const byMint = new Map<string, { launchpad: string; dev: string | null; holderCount: number | null; organicScore: number | null; marketCap: number | null; createdAt: number | null }>();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const asset = result.value.asset as any;
    const launchpad = asset?.launchpad || asset?.launchpadPlatform || null;
    if (!launchpad) continue;
    byMint.set(result.value.mint, {
      launchpad,
      dev: asset?.dev || null,
      holderCount: numeric(asset?.holderCount),
      organicScore: numeric(asset?.organicScore),
      marketCap: numeric(asset?.mcap ?? asset?.fdv),
      createdAt: asset?.createdAt ? Date.parse(asset.createdAt) : null,
    });
  }

  for (const pool of missing) {
    const mint = getPoolBaseMint(pool);
    if (!mint) continue;
    const asset = byMint.get(mint);
    if (!asset) continue;
    pool.token_x = pool.token_x || {} as any;
    (pool.token_x as any).launchpad = asset.launchpad;
    pool.base_token_launchpad = asset.launchpad;
    if (asset.dev && !pool.token_x!.dev) pool.token_x!.dev = asset.dev;
    if (asset.holderCount != null && pool.base_token_holders == null) pool.base_token_holders = asset.holderCount;
    if (asset.organicScore != null && pool.token_x!.organic_score == null) pool.token_x!.organic_score = asset.organicScore;
    if (asset.marketCap != null && pool.token_x!.market_cap == null) pool.token_x!.market_cap = asset.marketCap;
    if (asset.createdAt != null && pool.token_x!.created_at == null) pool.token_x!.created_at = asset.createdAt;
    log("screening", `Discord signal launchpad enriched from Jupiter: ${pool.name || mint} — ${asset.launchpad}`);
  }
}

// ─── PVP risk enrichment ──────────────────────────────────────

async function findRivalPool(mint: string): Promise<RawPool | null> {
  const url = `https://dlmm.datapi.meteora.ag/pools?query=${encodeURIComponent(mint)}&sort_by=${encodeURIComponent("tvl:desc")}&filter_by=${encodeURIComponent(`tvl>${PVP_MIN_ACTIVE_TVL}`)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`rival pool search ${res.status}`);
  const data = await res.json();
  const pools = Array.isArray((data as any)?.data) ? (data as any).data : [];
  return pools.find((pool: any) => pool?.token_x?.address === mint || pool?.token_y?.address === mint) || null;
}

async function enrichPvpRisk(pools: CondensedPool[]): Promise<void> {
  const shortlist = [...pools]
    .sort((a, b) => scoreCandidate(b) - scoreCandidate(a))
    .slice(0, PVP_SHORTLIST_LIMIT);

  if (shortlist.length === 0) return;

  const symbolCache = new Map<string, unknown[]>();

  await Promise.all(shortlist.map(async (pool) => {
    const symbol = normalizeSymbol(pool.base?.symbol);
    const ownMint = pool.base?.mint;
    if (!symbol || !ownMint) return;

    let assets = symbolCache.get(symbol);
    if (!assets) {
      assets = await searchAssetsBySymbol(symbol).catch(() => []);
      symbolCache.set(symbol, assets);
    }

    const rivalAssets = (assets as any[])
      .filter((asset) => normalizeSymbol(asset?.symbol) === symbol && asset?.id && asset.id !== ownMint)
      .sort((a, b) => Number(b?.liquidity || 0) - Number(a?.liquidity || 0))
      .slice(0, PVP_RIVAL_LIMIT);

    for (const rival of rivalAssets) {
      const rivalHolders = Number(rival?.holderCount || 0);
      const rivalFees = Number(rival?.fees || 0);
      if (rivalHolders < PVP_MIN_HOLDERS || rivalFees < PVP_MIN_GLOBAL_FEES_SOL) continue;

      const rivalPool = await findRivalPool(rival.id).catch(() => null);
      if (!rivalPool) continue;

      pool.is_pvp = true;
      pool.pvp_risk = "high";
      pool.pvp_symbol = pool.base?.symbol || symbol;
      pool.pvp_rival_name = rival?.name || pool.pvp_symbol;
      pool.pvp_rival_mint = rival.id;
      pool.pvp_rival_pool = rivalPool.pool_address || rivalPool.address as any;
      pool.pvp_rival_tvl = round(Number((rivalPool as any).tvl || 0));
      pool.pvp_rival_holders = rivalHolders;
      pool.pvp_rival_fees = Number(rivalFees.toFixed(2));
      log("screening", `PVP guard: ${pool.name} has active rival ${pool.pvp_rival_name} (${rival.id.slice(0, 8)})`);
      break;
    }
  }));
}

// ─── Discord-only pool refresh ─────────────────────────────────

async function refreshDiscordOnlyPools(pools: RawPool[], timeframe: string): Promise<void> {
  if (!pools.length) return;
  const FIELDS = ["volume", "fee", "active_tvl", "tvl", "volatility", "fee_active_tvl_ratio"];
  const results = await Promise.allSettled(
    pools.map((pool) =>
      fetchPoolDiscoveryDetail({ poolAddress: pool.pool_address!, timeframe })
        .then((fresh) => ({ pool, fresh }))
    )
  );
  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value.fresh) continue;
    const { pool, fresh } = result.value;
    for (const field of FIELDS) {
      const val = numeric((fresh as any)[field]);
      if (val != null) (pool as any)[field] = val;
    }
    log("screening", `Discord signal refreshed live data: ${pool.name || pool.pool_address} — vol=${(pool as any).volume?.toFixed(0)} fee=${(pool as any).fee?.toFixed(2)}`);
  }
}

// ─── Condense pool for LLM ────────────────────────────────────

function condensePool(p: RawPool): CondensedPool {
  return {
    pool: p.pool_address || (p as any).address || "",
    name: p.name || null,
    base: {
      symbol: p.token_x?.symbol || null,
      mint: p.token_x?.address || null,
      organic: Math.round(p.token_x?.organic_score || 0),
      warnings: (p.token_x?.warnings as any[])?.length || 0,
    },
    quote: {
      symbol: p.token_y?.symbol || null,
      mint: p.token_y?.address || null,
    },
    pool_type: p.pool_type || null,
    bin_step: (p as any).dlmm_params?.bin_step || null,
    fee_pct: p.fee_pct ?? null,
    tvl: round(p.tvl),
    active_tvl: round(p.active_tvl),
    fee_window: round(p.fee),
    volume_window: round(p.volume),
    fee_active_tvl_ratio: p.fee_active_tvl_ratio != null ? fix(p.fee_active_tvl_ratio, 4) : null,
    volatility: fix(p.volatility, 4),
    volatility_timeframe: p.volatility_timeframe || getVolatilityTimeframe(config.screening.timeframe),
    holders: p.base_token_holders ?? null,
    mcap: round(p.token_x?.market_cap),
    organic_score: Math.round(p.token_x?.organic_score || 0),
    token_age_hours: p.token_x?.created_at
      ? Math.floor((Date.now() - p.token_x.created_at) / 3_600_000)
      : null,
    dev: p.token_x?.dev || null,
    launchpad: getPoolLaunchpad(p),
    active_positions: (p as any).active_positions ?? null,
    active_pct: fix((p as any).active_positions_pct, 1),
    open_positions: (p as any).open_positions ?? null,
    discord_signal: Boolean(p.discord_signal),
    discord_signal_count: p.discord_signal_count || 0,
    discord_signal_seen_count: p.discord_signal_seen_count || 0,
    discord_signal_last_seen_at: p.discord_signal_last_seen_at || null,
    price: (p as any).pool_price ?? null,
    price_change_pct: fix((p as any).pool_price_change_pct, 1),
    price_trend: (p as any).price_trend ?? null,
    min_price: (p as any).min_price ?? null,
    max_price: (p as any).max_price ?? null,
    volume_change_pct: fix((p as any).volume_change_pct, 1),
    fee_change_pct: fix((p as any).fee_change_pct, 1),
    swap_count: (p as any).swap_count ?? null,
    unique_traders: (p as any).unique_traders ?? null,
    volume_active_tvl_ratio: (p as any).volume_active_tvl_ratio != null ? fix((p as any).volume_active_tvl_ratio, 4) : null,
    unique_lps: (p as any).unique_lps ?? null,
    unique_lps_change_pct: fix((p as any).unique_lps_change_pct, 1),
    positions_created: (p as any).positions_created ?? null,
  };
}

// ─── Main exports ──────────────────────────────────────────────

export async function discoverPools({
  page_size = 50,
} = {}): Promise<DiscoverPoolsResult> {
  const s = config.screening;
  const filters = [
    "base_token_has_critical_warnings=false",
    "quote_token_has_critical_warnings=false",
    s.excludeHighSupplyConcentration ? "base_token_has_high_supply_concentration=false" : null,
    "base_token_has_high_single_ownership=false",
    "pool_type=dlmm",
    `base_token_market_cap>=${s.minMcap}`,
    `base_token_market_cap<=${s.maxMcap}`,
    `base_token_holders>=${s.minHolders}`,
    `volume>=${s.minVolume}`,
    `tvl>=${s.minTvl}`,
    s.maxTvl != null ? `tvl<=${s.maxTvl}` : null,
    `dlmm_bin_step>=${s.minBinStep}`,
    `dlmm_bin_step<=${s.maxBinStep}`,
    `fee_active_tvl_ratio>=${s.minFeeActiveTvlRatio}`,
    `base_token_organic_score>=${s.minOrganic}`,
    `quote_token_organic_score>=${s.minQuoteOrganic}`,
    s.minTokenAgeHours != null ? `base_token_created_at<=${Date.now() - s.minTokenAgeHours * 3_600_000}` : null,
    s.maxTokenAgeHours != null ? `base_token_created_at>=${Date.now() - s.maxTokenAgeHours * 3_600_000}` : null,
    Array.isArray(s.allowedLaunchpads) && s.allowedLaunchpads.length > 0
      ? `base_token_launchpad=[${s.allowedLaunchpads.join(",")}]`
      : null,
  ].filter(Boolean).join("&&");

  const data = await fetchPoolDiscoveryPage({
    page_size,
    filters,
    timeframe: s.timeframe,
    category: s.category,
  });

  let rawPools: RawPool[] = Array.isArray(data.data) ? data.data : [];

  if (config.screening.useDiscordSignals) {
    const signalCandidates = await fetchDiscordSignalCandidates().catch((error) => {
      log("screening", `Discord signal fetch failed: ${error.message}`);
      return [];
    });
    const signalPools = (signalCandidates as any[])
      .map((candidate) => {
        const discoveryPool = candidate.discovery_pool;
        if (!discoveryPool?.pool_address) return null;
        return {
          ...discoveryPool,
          discord_signal: true,
          discord_signal_count: candidate.source_count || 1,
          discord_signal_seen_count: candidate.seen_count || 1,
          discord_signal_first_seen_at: candidate.first_seen_at || null,
          discord_signal_last_seen_at: candidate.last_seen_at || null,
        };
      })
      .filter(Boolean);

    if (config.screening.discordSignalMode === "only") {
      rawPools = signalPools;
      await refreshDiscordOnlyPools(rawPools, s.timeframe);
    } else if (signalPools.length > 0) {
      const byPool = new Map(rawPools.map((pool) => [pool.pool_address, pool]));
      const discordOnlyPools: RawPool[] = [];
      for (const signalPool of signalPools) {
        if (byPool.has(signalPool.pool_address)) {
          byPool.set(signalPool.pool_address, {
            ...byPool.get(signalPool.pool_address),
            discord_signal: true,
            discord_signal_count: signalPool.discord_signal_count,
            discord_signal_seen_count: signalPool.discord_signal_seen_count,
            discord_signal_first_seen_at: signalPool.discord_signal_first_seen_at,
            discord_signal_last_seen_at: signalPool.discord_signal_last_seen_at,
          });
        } else {
          byPool.set(signalPool.pool_address, signalPool);
          discordOnlyPools.push(signalPool);
        }
      }
      rawPools = Array.from(byPool.values());
      if (discordOnlyPools.length > 0) {
        await refreshDiscordOnlyPools(discordOnlyPools, s.timeframe);
      }
    }
  }

  rawPools = await applyVolatilityTimeframe(rawPools, s.timeframe);
  await enrichDiscordSignalLaunchpads(rawPools);

  const filteredExamples: FilteredExample[] = [];
  const thresholdedRawPools = rawPools.filter((pool) => {
    const reason = getRawPoolScreeningRejectReason(pool, s);
    if (!reason) return true;
    filteredExamples.push({ name: pool.name || pool.pool_address || "unknown pool", reason });
    if (pool.discord_signal) log("screening", `Discord signal filtered: ${pool.name || pool.pool_address} — ${reason}`);
    return false;
  });

  const condensed = thresholdedRawPools.map(condensePool);

  let pools = condensed.filter((p) => {
    if (isBlacklisted(p.base?.mint)) {
      log("blacklist", `Filtered blacklisted token ${p.base?.symbol} (${p.base?.mint?.slice(0, 8)}) in pool ${p.name}`);
      return false;
    }
    if (p.dev && isDevBlocked(p.dev)) {
      log("dev_blocklist", `Filtered blocked deployer ${p.dev?.slice(0, 8)} token ${p.base?.symbol} in pool ${p.name}`);
      return false;
    }
    return true;
  });

  const filtered = condensed.length - pools.length;
  if (filtered > 0) log("blacklist", `Filtered ${filtered} pool(s) with blacklisted tokens/devs`);

  const blockedDevs = getBlockedDevs();
  if (Object.keys(blockedDevs).length > 0) {
    const missingDev = pools.filter((p) => !p.dev && p.base?.mint);
    if (missingDev.length > 0) {
      const devResults = await Promise.allSettled(
        missingDev.map((p) =>
          fetch(`${DATAPI_JUP}/assets/search?query=${p.base!.mint}`)
            .then((r) => r.ok ? r.json() : null)
            .then((d) => {
              const t = Array.isArray(d) ? d[0] : d;
              return { pool: (p as any).pool, dev: (t as any)?.dev || null };
            })
            .catch(() => ({ pool: (p as any).pool, dev: null }))
        )
      );
      const devMap: Record<string, string | null> = {};
      for (const r of devResults) {
        if (r.status === "fulfilled") devMap[r.value.pool] = r.value.dev;
      }
      pools = pools.filter((p) => {
        const dev = devMap[(p as any).pool];
        if (dev) p.dev = dev;
        if (dev && isDevBlocked(dev)) {
          log("dev_blocklist", `Filtered blocked deployer (jup) ${dev.slice(0, 8)} token ${p.base?.symbol}`);
          return false;
        }
        return true;
      });
    }
  }

  return {
    total: data.total,
    pools,
    filtered_examples: filteredExamples,
  };
}

export async function getTopCandidates({ limit = 10 } = {}): Promise<TopCandidatesResult> {
  const discovery = await discoverPools({ page_size: 50 });
  const pools = discovery.pools;
  const filteredOut: FilteredExample[] = Array.isArray(discovery.filtered_examples) ? [...discovery.filtered_examples] : [];

  // Dynamic imports to avoid circular deps
  const { getMyPositions } = await import("./MeteoraAdapter.js");
  const { positions } = await getMyPositions();
  const occupiedPools = new Set(positions.map((p: any) => p.pool));
  const occupiedMints = new Set(positions.map((p: any) => p.base_mint).filter(Boolean));
  const minTvl = Number(config.screening.minTvl ?? 0);
  const maxTvl = config.screening.maxTvl == null ? null : Number(config.screening.maxTvl);
  const minFeeActiveTvlRatio = Number(config.screening.minFeeActiveTvlRatio ?? 0);

  const eligible = pools
    .filter((p) => {
      const tvl = Number(p.tvl ?? p.active_tvl ?? 0);
      if (Number.isFinite(minTvl) && minTvl > 0 && tvl < minTvl) {
        pushFilteredReason(filteredOut, p, `TVL $${tvl} below minTvl $${minTvl}`);
        return false;
      }
      if (Number.isFinite(maxTvl!) && maxTvl! > 0 && tvl > maxTvl!) {
        pushFilteredReason(filteredOut, p, `TVL $${tvl} above maxTvl $${maxTvl}`);
        return false;
      }
      const feeActiveTvlRatio = Number(p.fee_active_tvl_ratio);
      if (Number.isFinite(minFeeActiveTvlRatio) && minFeeActiveTvlRatio > 0 && (!Number.isFinite(feeActiveTvlRatio) || feeActiveTvlRatio < minFeeActiveTvlRatio)) {
        pushFilteredReason(filteredOut, p, `fee/active-TVL ${Number.isFinite(feeActiveTvlRatio) ? feeActiveTvlRatio : "unknown"} below minFeeActiveTvlRatio ${minFeeActiveTvlRatio}`);
        return false;
      }
      if (!isUsableVolatility(p.volatility)) {
        pushFilteredReason(filteredOut, p, `volatility ${p.volatility ?? "unknown"} is unusable`);
        return false;
      }
      if (occupiedPools.has(p.pool)) {
        pushFilteredReason(filteredOut, p, "already have an open position in this pool");
        return false;
      }
      if (occupiedMints.has(p.base?.mint)) {
        pushFilteredReason(filteredOut, p, "already holding this base token in another pool");
        return false;
      }
      if (isPoolOnCooldown(p.pool)) {
        log("screening", `Filtered cooldown pool ${p.name} (${p.pool.slice(0, 8)})`);
        pushFilteredReason(filteredOut, p, "pool cooldown active");
        return false;
      }
      if (isBaseMintOnCooldown(p.base?.mint)) {
        log("screening", `Filtered cooldown token ${p.base?.symbol} (${p.base?.mint?.slice(0, 8)})`);
        pushFilteredReason(filteredOut, p, "token cooldown active");
        return false;
      }
      return true;
    })
    .sort((a, b) => scoreCandidate(b) - scoreCandidate(a))
    .slice(0, limit);

  if (config.screening.avoidPvpSymbols && eligible.length > 0) {
    await enrichPvpRisk(eligible);
    if (config.screening.blockPvpSymbols) {
      const before = eligible.length;
      const pvpRemoved = eligible.filter((p) => p.is_pvp);
      pvpRemoved.forEach((p) => pushFilteredReason(filteredOut, p, "PVP hard filter"));
      eligible.splice(0, eligible.length, ...eligible.filter((p) => !p.is_pvp));
      if (eligible.length < before) {
        log("screening", `PVP hard filter removed ${before - eligible.length} pool(s)`);
      }
    }
  }

  if (eligible.length > 0) {
    const before = eligible.length;
    const filtered = eligible.filter((p) => {
      if (p.dev && isDevBlocked(p.dev)) {
        log("dev_blocklist", `Filtered blocked deployer ${p.dev.slice(0, 8)} token ${p.base?.symbol}`);
        pushFilteredReason(filteredOut, p, "blocked deployer");
        return false;
      }
      return true;
    });
    eligible.splice(0, eligible.length, ...filtered);
    if (eligible.length < before) log("dev_blocklist", `Filtered ${before - eligible.length} pool(s) via dev blocklist`);
  }

  if (config.indicators.enabled && eligible.length > 0) {
    const confirmations = await Promise.all(
      eligible.map(async (pool) => {
        try {
          const confirmation = await confirmIndicatorPreset({
            mint: pool.base?.mint!,
            side: "entry",
          });
          return { pool: pool.pool, confirmation };
        } catch (error: any) {
          return {
            pool: pool.pool,
            confirmation: {
              enabled: true,
              confirmed: true,
              skipped: true,
              reason: `Indicator confirmation unavailable: ${error.message}`,
              intervals: [],
            } as IndicatorConfirmation,
          };
        }
      }),
    );
    const confirmationByPool = new Map(confirmations.map((entry) => [entry.pool, entry.confirmation]));
    const before = eligible.length;
    const confirmedEligible = eligible.filter((pool) => {
      const confirmation = confirmationByPool.get(pool.pool);
      pool.indicator_confirmation = confirmation || null;
      if (!confirmation || confirmation.confirmed) return true;
      pushFilteredReason(filteredOut, pool, `indicator reject: ${confirmation.reason}`);
      log("screening", `Indicator rejected ${pool.name} (${pool.pool.slice(0, 8)}): ${confirmation.reason}`);
      return false;
    });
    eligible.splice(0, eligible.length, ...confirmedEligible);
    if (eligible.length < before) {
      log("screening", `Indicator confirmation removed ${before - eligible.length} candidate(s)`);
    }
  }

  return {
    candidates: eligible,
    total_screened: pools.length,
    filtered_examples: filteredOut.slice(0, 3),
  };
}

export async function getPoolDetail({
  pool_address,
  timeframe = "5m",
}: {
  pool_address: string;
  timeframe?: string;
}): Promise<PoolDetailResult> {
  const pool = await fetchPoolDiscoveryDetail({ poolAddress: pool_address, timeframe });
  if (!pool) {
    throw new Error(`Pool ${pool_address} not found`);
  }
  return pool as unknown as PoolDetailResult;
}
