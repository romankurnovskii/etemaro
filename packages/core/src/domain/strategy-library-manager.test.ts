import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { StrategyLibraryManager, strategyLibraryManager, removeStrategy } from './strategy-library.js';
import { getDataDir, strategyLibraryPath } from '../shared/constants.js';
import { config } from '../config/Config.js';
import { DEFAULT_STRATEGIES } from './defaultStrategies.js';
import * as logger from '../shared/logger.js';
import type { Strategy } from '../shared/types.js';

describe('StrategyLibraryManager path resolution', () => {
  it('resolves private and shared library paths under the data dir without agent suffix', () => {
    expect(strategyLibraryManager).toBeInstanceOf(StrategyLibraryManager);
    expect(strategyLibraryManager.paths.dataDir).toBe(getDataDir());
    expect(strategyLibraryManager.paths.privatePath).toBe(strategyLibraryPath('strategy-library.json'));
    expect(strategyLibraryManager.paths.sharedPath).toBe(strategyLibraryPath('strategy-library.shared.json'));
  });
});

describe('StrategyLibraryManager source handling', () => {
  const sharedStrategies = {
    single_sided_reseed: { id: 'single_sided_reseed', name: 'Single-Sided Reseed', author: 'meridian' },
    custom_ratio_spot: { id: 'custom_ratio_spot', name: 'Custom Ratio Spot', author: 'meridian' },
  };
  const privateStrategies = {
    copy_trade_lag: { id: 'copy_trade_lag', name: 'Copy Trade Lag', author: 'custom' },
  };

  const actualExistsSync = fs.existsSync;
  const actualReadFileSync = fs.readFileSync;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  function mockLibraries() {
    vi.spyOn(fs, 'existsSync').mockImplementation((pathArg: any) => {
      const p = pathArg.toString();
      if (p.includes('strategy-library.shared.json')) return true;
      if (p.includes('strategy-library.json')) return true;
      return actualExistsSync(pathArg);
    });
    vi.spyOn(fs, 'readFileSync').mockImplementation(((pathArg: any, options: any) => {
      const p = pathArg.toString();
      if (p.includes('strategy-library.shared.json')) {
        return JSON.stringify({ strategies: sharedStrategies });
      }
      if (p.includes('strategy-library.json')) {
        return JSON.stringify({ strategies: privateStrategies });
      }
      return actualReadFileSync(pathArg, options);
    }) as any);
  }

  it('loadMerged combines shared and private strategies with per-source attribution', () => {
    mockLibraries();
    const merged = strategyLibraryManager.loadMerged();
    const ids = Object.keys(merged.data.strategies);
    expect(ids).toContain('single_sided_reseed');
    expect(ids).toContain('custom_ratio_spot');
    expect(ids).toContain('copy_trade_lag');
    expect(merged.sources).toEqual({
      single_sided_reseed: 'shared',
      custom_ratio_spot: 'shared',
      copy_trade_lag: 'private',
    });
    expect(merged.collisions).toEqual([]);
  });

  it('surfaces duplicate ids between shared and private libraries with private authoritative', () => {
    const logSpy = vi.spyOn(logger, 'log');
    vi.spyOn(fs, 'existsSync').mockImplementation((pathArg: any) => {
      const p = pathArg.toString();
      return p.includes('strategy-library.shared.json') || p.includes('strategy-library.json');
    });
    vi.spyOn(fs, 'readFileSync').mockImplementation(((pathArg: any, options: any) => {
      const p = pathArg.toString();
      if (p.includes('strategy-library.shared.json')) {
        return JSON.stringify({ strategies: { copy_trade_lag: sharedStrategies.single_sided_reseed } });
      }
      if (p.includes('strategy-library.json')) {
        return JSON.stringify({ strategies: privateStrategies });
      }
      return actualReadFileSync(pathArg, options);
    }) as any);

    const merged = strategyLibraryManager.loadMerged();

    expect(merged.collisions).toEqual(['copy_trade_lag']);
    expect(merged.sources).toEqual({ copy_trade_lag: 'private' });
    expect(merged.data.strategies.copy_trade_lag!.name).toBe('Copy Trade Lag');
    const warned = logSpy.mock.calls.some((call) => typeof call[1] === 'string' && /collides with a shared strategy id/.test(call[1]));
    expect(warned).toBe(true);
  });

  it('falls back to bundled defaults when neither shared file exists', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((pathArg: any) => {
      const p = pathArg.toString();
      if (p.includes('strategy-library.shared.json') || p.includes('strategy-library.json')) return false;
      return actualExistsSync(pathArg);
    });

    const merged = strategyLibraryManager.loadMerged();
    expect(merged.data.strategies).toEqual(DEFAULT_STRATEGIES);
    for (const id of Object.keys(DEFAULT_STRATEGIES)) {
      expect(merged.sources[id]).toBe('default');
    }
    expect(merged.collisions).toEqual([]);
  });

  it('savePrivate writes to the private library path', () => {
    let renamedTo = '';
    vi.spyOn(fs, 'writeFileSync').mockImplementation((() => undefined) as any);
    vi.spyOn(fs, 'renameSync').mockImplementation(((_from: any, to: any) => {
      renamedTo = to.toString();
    }) as any);

    strategyLibraryManager.savePrivate({ strategies: privateStrategies as unknown as Record<string, Strategy> });

    expect(renamedTo).toBe(strategyLibraryManager.paths.privatePath);
  });
});

