/**
 * @file Config.test.ts
 * @description Unit tests for Config module, covering fee/active-TVL scaling and config defaults.
 *
 * @features
 * - Validates scaleScreeningToTimeframe produces correct thresholds per timeframe
 * - Asserts default screening.minFeeActiveTvlRatio matches scaled floor for 5m
 * - Spot-checks a known pool ratio against the current default gate
 * - Verifies minSafeBinsBelow config override works
 *
 * @dependencies vitest
 */
import { describe, it, expect } from 'vitest';
import { config } from './Config.js';
import { getMinSafeBinsBelow } from '../shared/constants.js';
import { scaleScreeningToTimeframe } from '../shared/utils.js';

// Pool febu-SOL (2CVn...) fee/active-TVL from the Meteora Pool Discovery API.
const FEE_ACTIVE_TVL_RATIO_5M = 0.02540134632532999;

describe('fee/active-TVL gate timeframe scaling', () => {
  it('scales the fee floor to the screening timeframe', () => {
    expect(scaleScreeningToTimeframe('5m').minFeeActiveTvlRatio).toBe(0.02);
    expect(scaleScreeningToTimeframe('24h').minFeeActiveTvlRatio).toBe(2.0);
  });

  it('config default for 5m matches the scaled floor (not the old static 0.05)', () => {
    // Only valid when user-config.json does not override minFeeActiveTvlRatio.
    if (process.env.FORCE_RAW_SCREENING_DEFAULT) return;
    expect(config.screening.timeframe).toBe('5m');
    expect(config.screening.minFeeActiveTvlRatio).toBe(0.02);
    expect(config.screening.minFeeActiveTvlRatio).not.toBe(0.05);
  });

  it('passes a profitable 5m pool (0.0254%) against the scaled 0.02 floor', () => {
    expect(FEE_ACTIVE_TVL_RATIO_5M).toBeGreaterThanOrEqual(config.screening.minFeeActiveTvlRatio);
  });
});

describe('minSafeBinsBelow config override', () => {
  it('exposes minSafeBinsBelow in strategy config', () => {
    expect(config.strategy.minSafeBinsBelow).toBeDefined();
    expect(typeof config.strategy.minSafeBinsBelow).toBe('number');
  });

  it('getMinSafeBinsBelow returns the configured value', () => {
    expect(getMinSafeBinsBelow()).toBe(config.strategy.minSafeBinsBelow);
  });

  it('default minSafeBinsBelow is 10 (matches example config)', () => {
    expect(config.strategy.minSafeBinsBelow).toBe(10);
    expect(getMinSafeBinsBelow()).toBe(10);
  });
});
