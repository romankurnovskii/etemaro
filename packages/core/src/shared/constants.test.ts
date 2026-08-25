/**
 * @file constants.test.ts
 * @description Verifies repo root detection and config path resolution produce paths outside the package directory.
 *
 * @features
 * - Confirms REPO_ROOT contains pnpm-workspace.yaml
 * - Asserts configPath('user-config.json') resolves to <root>/config and not packages/core/config
 * - dataPath honors ETEMARO_DATA_DIR / DATA_DIR overrides and USER_CONFIG_PATH agent suffix
 *
 * @dependencies vitest
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, configPath, dataPath, getDataDir } from './constants.js';

const ENV_KEYS = ['USER_CONFIG_PATH', 'ETEMARO_DATA_DIR', 'DATA_DIR'] as const;

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) snap[k] = process.env[k];
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const k of ENV_KEYS) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
}

describe('REPO_ROOT resolves to the pnpm workspace root', () => {
  let envSnap: Record<string, string | undefined>;

  afterEach(() => {
    if (envSnap) restoreEnv(envSnap);
  });

  it('points at the directory containing pnpm-workspace.yaml', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'pnpm-workspace.yaml'))).toBe(true);
  });

  it('configPath resolves to <root>/config, not packages/core/config', () => {
    expect(configPath('user-config.json')).toBe(path.join(REPO_ROOT, 'config', 'user-config.json'));
    expect(configPath('user-config.json')).not.toContain('packages/core/config');
  });

  it('dataPath resolves standard filenames when using default config', () => {
    envSnap = snapshotEnv();
    delete process.env.USER_CONFIG_PATH;
    delete process.env.ETEMARO_DATA_DIR;
    delete process.env.DATA_DIR;
    expect(getDataDir()).toBe(path.join(REPO_ROOT, 'data'));
    expect(dataPath('state.json')).toBe(path.join(REPO_ROOT, 'data', 'state.json'));
    expect(dataPath('logs')).toBe(path.join(REPO_ROOT, 'data', 'logs'));
  });

  it('dataPath automatically adds agent suffix when USER_CONFIG_PATH is set to custom config', () => {
    envSnap = snapshotEnv();
    delete process.env.ETEMARO_DATA_DIR;
    delete process.env.DATA_DIR;
    process.env.USER_CONFIG_PATH = '/path/to/config/agt_a717d5fa29c5d09fe188bc16.json';
    expect(dataPath('state.json')).toBe(path.join(REPO_ROOT, 'data', 'state-agt_a717d5fa29c5d09fe188bc16.json'));
    expect(dataPath('lessons.json')).toBe(path.join(REPO_ROOT, 'data', 'lessons-agt_a717d5fa29c5d09fe188bc16.json'));
    // Directory segments (e.g. logs/) are not suffix-renamed
    expect(dataPath('logs')).toBe(path.join(REPO_ROOT, 'data', 'logs'));
  });

  it('getDataDir / dataPath honor ETEMARO_DATA_DIR over repo default and DATA_DIR', () => {
    envSnap = snapshotEnv();
    delete process.env.USER_CONFIG_PATH;
    process.env.DATA_DIR = '/tmp/data-dir-alias';
    process.env.ETEMARO_DATA_DIR = '/tmp/etemaro-data-preferred';
    expect(getDataDir()).toBe(path.resolve('/tmp/etemaro-data-preferred'));
    expect(dataPath('state.json')).toBe(path.resolve('/tmp/etemaro-data-preferred', 'state.json'));
    expect(dataPath('logs', 'agent.log')).toBe(path.resolve('/tmp/etemaro-data-preferred', 'logs', 'agent.log'));
  });

  it('getDataDir falls back to DATA_DIR when ETEMARO_DATA_DIR is unset', () => {
    envSnap = snapshotEnv();
    delete process.env.ETEMARO_DATA_DIR;
    process.env.DATA_DIR = '/tmp/only-data-dir';
    expect(getDataDir()).toBe(path.resolve('/tmp/only-data-dir'));
  });

  it('dataPath combines ETEMARO_DATA_DIR with agent suffix from USER_CONFIG_PATH', () => {
    envSnap = snapshotEnv();
    process.env.ETEMARO_DATA_DIR = '/tmp/agent-data-root';
    process.env.USER_CONFIG_PATH = '/cfg/agt_desktop_1.json';
    expect(dataPath('state.json')).toBe(path.resolve('/tmp/agent-data-root', 'state-agt_desktop_1.json'));
    expect(dataPath('notifications.jsonl')).toBe(path.resolve('/tmp/agent-data-root', 'notifications-agt_desktop_1.jsonl'));
  });

  it('getDataDir expands leading ~', () => {
    envSnap = snapshotEnv();
    const home = process.env.HOME || process.env.USERPROFILE;
    if (!home) return;
    process.env.ETEMARO_DATA_DIR = '~/.config/etemaro/data';
    expect(getDataDir()).toBe(path.resolve(home, '.config/etemaro/data'));
  });
});
