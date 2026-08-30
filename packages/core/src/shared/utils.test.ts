import { describe, it, expect, vi, afterEach } from 'vitest';
import { saveJsonFile } from './utils.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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

describe('loadJsonFile — missing vs corrupt file handling', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loadJsonFile-test-'));

  afterEach(() => {
    for (const f of fs.readdirSync(tmpDir)) {
      fs.unlinkSync(path.join(tmpDir, f));
    }
  });

  it('returns fallback without throwing when file does not exist', async () => {
    const { loadJsonFile } = await import('./utils.js');
    const target = path.join(tmpDir, 'nonexistent.json');
    const result = loadJsonFile(target, { default: true });
    expect(result).toEqual({ default: true });
  });

  it('returns fallback and logs warning when file contains corrupt JSON', async () => {
    const { loadJsonFile } = await import('./utils.js');
    const target = path.join(tmpDir, 'corrupt.json');
    fs.writeFileSync(target, '{ bad json syntax !!!');

    const result = loadJsonFile(target, { fallback: 123 }, { label: 'test-corrupt' });
    expect(result).toEqual({ fallback: 123 });
  });

  it('throws error when file contains corrupt JSON and critical: true', async () => {
    const { loadJsonFile } = await import('./utils.js');
    const target = path.join(tmpDir, 'corrupt-critical.json');
    fs.writeFileSync(target, '{ broken json');

    expect(() => loadJsonFile(target, { fallback: true }, { label: 'state', critical: true })).toThrowError(
      /Failed to parse JSON file at.*Critical file corrupted/,
    );
  });

  it('correctly parses and returns valid JSON', async () => {
    const { loadJsonFile } = await import('./utils.js');
    const target = path.join(tmpDir, 'valid.json');
    fs.writeFileSync(target, JSON.stringify({ success: true, count: 42 }));

    const result = loadJsonFile(target, { success: false });
    expect(result).toEqual({ success: true, count: 42 });
  });
});

describe('loadJsonFileWithInfo — detailed load tracking', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loadJsonFileWithInfo-test-'));

  afterEach(() => {
    for (const f of fs.readdirSync(tmpDir)) {
      fs.unlinkSync(path.join(tmpDir, f));
    }
  });

  it('returns fallback and loadedFrom: fallback when file does not exist', async () => {
    const { loadJsonFileWithInfo } = await import('./utils.js');
    const target = path.join(tmpDir, 'nonexistent.json');
    const result = loadJsonFileWithInfo(target, { fallback: true });

    expect(result.data).toEqual({ fallback: true });
    expect(result.loadedFrom).toBe('fallback');
    expect(result.filePath).toBe(target);
    expect(result.error).toBeUndefined();
  });

  it('returns fallback and captures error when file is corrupt JSON', async () => {
    const { loadJsonFileWithInfo } = await import('./utils.js');
    const target = path.join(tmpDir, 'corrupt.json');
    fs.writeFileSync(target, 'not valid json {{{');

    const result = loadJsonFileWithInfo(target, { defaultVal: 123 });
    expect(result.data).toEqual({ defaultVal: 123 });
    expect(result.loadedFrom).toBe('fallback');
    expect(result.filePath).toBe(target);
    expect(result.error).toBeDefined();
  });

  it('returns parsed data with loadedFrom: file when JSON is valid', async () => {
    const { loadJsonFileWithInfo } = await import('./utils.js');
    const target = path.join(tmpDir, 'valid.json');
    fs.writeFileSync(target, JSON.stringify({ wallets: ['walletA', 'walletB'] }));

    const result = loadJsonFileWithInfo<{ wallets: string[] }>(target, { wallets: [] });
    expect(result.data).toEqual({ wallets: ['walletA', 'walletB'] });
    expect(result.loadedFrom).toBe('file');
    expect(result.filePath).toBe(target);
    expect(result.error).toBeUndefined();
  });
});
