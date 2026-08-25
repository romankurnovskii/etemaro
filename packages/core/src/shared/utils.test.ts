import { describe, it, expect, vi, afterEach } from 'vitest';
import { flattenUserConfig, saveJsonFile } from './utils.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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

  it('preserves top-level agentId without shadowing from hiveMind.agentId', () => {
    const input = {
      agentId: 'primary-agent',
      hiveMind: { agentId: 'public-hivemind-agent', enabled: true },
    };
    const result = flattenUserConfig(input);
    expect(result.agentId).toBe('primary-agent');
    expect(result.hiveMindAgentId).toBeUndefined();
  });
});

describe('saveJsonFile — atomicity', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'saveJsonFile-test-'));
  afterEach(() => {
    // Clean up any leftover tmp files in the directory
    for (const f of fs.readdirSync(tmpDir)) {
      fs.unlinkSync(path.join(tmpDir, f));
    }
  });

  it('writes a valid JSON file atomically (no leftover tmp on success)', () => {
    const target = path.join(tmpDir, 'atomic.json');
    saveJsonFile(target, { hello: 'world' });

    const content = fs.readFileSync(target, 'utf8');
    expect(JSON.parse(content)).toEqual({ hello: 'world' });

    // No stray .tmp files should remain
    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.tmp'));
    expect(files).toHaveLength(0);
  });

  it('does NOT overwrite the original file when fs.renameSync fails', () => {
    const target = path.join(tmpDir, 'rename-fail.json');
    // Seed original
    fs.writeFileSync(target, JSON.stringify({ original: true }));

    const spy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('simulated rename failure');
    });

    try {
      expect(() => saveJsonFile(target, { new: true })).toThrow('simulated rename failure');

      // Original file must still contain the old data
      const content = fs.readFileSync(target, 'utf8');
      expect(JSON.parse(content)).toEqual({ original: true });
    } finally {
      spy.mockRestore();
    }
  });

  it('cleans up the temp file when an error occurs', () => {
    const target = path.join(tmpDir, 'cleanup.json');

    const spy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('disk full');
    });

    try {
      expect(() => saveJsonFile(target, { data: 42 })).toThrow('disk full');

      // The temp file matching the pattern should NOT persist
      const tmpFiles = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.tmp'));
      expect(tmpFiles).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});
