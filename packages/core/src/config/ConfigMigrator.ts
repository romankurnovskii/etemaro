import fs from 'node:fs';
import path from 'node:path';
import { flattenUserConfig } from '../shared/utils.js';

export const CURRENT_CONFIG_VERSION = 1;

export interface MigrationLog {
  fromVersion: number;
  toVersion: number;
  description: string;
  addedKeys: string[];
  updatedKeys: string[];
}

export interface MigrationResult {
  migrated: Record<string, unknown>;
  changed: boolean;
  fromVersion: number;
  toVersion: number;
  logs: MigrationLog[];
}

export interface Migration {
  fromVersion: number;
  toVersion: number;
  description: string;
  migrate: (
    userRaw: Record<string, unknown>,
    exampleRaw: Record<string, unknown>,
  ) => { data: Record<string, unknown>; added: string[]; updated: string[] };
}

const CATEGORIES = [
  'connection',
  'risk',
  'screening',
  'management',
  'strategy',
  'schedule',
  'llm',
  'darwin',
  'hiveMind',
  'api',
  'pnl',
  'opportunity',
  'gmgn',
  'jupiter',
];

/**
 * Deep merge missing default fields from example raw into user raw configuration while preserving custom user values.
 */
export function autoFillMissingDefaults(
  userRaw: Record<string, unknown>,
  exampleRaw: Record<string, unknown>,
): { data: Record<string, unknown>; added: string[] } {
  const data = JSON.parse(JSON.stringify(exampleRaw)) as Record<string, unknown>;
  const userFlat = flattenUserConfig(userRaw);
  const added: string[] = [];

  const exampleFlat = flattenUserConfig(exampleRaw);

  // Track keys that user provided
  for (const [key, value] of Object.entries(userFlat)) {
    if (key === 'chartIndicators') continue;
    if (key === 'preset') {
      data.preset = value;
      continue;
    }
    if (key === '_version') {
      continue;
    }

    let placed = false;
    for (const cat of CATEGORIES) {
      const catObj = data[cat];
      if (catObj && typeof catObj === 'object' && catObj !== null && !Array.isArray(catObj) && key in catObj) {
        (catObj as Record<string, unknown>)[key] = value;
        placed = true;
        break;
      }
    }

    if (!placed) {
      data[key] = value;
    }
  }

  // Detect which keys from example default were missing in user config
  for (const [key, val] of Object.entries(exampleFlat)) {
    if (key === 'chartIndicators' || key === 'preset' || key === '_version') continue;
    if (!(key in userFlat)) {
      added.push(key);
    }
  }

  // Merge chartIndicators if user provided it
  if (userRaw.chartIndicators && typeof userRaw.chartIndicators === 'object' && !Array.isArray(userRaw.chartIndicators)) {
    data.chartIndicators = {
      ...((data.chartIndicators as Record<string, unknown>) || {}),
      ...(userRaw.chartIndicators as Record<string, unknown>),
    };
  } else if (!('chartIndicators' in userRaw) && 'chartIndicators' in exampleRaw) {
    added.push('chartIndicators');
  }

  return { data, added };
}

const MIGRATIONS: Migration[] = [
  {
    fromVersion: 0,
    toVersion: 1,
    description: 'Initial schema versioning setup & auto-fill missing config fields',
    migrate: (userRaw, exampleRaw) => {
      const { data, added } = autoFillMissingDefaults(userRaw, exampleRaw);
      data._version = 1;
      return { data, added, updated: [] };
    },
  },
];

/**
 * Execute all necessary config schema migrations sequentially.
 */
export function runConfigMigrations(userRaw: Record<string, unknown>, exampleRaw: Record<string, unknown>): MigrationResult {
  const initialVersion = typeof userRaw._version === 'number' ? userRaw._version : 0;
  let currentData = JSON.parse(JSON.stringify(userRaw)) as Record<string, unknown>;
  let currentVersion = initialVersion;
  const logs: MigrationLog[] = [];
  let changed = false;

  for (const m of MIGRATIONS) {
    if (currentVersion >= m.fromVersion && currentVersion < m.toVersion && currentVersion < CURRENT_CONFIG_VERSION) {
      const result = m.migrate(currentData, exampleRaw);
      currentData = result.data;
      currentData._version = m.toVersion;
      logs.push({
        fromVersion: m.fromVersion,
        toVersion: m.toVersion,
        description: m.description,
        addedKeys: result.added,
        updatedKeys: result.updated,
      });
      currentVersion = m.toVersion;
      changed = true;
    }
  }

  // Ensure current _version matches CURRENT_CONFIG_VERSION
  if (currentData._version !== CURRENT_CONFIG_VERSION) {
    currentData._version = CURRENT_CONFIG_VERSION;
    changed = true;
  }

  return {
    migrated: currentData,
    changed,
    fromVersion: initialVersion,
    toVersion: CURRENT_CONFIG_VERSION,
    logs,
  };
}

/**
 * Creates a backup file (.bak) before saving updated configuration.
 */
export function backupAndSaveUserConfig(targetPath: string, updatedConfig: Record<string, unknown>): void {
  if (fs.existsSync(targetPath)) {
    const backupPath = `${targetPath}.bak`;
    fs.copyFileSync(targetPath, backupPath);
  }
  fs.writeFileSync(targetPath, JSON.stringify(updatedConfig, null, 2) + '\n', 'utf8');
}
