import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runConfigMigrations, autoFillMissingDefaults, backupAndSaveUserConfig, CURRENT_CONFIG_VERSION } from './ConfigMigrator.js';

describe('ConfigMigrator', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etemaro-test-config-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  const mockExampleConfig = {
    preset: 'custom',
    _version: 1,
    connection: {
      rpcUrl: 'https://example.com/rpc',
      dryRun: true,
    },
    risk: {
      maxPositions: 2,
      maxDeployAmount: 50,
    },
    management: {
      autoSwapInterSwapDelayMs: 1500,
      minClaimAmount: 5,
    },
    chartIndicators: {
      enabled: false,
      entryPreset: 'supertrend_break',
    },
  };

  it('upgrades unversioned config (version 0) to current version with _version set', () => {
    const unversionedUserConfig = {
      preset: 'custom',
      connection: {
        rpcUrl: 'https://my-custom-rpc.com',
        dryRun: false,
      },
      risk: {
        maxPositions: 5,
        maxDeployAmount: 100,
      },
    };

    const result = runConfigMigrations(unversionedUserConfig, mockExampleConfig);

    expect(result.changed).toBe(true);
    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(CURRENT_CONFIG_VERSION);
    expect(result.migrated._version).toBe(CURRENT_CONFIG_VERSION);

    // Preserves user custom overrides
    const conn = result.migrated.connection as Record<string, unknown>;
    expect(conn.rpcUrl).toBe('https://my-custom-rpc.com');
    expect(conn.dryRun).toBe(false);

    // Auto-fills missing defaults
    const mgmt = result.migrated.management as Record<string, unknown>;
    expect(mgmt.autoSwapInterSwapDelayMs).toBe(1500);
    expect(mgmt.minClaimAmount).toBe(5);
  });

  it('is idempotent when config is already at current version with all fields present', () => {
    const { data: migratedData } = autoFillMissingDefaults(
      {
        preset: 'custom',
        connection: { rpcUrl: 'https://rpc.com', dryRun: true },
        risk: { maxPositions: 2, maxDeployAmount: 50 },
        management: { autoSwapInterSwapDelayMs: 1500, minClaimAmount: 5 },
      },
      mockExampleConfig,
    );
    migratedData._version = CURRENT_CONFIG_VERSION;

    const result = runConfigMigrations(migratedData, mockExampleConfig);
    expect(result.fromVersion).toBe(CURRENT_CONFIG_VERSION);
    expect(result.toVersion).toBe(CURRENT_CONFIG_VERSION);
    expect(result.migrated._version).toBe(CURRENT_CONFIG_VERSION);
  });

  it('creates a .bak file prior to writing updated configuration to disk', () => {
    const configPath = path.join(tmpDir, 'user-config.json');
    const originalContent = JSON.stringify({ preset: 'custom', risk: { maxPositions: 1 } }, null, 2);
    fs.writeFileSync(configPath, originalContent, 'utf8');

    const updatedConfig = { preset: 'custom', _version: 1, risk: { maxPositions: 1 } };
    backupAndSaveUserConfig(configPath, updatedConfig);

    expect(fs.existsSync(`${configPath}.bak`)).toBe(true);
    expect(fs.readFileSync(`${configPath}.bak`, 'utf8')).toBe(originalContent);
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8'))).toEqual(updatedConfig);
  });
});
