import { agentMeridianJson, getAgentMeridianHeaders } from '../external/AgentMeridianClient.js';

// ─── Types ─────────────────────────────────────────────────────

interface TopLPerPosition {
  pool: string;
  pair: string;
  hold_hours: number;
  pnl_usd: number;
  pnl_pct: string;
  fee_usd: number;
  in_range_pct: number | null;
  strategy: string | null;
  closed_reason: string | null;
  balance_usd: number;
  fee_per_tvl_24h_pct: number;
  range_width_pct: number | null;
  distance_to_active_pct: number | null;
  lower_bin_id: number | null;
  upper_bin_id: number | null;
}

interface TopLPerSummary {
  total_positions: number;
  avg_hold_hours: number;
  avg_open_pnl_pct: number;
  avg_fee_per_tvl_24h_pct: number;
  total_pnl_usd: number;
  total_balance_usd: number;
  avg_range_width_pct: number | null;
  avg_distance_to_active_pct: number | null;
  win_rate: number;
  roi: number;
  fee_pct_of_capital: number;
  preferred_strategy: string;
  preferred_range_style: string;
}

interface TopLPer {
  owner: string;
  owner_short: string;
  signal_tags: string[];
  summary: TopLPerSummary;
  positions: TopLPerPosition[];
}

interface StudyPatterns {
  top_lper_count: number;
  study_mode: string;
  pool_name: string;
  active_position_count: number;
  owner_count: number;
  avg_hold_hours: number;
  avg_open_pnl_pct: number;
  avg_fee_percent: number;
  avg_roi_pct: number;
  best_open_pnl_pct: string | null;
  scalper_count: number;
  holder_count: number;
  preferred_strategies: Record<string, number>;
  preferred_range_styles: Record<string, number>;
  top_historical_owners: unknown[];
  suggested_style: string | null;
}

export interface StudyTopLpersResult {
  pool: string;
  pool_name?: string;
  message: string;
  patterns: StudyPatterns | Record<string, never>;
  lpers: TopLPer[];
}

// ─── Helpers ───────────────────────────────────────────────────

function round(value: number, digits = 2): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(digits));
}

function isNum(value: unknown): boolean {
  return Number.isFinite(Number(value));
}

function fmtPct(value: unknown): string {
  const n = Number(value || 0);
  return `${n >= 0 ? '+' : ''}${round(n, 2)}%`;
}

function countValues(values: string[]): Record<string, number> {
  const map = new Map<string, number>();
  for (const value of values) {
    map.set(value, (map.get(value) || 0) + 1);
  }
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1]));
}

// ─── Fetch functions ───────────────────────────────────────────

function fetchTopLp(poolAddress: string): Promise<Record<string, unknown>> {
  return agentMeridianJson(`/top-lp/${poolAddress}`, {
    headers: getAgentMeridianHeaders(),
  }) as Promise<Record<string, unknown>>;
}

function fetchStudyTopLp(poolAddress: string): Promise<Record<string, unknown>> {
  return agentMeridianJson(`/study-top-lp/${poolAddress}`, {
    headers: getAgentMeridianHeaders(),
  }) as Promise<Record<string, unknown>>;
}

function buildPatterns(
  ranked: Record<string, unknown>[],
  historicalOwners: Record<string, unknown>[],
  signalData: Record<string, unknown>,
  overview: Record<string, unknown>,
): StudyPatterns {
  const avgHold = round(
    ranked
      .map((o) => Number(o.avgAgeHours))
      .filter(isNum)
      .reduce((s: number, v: number) => s + v, 0) / Math.max(1, ranked.filter((o) => isNum(o.avgAgeHours)).length),
  );
  const avgOpenPnlPct = round(
    ranked
      .map((o) => Number(o.pnlPerInflowPct))
      .filter(isNum)
      .reduce((s: number, v: number) => s + v, 0) / Math.max(1, ranked.filter((o) => isNum(o.pnlPerInflowPct)).length),
  );
  const avgFeePct = round(
    ranked
      .map((o) => Number(o.feePercent))
      .filter(isNum)
      .reduce((s: number, v: number) => s + v, 0) / Math.max(1, ranked.filter((o) => isNum(o.feePercent)).length),
  );
  const avgRoiPct = round(
    ranked
      .map((o) => Number(o.roiPct))
      .filter(isNum)
      .reduce((s: number, v: number) => s + v, 0) / Math.max(1, ranked.filter((o) => isNum(o.roiPct)).length),
  );
  const preferredStrategies = countValues(historicalOwners.map((o) => String(o.preferredStrategy || '')).filter(Boolean));
  const preferredRanges = countValues(historicalOwners.map((o) => String(o.preferredRangeStyle || '')).filter(Boolean));

  const tokenXSymbol = String(overview.tokenXSymbol || 'TOKEN');
  const tokenYSymbol = String(overview.tokenYSymbol || 'SOL');

  return {
    top_lper_count: ranked.length,
    study_mode: 'lpagent_top_lpers',
    pool_name: String(overview.name || `${tokenXSymbol}-${tokenYSymbol}`),
    active_position_count: Number(signalData.activePositionCount) || ranked.length,
    owner_count: Number(signalData.ownerCount) || ranked.length,
    avg_hold_hours: avgHold,
    avg_open_pnl_pct: avgOpenPnlPct,
    avg_fee_percent: avgFeePct,
    avg_roi_pct: avgRoiPct,
    best_open_pnl_pct: ranked[0] ? `${round(Number(ranked[0].pnlPerInflowPct) || 0, 2)}%` : null,
    scalper_count: ranked.filter((o) => (Number(o.avgAgeHours) || 0) < 1).length,
    holder_count: ranked.filter((o) => (Number(o.avgAgeHours) || 0) >= 4).length,
    preferred_strategies: preferredStrategies,
    preferred_range_styles: preferredRanges,
    top_historical_owners: (signalData.topHistoricalOwners as unknown[]) || [],
    suggested_style: (signalData.suggestedStyle as string) || null,
  };
}

