import fs from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { dataPath, LESSONS_FILENAME } from '@etemaro/core';
import { Cli, loadCore, applyCliRuntimeFlags, resolveGlobalFlagValue } from './Cli.js';

describe('resolveGlobalFlagValue', () => {
  it('returns the value following the long flag', () => {
    expect(resolveGlobalFlagValue(['--config', '/tmp/cfg.json'], '--config')).toBe('/tmp/cfg.json');
  });

  it('returns the value following an alias', () => {
    expect(resolveGlobalFlagValue(['-c', '/tmp/cfg.json'], '--config', '-c')).toBe('/tmp/cfg.json');
  });

  it('returns undefined when the flag is absent', () => {
    expect(resolveGlobalFlagValue(['balance', '--portal'], '--config', '-c')).toBeUndefined();
  });

  it('returns undefined when the flag has no following value', () => {
    expect(resolveGlobalFlagValue(['balance', '--config'], '--config')).toBeUndefined();
  });

  it('returns undefined when the following token is another flag', () => {
    expect(resolveGlobalFlagValue(['balance', '--config', '--dry-run'], '--config')).toBeUndefined();
  });

  it('extends forward to find the value past the subcommand', () => {
    expect(resolveGlobalFlagValue(['balance', '--data-dir', '/tmp/d'], '--data-dir', '-d')).toBe('/tmp/d');
  });
});

describe('applyCliRuntimeFlags', () => {
  it('sets DRY_RUN when --dry-run is present', () => {
    const env: Record<string, string | undefined> = {};
    applyCliRuntimeFlags({ 'dry-run': true }, env);
    expect(env.DRY_RUN).toBe('true');
  });

  it('does not set DRY_RUN when the flag is absent', () => {
    const env: Record<string, string | undefined> = { DRY_RUN: 'false' };
    applyCliRuntimeFlags({}, env);
    expect(env.DRY_RUN).toBe('false');
  });
});

describe('Cli handleEvolve', () => {
  it('reads performance data from dataPath(LESSONS_FILENAME)', async () => {
    await loadCore();

    const mockEvolveThresholds = vi.fn().mockReturnValue({ changes: { minTvl: 1000 }, rationale: 'better yield' });
    const adapters: any = {
      domain: {
        evolveThresholds: mockEvolveThresholds,
      },
    };

    const cli = new Cli(adapters);
    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    const mockStdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const lessonsPath = dataPath(LESSONS_FILENAME);
    const originalExists = fs.existsSync;
    const originalReadFile = fs.readFileSync;

    const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
      if (p === lessonsPath) return true;
      return originalExists(p);
    });
    const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation((p, ...args) => {
      if (p === lessonsPath) {
        return JSON.stringify({ performance: [{ pnl_usd: 10 }] });
      }
      return originalReadFile(p, ...args);
    });

    try {
      (cli as any).handleEvolve();
      expect(mockEvolveThresholds).toHaveBeenCalledWith([{ pnl_usd: 10 }], expect.anything());
      expect(mockStdout).toHaveBeenCalled();
    } finally {
      mockExit.mockRestore();
      mockStdout.mockRestore();
      existsSpy.mockRestore();
      readSpy.mockRestore();
    }
  }, 15000);
});


