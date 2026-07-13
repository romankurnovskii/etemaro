/**
 * signal-tracker.js — Stages screening signals for later attribution.
 *
 * Deploy-time persistence is not currently wired, so staged signals are
 * short-lived context rather than durable performance data.
 */

import { log } from '../shared/logger.js';
import { STAGE_TTL_MS } from '../shared/constants.js';
import type { SignalSnapshot } from '../shared/types.js';

// In-memory staging area — cleared after retrieval or after 10 minutes
interface StagedSignal {
  [key: string]: unknown;
  staged_at: number;
  base_mint: string | null;
}
const _staged = new Map<string, StagedSignal>();
const _stagedByBaseMint = new Map<string, string>();

function normalizeKey(value: unknown): string | null {
  return value ? String(value).trim() : null;
}

function cleanupStale(): void {
  const now = Date.now();
  for (const [addr, data] of _staged) {
    if (now - data.staged_at > STAGE_TTL_MS) {
      _staged.delete(addr);
      if (data.base_mint && _stagedByBaseMint.get(data.base_mint) === addr) {
        _stagedByBaseMint.delete(data.base_mint);
      }
    }
  }
}

/**
 * Stage signals for a pool during screening.
 * Called after candidate data is loaded, before the LLM decides.
 * @param poolAddress
 * @param signals — { organic_score, fee_tvl_ratio, volume, mcap, holder_count, smart_wallets_present, narrative_quality, study_win_rate, hive_consensus, volatility }
 */
export function stageSignals(poolAddress: string, signals: SignalSnapshot): void {
  cleanupStale();
  const poolKey = normalizeKey(poolAddress);
  if (!poolKey) return;

  const baseMint = normalizeKey(signals?.base_mint || (signals as Record<string, unknown>)?.baseMint);
  _staged.set(poolKey, {
    ...signals,
    base_mint: baseMint || (signals?.base_mint as string | null) || null,
    staged_at: Date.now(),
  });
  if (baseMint) {
    _stagedByBaseMint.set(baseMint, poolKey);
  }
}

/**
 * Retrieve and clear staged signals for a pool.
 * Called from deployPosition after the position is created.
 * @param poolAddress
 * @returns Signal snapshot or null if not staged
 */
export function getAndClearStagedSignals(poolAddress: string, baseMint: string | null = null): SignalSnapshot | null {
  cleanupStale();

  let poolKey = normalizeKey(poolAddress);
  let data = poolKey ? _staged.get(poolKey) : null;

  if (!data && baseMint) {
    const baseKey = normalizeKey(baseMint);
    poolKey = baseKey ? (_stagedByBaseMint.get(baseKey) ?? null) : null;
    data = poolKey ? _staged.get(poolKey) : null;
  }

  if (!data) return null;
  _staged.delete(poolKey!);
  if (data.base_mint && _stagedByBaseMint.get(data.base_mint) === poolKey) {
    _stagedByBaseMint.delete(data.base_mint);
  }
  const { staged_at, ...signals } = data;
  log('signals', `Retrieved staged signals for ${poolKey!.slice(0, 8)}: ${Object.keys(signals).filter((k) => signals[k] != null).length} signals`);
  return signals as unknown as SignalSnapshot;
}

/**
 * Get all currently staged pool addresses (for debugging).
 */
export function getStagedPools(): string[] {
  cleanupStale();
  return [..._staged.keys()];
}
