/**
 * signal-tracker.js — Stages screening signals for later attribution.
 *
 * Deploy-time persistence is not currently wired, so staged signals are
 * short-lived context rather than durable performance data.
 */

import { log } from "./logger.js";

// In-memory staging area — cleared after retrieval or after 10 minutes
const _staged = new Map();
const _stagedByBaseMint = new Map();
const STAGE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function normalizeKey(value) {
  return value ? String(value).trim() : null;
}

function cleanupStale() {
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
 * @param {string} poolAddress
 * @param {object} signals — { organic_score, fee_tvl_ratio, volume, mcap, holder_count, smart_wallets_present, narrative_quality, study_win_rate, hive_consensus, volatility }
 */
export function stageSignals(poolAddress, signals) {
  cleanupStale();
  const poolKey = normalizeKey(poolAddress);
  if (!poolKey) return;

  const baseMint = normalizeKey(signals?.base_mint || signals?.baseMint);
  _staged.set(poolKey, {
    ...signals,
    base_mint: baseMint || signals?.base_mint || null,
    staged_at: Date.now(),
  });
  if (baseMint) {
    _stagedByBaseMint.set(baseMint, poolKey);
  }
}

/**
 * Retrieve and clear staged signals for a pool.
 * Called from deployPosition after the position is created.
 * @param {string} poolAddress
 * @returns {object|null} Signal snapshot or null if not staged
 */
export function getAndClearStagedSignals(poolAddress, baseMint = null) {
  cleanupStale();

  let poolKey = normalizeKey(poolAddress);
  let data = poolKey ? _staged.get(poolKey) : null;

  if (!data && baseMint) {
    const baseKey = normalizeKey(baseMint);
    poolKey = baseKey ? _stagedByBaseMint.get(baseKey) : null;
    data = poolKey ? _staged.get(poolKey) : null;
  }

  if (!data) return null;
  _staged.delete(poolKey);
  if (data.base_mint && _stagedByBaseMint.get(data.base_mint) === poolKey) {
    _stagedByBaseMint.delete(data.base_mint);
  }
  const { staged_at, ...signals } = data;
  log("signals", `Retrieved staged signals for ${poolKey.slice(0, 8)}: ${Object.keys(signals).filter(k => signals[k] != null).length} signals`);
  return signals;
}

/**
 * Get all currently staged pool addresses (for debugging).
 */
export function getStagedPools() {
  cleanupStale();
  return [..._staged.keys()];
}
