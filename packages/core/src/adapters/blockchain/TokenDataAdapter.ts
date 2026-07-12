import { config } from "../../config/Config.js";
import { getGmgnTokenFees, hasGmgnApiKey } from "../external/GmgnClient.js";
import type { SmartWallet } from "../../shared/types.js";

const DATAPI_BASE = "https://datapi.jup.ag/v1";

interface TokenNarrativeResult {
  mint: string;
  narrative: string | null;
  status: string;
}

interface TokenSearchAudit {
  mint_disabled: boolean | null;
  freeze_disabled: boolean | null;
  top_holders_pct: string | null;
  bot_holders_pct: string | null;
  dev_migrations: number | null;
}

interface TokenSearchStats1h {
  price_change: string | null;
  buy_vol: string | null;
  sell_vol: string | null;
  buyers: number | null;
  net_buyers: number | null;
}

interface TokenSearchResult {
  mint: string;
  name: string;
  symbol: string;
  mcap: number;
  price: number;
  liquidity: number;
  holders: number;
  organic_score: number;
  organic_label: string | null;
  launchpad: string | null;
  graduated: boolean;
  global_fees_sol: number | null;
  audit: TokenSearchAudit | null;
  stats_1h: TokenSearchStats1h | null;
  stats_24h_net_buyers: number | null;
}

interface TokenInfoResponse {
  found: boolean;
  query: string;
  results?: TokenSearchResult[];
}

interface SmartWalletPnl {
  balance: number;
  balance_usd: number;
  avg_cost: number;
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  total_pnl_pct: number;
  buys: number;
  sells: number;
  wins: number;
  bought_value: number;
  sold_value: number;
  first_active: number;
  last_active: number;
  holding_days: number | null;
}

interface SmartWalletHolder {
  name: string;
  category: string;
  address: string;
  pct: number | null;
  sol_balance: unknown;
  pnl: SmartWalletPnl | null;
}

interface HolderEntry {
  address: string;
  amount: number;
  pct: number | null;
  sol_balance: unknown;
  tags?: string[];
  is_pool?: boolean;
  funding?: {
    address: string;
    amount: number;
    slot: number;
  };
}

interface TokenHoldersResponse {
  mint: string;
  global_fees_sol: number | null;
  total_fetched: number;
  showing: number;
  top_10_real_holders_pct: string;
  smart_wallets_holding: SmartWalletHolder[];
  holders: HolderEntry[];
}

// Resolve the global_fees_sol gate value. GMGN's /v1/token/info total_fee is the
// accurate all-time fee figure; Jupiter's `fees` is slightly off and misleading.
// Falls back to the Jupiter value when GMGN is disabled / keyless / errors.
async function resolveGlobalFeesSol(mint: string | null, jupiterFees: number | null | undefined): Promise<number | null> {
  const jup = jupiterFees != null ? parseFloat(jupiterFees.toFixed(2)) : null;
  if (!mint || config.gmgn.feeSource !== "gmgn" || !hasGmgnApiKey()) return jup;
  const fees = await getGmgnTokenFees(mint);
  if (fees?.total_fee != null) return parseFloat(fees.total_fee.toFixed(2));
  return jup;
}

/**
 * Get the narrative/story behind a token from Jupiter ChainInsight.
 * Useful for understanding if a token has a real community/theme vs nothing.
 */
export async function getTokenNarrative({ mint }: { mint: string }): Promise<TokenNarrativeResult> {
  const res = await fetch(`${DATAPI_BASE}/chaininsight/narrative/${mint}`);
  if (!res.ok) throw new Error(`Narrative API error: ${res.status}`);
  const data = await res.json() as Record<string, unknown>;
  return {
    mint,
    narrative: (data.narrative as string) || null,
    status: data.status as string,
  };
}

/**
 * Search for token data by name, symbol, or mint address.
 * Returns condensed token info useful for confidence scoring.
 */
export async function getTokenInfo({ query }: { query: string }): Promise<TokenInfoResponse> {
  const url = `${DATAPI_BASE}/assets/search?query=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Token search API error: ${res.status}`);
  const data = await res.json();
  const tokens = Array.isArray(data) ? data : [data];
  if (!tokens.length) return { found: false, query };

  const results: TokenSearchResult[] = tokens.slice(0, 5).map((t: any) => ({
    mint: t.id,
    name: t.name,
    symbol: t.symbol,
    mcap: t.mcap,
    price: t.usdPrice,
    liquidity: t.liquidity,
    holders: t.holderCount,
    organic_score: t.organicScore,
    organic_label: t.organicScoreLabel,
    launchpad: t.launchpad,
    graduated: !!t.graduatedPool,
    global_fees_sol: t.fees != null ? parseFloat(t.fees.toFixed(2)) : null,
    audit: t.audit ? {
      mint_disabled: t.audit.mintAuthorityDisabled,
      freeze_disabled: t.audit.freezeAuthorityDisabled,
      top_holders_pct: t.audit.topHoldersPercentage?.toFixed(2),
      bot_holders_pct: t.audit.botHoldersPercentage?.toFixed(2),
      dev_migrations: t.audit.devMigrations,
    } : null,
    stats_1h: t.stats1h ? {
      price_change: t.stats1h.priceChange?.toFixed(2),
      buy_vol: t.stats1h.buyVolume?.toFixed(0),
      sell_vol: t.stats1h.sellVolume?.toFixed(0),
      buyers: t.stats1h.numOrganicBuyers,
      net_buyers: t.stats1h.numNetBuyers,
    } : null,
    stats_24h_net_buyers: t.stats24h ? t.stats24h.numNetBuyers : null,
  }));

  // Refine the primary match's fee figure from GMGN (the gate value consumers read).
  if (results[0]?.mint) {
    results[0].global_fees_sol = await resolveGlobalFeesSol(results[0].mint, tokens[0]?.fees);
  }

  return { found: true, query, results };
}

