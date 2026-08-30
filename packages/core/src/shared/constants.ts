/**
 * @file constants.ts
 * @description System-wide constants, default mint addresses, and monorepo path resolution.
 *
 * @features
 * - Resolves monorepo repository root directory dynamically
 * - Defines known token mint addresses (SOL, USDC, USDT)
 * - Defines default path constants (`configPath`, `dataPath`, `USER_CONFIG_PATH`)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Walk up from the given directory until we find the monorepo root,
 * identified by the presence of pnpm-workspace.yaml. Falls back to the
 * previous heuristic (two levels above this file) if no marker is found.
 */
function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const fallback = path.resolve(startDir, '../..');
  if (fs.existsSync(path.join(fallback, 'config', 'templates', 'user-config.example.json'))) {
    return fallback;
  }
  const home = process.env.HOME || process.env.USERPROFILE;
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || (home ? path.join(home, '.config') : undefined);
  return process.env.ETEMARO_HOME || (xdgConfigHome ? path.join(xdgConfigHome, 'etemaro') : fallback);
}

const currentFileDir =
  typeof import.meta?.url === 'string' && import.meta.url.startsWith('file:')
    ? path.dirname(fileURLToPath(import.meta.url))
    : typeof __dirname !== 'undefined'
      ? __dirname
      : process.cwd();

/** Absolute path to the repository root (the pnpm workspace root). */
export const REPO_ROOT: string = findRepoRoot(currentFileDir);

/** Resolve a path relative to the repository root. */
export function repoPath(...segments: string[]): string {
  return path.join(REPO_ROOT, ...segments);
}

/**
 * Expand a leading `~/` (or bare `~`) to the user home directory.
 * Absolute and relative paths are returned resolved.
 */
function expandUserPath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (trimmed === '~') {
    return process.env.HOME || process.env.USERPROFILE || trimmed;
  }
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    const home = process.env.HOME || process.env.USERPROFILE;
    if (home) return path.resolve(home, trimmed.slice(2));
  }
  return path.resolve(trimmed);
}

/**
 * Runtime data directory for state, logs, lessons, notifications, etc.
 *
 * Resolution order (first non-empty wins):
 * 1. `ETEMARO_DATA_DIR` — preferred, namespaced override (Desktop sets this from agent.dataDir)
 * 2. `DATA_DIR` — short alias for headless/PM2/docker
 * 3. `<REPO_ROOT>/data` — default for CLI / single-repo installs
 *
 * Must be set in the process environment *before* the Node process starts
 * (module-level path caches in domain modules evaluate at import time).
 */
export function getDataDir(): string {
  const fromEnv = process.env.ETEMARO_DATA_DIR || process.env.DATA_DIR;
  if (fromEnv && fromEnv.trim()) {
    return expandUserPath(fromEnv);
  }
  return path.join(REPO_ROOT, 'data');
}

function getAgentSuffix(): string {
  const envPath = process.env.USER_CONFIG_PATH;
  if (envPath) {
    const base = path.basename(envPath, path.extname(envPath));
    if (base && !['user-config', 'user-config.v2', 'user-config.prod', 'user-config.example'].includes(base.toLowerCase())) {
      return base.replace(/[^a-zA-Z0-9_-]/g, '_');
    }
  }
  return '';
}

/** Resolve a path relative to the data directory, automatically adding agent suffix for custom config runs. */
export function dataPath(...segments: string[]): string {
  const baseDir = getDataDir();

  const suffix = getAgentSuffix();
  if (suffix && segments.length > 0) {
    const last = segments[segments.length - 1];
    if (last && (last.endsWith('.json') || last.endsWith('.jsonl'))) {
      const ext = path.extname(last);
      const name = path.basename(last, ext);
      const suffixedFile = `${name}-${suffix}${ext}`;
      return path.join(baseDir, ...segments.slice(0, -1), suffixedFile);
    }
  }
  return path.join(baseDir, ...segments);
}

