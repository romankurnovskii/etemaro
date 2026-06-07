/**
 * Timeframe-scaled screening defaults (Meteora discovery API + prompt.js floors).
 * fee_active_tvl_ratio and volume are window-dependent — same numeric threshold
 * means very different things on 30m vs 24h.
 */

// Pool discovery API accepts: 5m, 30m, 1h, 2h, 4h, 12h, 24h (no 15m).
export const TIMEFRAME_SCREENING_SCALES = {
  "5m":  { minFeeActiveTvlRatio: 0.02, minVolume: 500 },
  "30m": { minFeeActiveTvlRatio: 0.15, minVolume: 1_000 },
  "1h":  { minFeeActiveTvlRatio: 0.2,  minVolume: 10_000 },
  "2h":  { minFeeActiveTvlRatio: 0.4,  minVolume: 20_000 },
  "4h":  { minFeeActiveTvlRatio: 0.4,  minVolume: 2_000 },
  "12h": { minFeeActiveTvlRatio: 1.5,  minVolume: 60_000 },
  "24h": { minFeeActiveTvlRatio: 2.0,  minVolume: 10_000 },
};

const DEFAULT_TIMEFRAME = "4h";

export function normalizeTimeframe(timeframe) {
  const tf = String(timeframe || DEFAULT_TIMEFRAME).trim().toLowerCase();
  return TIMEFRAME_SCREENING_SCALES[tf] ? tf : DEFAULT_TIMEFRAME;
}

export function getScreeningDefaultsForTimeframe(timeframe) {
  const tf = normalizeTimeframe(timeframe);
  return { timeframe: tf, ...TIMEFRAME_SCREENING_SCALES[tf] };
}

/** Returns minFeeActiveTvlRatio + minVolume scaled to the given timeframe. */
export function scaleScreeningToTimeframe(timeframe) {
  const { minFeeActiveTvlRatio, minVolume } = getScreeningDefaultsForTimeframe(timeframe);
  return { minFeeActiveTvlRatio, minVolume };
}