/**
 * Get holder distribution for a token mint.
 * Fetches top 100 holders — caller decides how many to display.
 */
export async function getTokenHolders({ mint, limit = 20 }: { mint: string; limit?: number }): Promise<TokenHoldersResponse> {
  // Fetch holders and total supply in parallel
  const [holdersRes, tokenRes] = await Promise.all([
    fetch(`${DATAPI_BASE}/holders/${mint}?limit=100`),
    fetch(`${DATAPI_BASE}/assets/search?query=${mint}`),
  ]);
  if (!holdersRes.ok) throw new Error(`Holders API error: ${holdersRes.status}`);
  const data: any = await holdersRes.json();
  const tokenData: any = tokenRes.ok ? await tokenRes.json() : null;
  const tokenInfo = Array.isArray(tokenData) ? tokenData[0] : tokenData;
  const totalSupply: number | null = tokenInfo?.totalSupply || tokenInfo?.circSupply || null;

  const holders = Array.isArray(data) ? data : (data.holders || data.data || []);

  const mapped: HolderEntry[] = holders.slice(0, Math.min(limit, 100)).map((h: any) => {
    const tags: string[] = (h.tags || []).map((t: any) => t.name || t.id || t);
    const isPool = tags.some((t: string) => /pool|amm|liquidity|raydium|orca|meteora/i.test(t));
    const pct = totalSupply ? (Number(h.amount) / totalSupply) * 100 : (h.percentage ?? h.pct ?? null);
    return {
      address: h.address || h.wallet,
      amount: h.amount,
      pct: pct != null ? parseFloat(pct.toFixed(4)) : null,
      sol_balance: h.solBalanceDisplay ?? h.solBalance,
      tags: tags.length ? tags : undefined,
      is_pool: isPool || undefined,
      funding: h.addressInfo?.fundingAddress ? {
        address: h.addressInfo.fundingAddress,
        amount: h.addressInfo.fundingAmount,
        slot: h.addressInfo.fundingSlot,
      } : undefined,
    };
  });

  const realHolders = mapped.filter((h) => !h.is_pool);
  const top10Pct = realHolders.slice(0, 10).reduce((s, h) => s + (Number(h.pct) || 0), 0);

  // ─── Smart Wallet / KOL Cross-reference ──────────────────────
  let smartWalletsHolding: SmartWalletHolder[] = [];
  try {
    const smartWalletsMod = await import("../../domain/smart-wallets.js");
    const smartWallets: SmartWallet[] = smartWalletsMod.listSmartWallets().wallets;

    if (smartWallets.length > 0) {
      const addresses = smartWallets.map((w: SmartWallet) => w.address).join(",");
      const kwRes = await fetch(
        `${DATAPI_BASE}/holders/${mint}?addresses=${addresses}`
      ).catch(() => null);
      const kwData: any = kwRes?.ok ? await kwRes.json() : null;
      const kwHolders: any[] = Array.isArray(kwData) ? kwData : (kwData?.holders || kwData?.data || []);

      const smartWalletMap = new Map(smartWallets.map((w: SmartWallet) => [w.address, w]));
      const matchedHolders = kwHolders
        .map((h: any) => ({ ...h, addr: h.address || h.wallet }))
        .filter((h: any) => smartWalletMap.has(h.addr));

      await Promise.all(matchedHolders.map(async (h: any) => {
        const wallet = smartWalletMap.get(h.addr);
        const pct = totalSupply ? parseFloat(((Number(h.amount) / totalSupply) * 100).toFixed(4)) : null;

        let pnl: SmartWalletPnl | null = null;
        try {
          const pnlRes = await fetch(`${DATAPI_BASE}/pnl-positions?address=${h.addr}&assetId=${mint}`);
          if (pnlRes.ok) {
            const pnlData = await pnlRes.json() as Record<string, any>;
            const pos = pnlData?.[h.addr]?.tokenPositions?.[0];
            if (pos) pnl = {
              balance: pos.balance,
              balance_usd: pos.balanceValue,
              avg_cost: pos.averageCost,
              realized_pnl: pos.realizedPnl,
              unrealized_pnl: pos.unrealizedPnl,
              total_pnl: pos.totalPnl,
              total_pnl_pct: pos.totalPnlPercentage,
              buys: pos.totalBuys,
              sells: pos.totalSells,
              wins: pos.totalWins,
              bought_value: pos.boughtValue,
              sold_value: pos.soldValue,
              first_active: pos.firstActiveTime,
              last_active: pos.lastActiveTime,
              holding_days: pos.holdingPeriodInSeconds ? Math.round(pos.holdingPeriodInSeconds / 86400) : null,
            };
          }
        } catch { /* ignore */ }

        smartWalletsHolding.push({
          name: wallet!.name,
          category: wallet!.category,
          address: h.addr,
          pct,
          sol_balance: h.solBalanceDisplay ?? h.solBalance,
          pnl,
        });
      }));
    }
  } catch {
    // SmartWallets module not yet available in adapter layer — skip cross-reference
  }

  return {
    mint,
    global_fees_sol: await resolveGlobalFeesSol(mint, tokenInfo?.fees),
    total_fetched: holders.length,
    showing: mapped.length,
    top_10_real_holders_pct: top10Pct.toFixed(2),
    smart_wallets_holding: smartWalletsHolding,
    holders: mapped,
  };
}
