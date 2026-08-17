import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import * as lib from './strategy-library.js';

// No need for global vi.mock here, using vi.spyOn in the test

describe('strategy-library persistence and validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('setActiveStrategy should return error if fs.writeFileSync fails', () => {
    const actualReadFileSync = fs.readFileSync;
    const actualExistsSync = fs.existsSync;
    vi.spyOn(fs, 'existsSync').mockImplementation((pathArg: any) => {
      const p = pathArg.toString();
      if (p.includes('user-config.json') || p.includes('strategy-library.shared.json')) return true;
      return actualExistsSync(pathArg);
    });
    vi.spyOn(fs, 'readFileSync').mockImplementation((pathArg: any, options: any) => {
      const p = pathArg.toString();
      if (p.includes('user-config.json')) {
        return JSON.stringify({ strategy: { activeStrategyId: 'old_id' } });
      }
      if (p.includes('strategy-library.shared.json')) {
        return JSON.stringify({ strategies: { single_sided_reseed: { name: 'test_strategy' } } });
      }
      return actualReadFileSync(pathArg, options);
    });

    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('Disk full');
    });

    const result = lib.setActiveStrategy({ id: 'single_sided_reseed' });

    expect(result).toHaveProperty('error');
    expect((result as any).error).toMatch(/Failed to update user config.*Disk full/);
  });
});