/**
 * Resolve a path relative to the data directory for shared / user-maintained knowledge files.
 *
 * Unlike `dataPath`, shared knowledge files (e.g. `smart-wallets.json`, `strategy-library.json`,
 * `strategy-library.shared.json`, `token-blacklist.json`, `dev-blocklist.json`) must NOT get an
 * agent-name suffix when running under a custom `USER_CONFIG_PATH`.
 *
 * Per-agent ephemeral state files (e.g. `state.json`, `decision-log.json`, `lessons.json`,
 * `performance.json`, `.smart-wallets-snapshot.json`) must continue to use `dataPath()`.
 */
export function sharedDataPath(...segments: string[]): string {
  return path.join(getDataDir(), ...segments);
}

/**
 * Backward compatibility alias for strategy libraries.
 * @see sharedDataPath
 */
export const strategyLibraryPath = sharedDataPath;

/** Resolve a path relative to the config directory. */
export function configPath(...segments: string[]): string {
  // Honor USER_CONFIG_PATH env var for the main config file
  if (segments.length === 1 && segments[0] === 'user-config.json') {
    const envPath = process.env.USER_CONFIG_PATH;
    if (envPath) {
      const resolved = path.isAbsolute(envPath) ? envPath : path.resolve(REPO_ROOT, envPath);
      if (fs.existsSync(resolved)) {
        return resolved;
      }
      if (fs.existsSync(envPath)) {
        return path.resolve(envPath);
      }
    }
  }
  return path.join(REPO_ROOT, 'config', ...segments);
}

/** Canonical path to user-config.json (honors USER_CONFIG_PATH env override). */
export const USER_CONFIG_PATH = configPath('user-config.json');

export const MAX_INSTRUCTION_LENGTH = 280;
export const MAX_NOTE_LENGTH = 280;
export const MAX_MANUAL_LESSON_LENGTH = 400;
export const MAX_RECENT_EVENTS = 20;
export const MAX_DECISIONS = 100;
export const SYNC_GRACE_MS = 5 * 60_000;
export const MIN_SAFE_BINS_BELOW = 10; // Safe default minimum bins below (fallback if not configured)

// Runtime override set by Config.ts after loading user-config.json
let _minSafeBinsBelowOverride: number | null = null;

export function setMinSafeBinsBelowOverride(value: number): void {
  _minSafeBinsBelowOverride = value;
}

export function getMinSafeBinsBelow(): number {
  return _minSafeBinsBelowOverride ?? MIN_SAFE_BINS_BELOW;
}
export const MIN_EVOLVE_POSITIONS = 5;
export const MAX_CHANGE_PER_STEP = 0.2;
export const STAGE_TTL_MS = 600_000;
export const CACHE_TTL_MS = 5 * 60 * 1000;

export const SOLANA_PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const DEFAULT_HIVEMIND_URL = 'https://api.agentmeridian.xyz';
export const DEFAULT_AGENT_MERIDIAN_API_URL = 'https://api.agentmeridian.xyz/api';
// TODO 2026-09-30: add option to override this in user config, and/or read from env var
export const DEFAULT_AGENT_MERIDIAN_PUBLIC_KEY = 'bWVyaWRpYW4taXMtdGhlLWJlc3QtYWdlbnRz';
export const DEFAULT_HIVEMIND_API_KEY = 'bWVyaWRpYW4taXMtdGhlLWJlc3QtYWdlbnRz';

export const TOKEN_MINTS = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
} as const;

export const PERFORMANCE_SIGNAL_FIELDS = [
  'organic_score',
  'fee_tvl_ratio',
  'volume',
  'mcap',
  'holder_count',
  'smart_wallets_present',
  'narrative_quality',
  'study_win_rate',
  'hive_consensus',
  'volatility',
  'entry_mcap',
  'entry_tvl',
  'entry_volume',
] as const;

export const ROLE_TAGS: Record<string, string[]> = {
  SCREENER: ['screening', 'narrative', 'strategy', 'deployment', 'token', 'volume', 'entry', 'bundler', 'holders', 'organic'],
  MANAGER: ['management', 'risk', 'oor', 'fees', 'position', 'hold', 'close', 'pnl', 'rebalance', 'claim'],
  GENERAL: [],
};