describe('StrategyLibraryManager boot validation', () => {
  const actualExistsSync = fs.existsSync;
  const actualReadFileSync = fs.readFileSync;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  function mockPrivateOnly(privateStrategies: Record<string, { id: string; name: string; author: string }>) {
    vi.spyOn(fs, 'existsSync').mockImplementation((pathArg: any) => {
      const p = pathArg.toString();
      if (p.includes('strategy-library.shared.json')) return true;
      if (p.includes('strategy-library.json')) return true;
      return actualExistsSync(pathArg);
    });
    vi.spyOn(fs, 'readFileSync').mockImplementation(((pathArg: any, options: any) => {
      const p = pathArg.toString();
      if (p.includes('strategy-library.shared.json')) {
        return JSON.stringify({ strategies: {} });
      }
      if (p.includes('strategy-library.json')) {
        return JSON.stringify({ strategies: privateStrategies });
      }
      return actualReadFileSync(pathArg, options);
    }) as any);
  }

  it('validate passes when the active strategy exists only in the private library', () => {
    mockPrivateOnly({ copy_trade_lag: { id: 'copy_trade_lag', name: 'Copy Trade Lag', author: 'custom' } });
    const originalActive = config.strategy.activeStrategyId;
    try {
      config.strategy.activeStrategyId = 'copy_trade_lag';
      expect(() => strategyLibraryManager.validate()).not.toThrow();
    } finally {
      config.strategy.activeStrategyId = originalActive;
    }
  });

  it('validate throws when the active strategy exists in neither library', () => {
    mockPrivateOnly({ copy_trade_lag: { id: 'copy_trade_lag', name: 'Copy Trade Lag', author: 'custom' } });
    const originalActive = config.strategy.activeStrategyId;
    try {
      config.strategy.activeStrategyId = 'does_not_exist';
      expect(() => strategyLibraryManager.validate()).toThrow(/not found in the strategy library/);
    } finally {
      config.strategy.activeStrategyId = originalActive;
    }
  });

  it('validate throws when the active strategy id is missing or empty', () => {
    mockPrivateOnly({ copy_trade_lag: { id: 'copy_trade_lag', name: 'Copy Trade Lag', author: 'custom' } });
    const originalActive = config.strategy.activeStrategyId;
    try {
      config.strategy.activeStrategyId = '';
      expect(() => strategyLibraryManager.validate()).toThrow(/missing or empty/);
    } finally {
      config.strategy.activeStrategyId = originalActive;
    }
  });
});

describe('StrategyLibraryManager keeps removal semantics', () => {
  const actualExistsSync = fs.existsSync;
  const actualReadFileSync = fs.readFileSync;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('removeStrategy refuses to remove a strategy owned by the shared library', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((pathArg: any) => {
      const p = pathArg.toString();
      if (p.includes('strategy-library.shared.json')) return true;
      if (p.includes('strategy-library.json')) return true;
      return actualExistsSync(pathArg);
    });
    vi.spyOn(fs, 'readFileSync').mockImplementation(((pathArg: any, options: any) => {
      const p = pathArg.toString();
      if (p.includes('strategy-library.shared.json')) {
        return JSON.stringify({ strategies: { custom_ratio_spot: { id: 'custom_ratio_spot', name: 'Custom Ratio Spot', author: 'meridian' } } });
      }
      if (p.includes('strategy-library.json')) {
        return JSON.stringify({ strategies: {} });
      }
      return actualReadFileSync(pathArg, options);
    }) as any);

    const result = removeStrategy({ id: 'custom_ratio_spot' });
    expect(result).toHaveProperty('error');
    expect((result as any).error).toMatch(/shared open-source strategy/);
  });
});