// ─── Public API ────────────────────────────────────────────────

export async function studyTopLPers({ pool_address, limit = 4 }: { pool_address: string; limit?: number }): Promise<StudyTopLpersResult> {
  const [poolRes, signalRes] = await Promise.all([fetchTopLp(pool_address), fetchStudyTopLp(pool_address)]);

  const poolData = poolRes;
  const signalData = signalRes;
  const topLpers = Array.isArray(poolData.topLpers) ? poolData.topLpers : [];
  const historicalOwners = Array.isArray(poolData.historicalOwners) ? poolData.historicalOwners : [];
  const ranked = topLpers.slice(0, Math.max(1, limit));

  if (!ranked.length) {
    return {
      pool: pool_address,
      message: 'No LPAgent top LPer data found for this pool yet.',
      patterns: {},
      lpers: [],
    };
  }

  const historicalMap = new Map(historicalOwners.map((owner: Record<string, unknown>) => [owner.owner, owner]));

  const overview = (poolData.overview || {}) as Record<string, unknown>;
  const tokenXSymbol = String(overview.tokenXSymbol || 'TOKEN');
  const tokenYSymbol = String(overview.tokenYSymbol || 'SOL');

  const lpers: TopLPer[] = ranked.map((owner: Record<string, unknown>) => {
    const history = historicalMap.get(owner.owner as string) as Record<string, unknown> | undefined;
    return {
      owner: owner.owner as string,
      owner_short: (owner.ownerShort as string) || `${String(owner.owner).slice(0, 8)}...`,
      signal_tags: [
        history?.preferredStrategy ? `strategy:${history.preferredStrategy}` : null,
        history?.preferredRangeStyle ? `range:${history.preferredRangeStyle}` : null,
      ].filter(Boolean) as string[],
      summary: {
        total_positions: (owner.totalLp as number) || (history?.topPositions as unknown[])?.length || 0,
        avg_hold_hours: round((owner.avgAgeHours as number) ?? (history?.avgHoldHours as number) ?? 0, 2),
        avg_open_pnl_pct: round((owner.pnlPerInflowPct as number) ?? (history?.avgPnlPct as number) ?? 0, 2),
        avg_fee_per_tvl_24h_pct: round((owner.feePercent as number) ?? (history?.avgFeePercent as number) ?? 0, 2),
        total_pnl_usd: round((owner.totalPnlUsd as number) ?? 0, 2),
        total_balance_usd: round((owner.totalInflowUsd as number) ?? 0, 2),
        avg_range_width_pct: null,
        avg_distance_to_active_pct: null,
        win_rate: round(((owner.winRatePct as number) ?? 0) / 100, 2),
        roi: round(((owner.roiPct as number) ?? 0) / 100, 4),
        fee_pct_of_capital: round((owner.feePercent as number) ?? 0, 2),
        preferred_strategy: (history?.preferredStrategy as string) || 'unknown',
        preferred_range_style: (history?.preferredRangeStyle as string) || 'unknown',
      },
      positions: Array.isArray(history?.topPositions)
        ? (history.topPositions as Record<string, unknown>[]).map((position: Record<string, unknown>) => ({
            pool: pool_address,
            pair: String(overview.name || '') || `${tokenXSymbol}-${tokenYSymbol}`,
            hold_hours: round((position.ageHours as number) ?? 0, 2),
            pnl_usd: round((position.pnlUsd as number) ?? 0, 2),
            pnl_pct: fmtPct(position.pnlPct),
            fee_usd: round((position.feeUsd as number) ?? 0, 2),
            in_range_pct: position.inRange == null ? null : (position.inRange as boolean) ? 100 : 0,
            strategy: (position.strategy as string) || null,
            closed_reason: (position.rangeStyle as string) || null,
            balance_usd: round((position.inputValue as number) ?? 0, 2),
            fee_per_tvl_24h_pct: round((position.feePercent as number) ?? 0, 2),
            range_width_pct: (position.widthBins as number) ?? null,
            distance_to_active_pct: null,
            lower_bin_id: (position.lowerBinId as number) ?? null,
            upper_bin_id: (position.upperBinId as number) ?? null,
          }))
        : [],
    };
  });

  const patterns = buildPatterns(ranked, historicalOwners, signalData, overview);

  return {
    pool: pool_address,
    pool_name: String(overview.name || '') || `${tokenXSymbol}-${tokenYSymbol}`,
    message: 'LPAgent-backed top LP study from Agent Etemaro 30m cached owner aggregates plus owner historical positions.',
    patterns,
    lpers,
  };
}
