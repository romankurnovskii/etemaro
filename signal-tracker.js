/**
 * signal-tracker.js — Stages screening signals for later attribution.
 *
 * Deploy-time persistence is not currently wired, so staged signals are
 * short-lived context rather than durable performance data.
 */

// In-memory staging area — cleared after retrieval or after 10 minutes
const _staged = new Map();
const STAGE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Stage signals for a pool during screening.
 * Called after candidate data is loaded, before the LLM decides.
 * @param {string} poolAddress
 * @param {object} signals — { organic_score, fee_tvl_ratio, volume, mcap, holder_count, smart_wallets_present, narrative_quality, study_win_rate, hive_consensus, volatility }
 */
export function stageSignals(poolAddress, signals) {
  _staged.set(poolAddress, {
    ...signals,
    staged_at: Date.now(),
  });
  // Clean up stale entries
  for (const [addr, data] of _staged) {
    if (Date.now() - data.staged_at > STAGE_TTL_MS) {
      _staged.delete(addr);
    }
  }
}
