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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

describe('schema versioning', () => {
  it('exposes schema _version in AppConfig', () => {
    expect(config._version).toBeDefined();
    expect(typeof config._version).toBe('number');
    expect(config._version).toBeGreaterThanOrEqual(1);
  });
});

describe('screening entrySource config', () => {
  it('defaults entrySource to market or smart_wallets', () => {
    expect(config.screening.entrySource).toBeDefined();
    expect(['market', 'smart_wallets']).toContain(config.screening.entrySource);
  });
});

describe('top-level agentId support', () => {
  it('exposes agentId in AppConfig', () => {
    expect(config.agentId !== undefined).toBe(true);
  });
});

describe('hiveMind agentId support', () => {
  let mockReadFileSync: ReturnType<typeof vi.fn>;
  let mockExistsSync: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();

    // Create mock functions
    mockExistsSync = vi.fn((path: string) => {
      if (path.endsWith('user-config.json')) return true;
      if (path.endsWith('user-config.example.json')) return true;
      // Fall back to actual fs for other paths
      return true;
    });

    mockReadFileSync = vi.fn((path: string, encoding: string) => {
      if (path.endsWith('user-config.json')) {
        return JSON.stringify({
          agentId: 'local-top-level-agent',
          hiveMind: {
            agentId: 'nested-hive-agent',
            url: 'https://hive.example.com',
            apiKey: 'hive-key',
          },
        });
      }
      if (path.endsWith('user-config.example.json')) {
        return JSON.stringify({
          _version: 1,
          preset: 'custom',
          // ... other required fields with default values
          agentId: '',
          hiveMindUrl: null,
          hiveMindApiKey: null,
          hiveMindPullMode: 'auto',
        });
      }
      // Fall back to actual fs for other files
      return '';
    });

    vi.doMock('node:fs', () => ({
      default: {
        existsSync: mockExistsSync,
        readFileSync: mockReadFileSync,
      },
      existsSync: mockExistsSync,
      readFileSync: mockReadFileSync,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes hiveMind.agentId from nested config when top-level agentId is present', async () => {
    // Re-import the config module to get the mocked version
    const { config: testConfig } = await import('./Config.js');
    expect(testConfig.agentId).toBe('local-top-level-agent');
    expect(testConfig.hiveMind.agentId).toBe('nested-hive-agent');
  });

  it('sets hiveMind.agentId correctly when no top-level agentId is present', async () => {
    // Override the mock for this specific test
    mockReadFileSync.mockImplementation((path: string, encoding: string) => {
      if (path.endsWith('user-config.json')) {
        return JSON.stringify({
          hiveMind: {
            agentId: 'hive-only-agent',
            url: 'https://hive.example.com',
            apiKey: 'hive-key',
          },
        });
      }
      if (path.endsWith('user-config.example.json')) {
        return JSON.stringify({
          _version: 1,
          preset: 'custom',
          // ... other required fields with default values
          agentId: '',
          hiveMindUrl: null,
          hiveMindApiKey: null,
          hiveMindPullMode: 'auto',
        });
      }
      return '';
    });

    // Re-import the config module to get the mocked version
    const { config: testConfig } = await import('./Config.js');
    expect(testConfig.agentId).toBeNull();
    expect(testConfig.hiveMind.agentId).toBe('hive-only-agent');
  });
});
