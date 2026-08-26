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
