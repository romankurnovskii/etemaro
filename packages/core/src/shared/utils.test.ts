import { describe, it, expect } from 'vitest';
import { flattenUserConfig } from './utils.js';

describe('flattenUserConfig', () => {
  it('passes through flat keys unchanged', () => {
    const input = { rpcUrl: 'https://example.com', dryRun: true, maxPositions: 3 };
    expect(flattenUserConfig(input)).toEqual(input);
  });

  it('flattens nested category values to flat keys', () => {
    const input = {
      screening: {
        minTvl: 10000,
        maxTvl: 150000,
        description: 'Screening filters',
      },
    };
    const result = flattenUserConfig(input);
    expect(result.minTvl).toBe(10000);
    expect(result.maxTvl).toBe(150000);
    expect(result.screening).toBeUndefined();
  });

  it('flat keys take precedence over nested values', () => {
    const input = {
      screening: { minTvl: 10000 },
      minTvl: 20000,
    };
    const result = flattenUserConfig(input);
    expect(result.minTvl).toBe(20000);
  });

  it('preserves chartIndicators as nested', () => {
    const input = {
      chartIndicators: { enabled: false, rsiLength: 2 },
      screening: { minTvl: 10000 },
    };
    const result = flattenUserConfig(input);
    expect(result.chartIndicators).toEqual({ enabled: false, rsiLength: 2 });
    expect(result.minTvl).toBe(10000);
  });

  it('strips description fields from categories', () => {
    const input = {
      screening: {
        description: 'Filters',
        minTvl: 10000,
      },
    };
    const result = flattenUserConfig(input);
    expect(result.description).toBeUndefined();
    expect(result.minTvl).toBe(10000);
  });

  it('handles multiple categories', () => {
    const input = {
      risk: { maxPositions: 3, description: 'Risk' },
      management: { stopLossPct: -50, description: 'Management' },
    };
    const result = flattenUserConfig(input);
    expect(result.maxPositions).toBe(3);
    expect(result.stopLossPct).toBe(-50);
    expect(result.risk).toBeUndefined();
    expect(result.management).toBeUndefined();
  });
});
