/**
 * @file constants.ts
 * @description System-wide constants, default mint addresses, and monorepo path resolution.
 *
 * @features
 * - Resolves monorepo repository root directory dynamically
 * - Defines known token mint addresses (SOL, USDC, USDT)
 * - Defines default path constants (`configPath`, `dataPath`, `AGENT_CONFIG_PATH`)
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Walk up from the given directory until we find the monorepo root,
 * identified by the presence of pnpm-workspace.yaml. Falls back to the
 * previous heuristic (two levels above this file) if no marker is found.
 */
function findRepoRoot(startDir: string): string {
  let dir = startDir
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  const fallback = path.resolve(startDir, '../..')
  if (fs.existsSync(path.join(fallback, 'pnpm-workspace.yaml')) || fs.existsSync(path.join(fallback, 'package.json'))) {
    return fallback
  }
  const home = process.env.HOME || process.env.USERPROFILE
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || (home ? path.join(home, '.config') : undefined)
  return process.env.ETEMARO_HOME || (xdgConfigHome ? path.join(xdgConfigHome, 'etemaro') : fallback)
}

const currentFileDir =
  typeof __dirname !== 'undefined' && __dirname.length > 0
    ? __dirname
    : typeof import.meta?.url === 'string' && import.meta.url.startsWith('file:')
      ? path.dirname(fileURLToPath(import.meta.url))
      : process.cwd()

/** Absolute path to the repository root (the pnpm workspace root). */
export const REPO_ROOT: string = findRepoRoot(currentFileDir)

/** Resolve a path relative to the repository root. */
export function repoPath(...segments: string[]): string {
  return path.join(REPO_ROOT, ...segments)
}

/**
 * Expand a leading `~/` (or bare `~`) to the user home directory.
 * Absolute and relative paths are returned resolved.
 */
function expandUserPath(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return trimmed
  if (trimmed === '~') {
    return process.env.HOME || process.env.USERPROFILE || trimmed
  }
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    const home = process.env.HOME || process.env.USERPROFILE
    if (home) return path.resolve(home, trimmed.slice(2))
  }
  return path.resolve(trimmed)
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
  const fromEnv = process.env.ETEMARO_DATA_DIR || process.env.DATA_DIR
  if (fromEnv?.trim()) {
    return expandUserPath(fromEnv)
  }
  return path.join(REPO_ROOT, 'data')
}

/** Canonical agent config filename. */
export const AGENT_CONFIG_FILENAME = 'agent-config.json'

/** Path from the AGENT_CONFIG_PATH env var, if set. */
export function getEnvConfigPath(): string | undefined {
  return process.env.AGENT_CONFIG_PATH?.trim() || undefined
}

function resolveAgainstRepo(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(REPO_ROOT, p)
}

/**
 * Detect the active instance identifier if running in multi-instance mode.
 * Resolution order:
 * 1. ETEMARO_INSTANCE_ID
 * 2. If AGENT_CONFIG_PATH env var points to config/instances/<name>.json, extract <name>
 * 3. If AGENT_CONFIG_PATH env var points to custom config file (e.g. agt_xxx.json), extract clean slug
 * 4. If AGENT_CONFIG_PATH env var points to config/agent-config.json (flat), return '' (no instance isolation)
 * 5. Default to DEFAULT_AGENT_ID ('agent-default') for zero-fallback instance isolation (Chapter 7)
 */
export function getInstanceId(): string {
  const envInstance = process.env.ETEMARO_INSTANCE_ID
  if (envInstance?.trim()) {
    return envInstance.trim()
  }
  // Check env directly; the exported constant is evaluated at import time and cannot
  // reflect later overrides.
  const envConfigPath = getEnvConfigPath()
  if (envConfigPath) {
    const norm = envConfigPath.replace(/\\/g, '/')
    const instanceMatch = norm.match(/(?:^|\/)instances\/([^/]+)\.json$/)
    if (instanceMatch?.[1]) {
      return instanceMatch[1]
    }
    // A flat agent-config.json opts out of instance isolation.
    const baseName = path.basename(norm)
    if (baseName === AGENT_CONFIG_FILENAME) {
      return ''
    }
    const base = path.basename(envConfigPath, path.extname(envConfigPath))
    if (base && base.toLowerCase() !== 'agent-config') {
      return base.replace(/[^a-zA-Z0-9_-]/g, '_')
    }
  }
  // No env config path set -> zero-fallback to default agent instance
  return DEFAULT_AGENT_ID
}

function _getAgentSuffix(): string {
  return getInstanceId()
}

/** Resolve a path inside an instance's isolated runtime directory (Chapter 7: data/instances/<instanceId>/...). */
export function instanceDataPath(instanceId: string, ...segments: string[]): string {
  return path.join(getDataDir(), 'instances', instanceId, ...segments)
}

/**
 * Resolve a path relative to the data directory, automatically isolating per-instance
 * state when running named instances (Chapter 7) while maintaining backward compatibility.
 */
export function dataPath(...segments: string[]): string {
  const baseDir = getDataDir()
  const instanceId = getInstanceId()

  // Check env directly (the exported constant is evaluated at import time).
  const envConfigPath = getEnvConfigPath()
  const activeConfig = (envConfigPath || AGENT_CONFIG_PATH).replace(/\\/g, '/')
  const isExplicitInstance = Boolean(
    process.env.ETEMARO_INSTANCE_ID ||
      (envConfigPath && (activeConfig.includes('/instances/') || activeConfig.startsWith('instances/'))),
  )
  // Custom config files (agt_xxx.json) not in instances/ use legacy suffix
  const isCustomConfig = Boolean(
    envConfigPath && !activeConfig.includes('/instances/') && instanceId && instanceId !== DEFAULT_AGENT_ID,
  )

  // Chapter 7 zero-fallback: always isolate when using default instance (agent-default)
  // unless explicitly running with flat agent-config.json (instanceId === '')
  // Custom configs (agt_xxx.json) use legacy suffix for backward compatibility
  const useInstanceIsolation = isExplicitInstance || instanceId === DEFAULT_AGENT_ID

  if (instanceId && segments.length > 0) {
    if (useInstanceIsolation) {
      const instanceDir = path.join(baseDir, 'instances', instanceId)
      return path.join(instanceDir, ...segments)
    }
    if (isCustomConfig) {
      // Legacy suffixed file compatibility for custom configs (agt_xxx.json)
      const last = segments[segments.length - 1]
      if (last && (last.endsWith('.json') || last.endsWith('.jsonl'))) {
        const ext = path.extname(last)
        const name = path.basename(last, ext)
        const suffixedFile = `${name}-${instanceId}${ext}`
        return path.join(baseDir, ...segments.slice(0, -1), suffixedFile)
      }
    }
  }
  return path.join(baseDir, ...segments)
}

/**
 * Base config directory. A source checkout (repo-level config/ exists) uses
 * REPO_ROOT/config; an installed runtime uses the Etemaro home (the init target).
 */
function configBaseDir(): string {
  const repoConfig = path.join(REPO_ROOT, 'config')
  return fs.existsSync(repoConfig) ? repoConfig : path.join(getEtemaroDir(), 'config')
}

/** Resolve a path for global shared configuration / knowledge files. */
export function sharedConfigPath(...segments: string[]): string {
  return path.join(configBaseDir(), 'shared', ...segments)
}

/** Resolve the canonical shared strategy/configuration path. */
export const strategyLibraryPath = sharedConfigPath

/**
 * Resolve a path relative to the credentials/keystore directory (.credentials/wallets/<alias>.json).
 * Priority:
 * 1. ~/.config/etemaro/.credentials/wallets/<segments> (if exists)
 * 2. REPO_ROOT/config/.credentials/wallets/<segments> (if exists)
 * Fallback: ~/.config/etemaro/.credentials/wallets/<segments>
 */
export function credentialsPath(...segments: string[]): string {
  const inUserWallets = path.join(getEtemaroDir(), '.credentials', 'wallets', ...segments)
  if (fs.existsSync(inUserWallets)) return inUserWallets

  const inRepoWallets = path.join(configBaseDir(), '.credentials', 'wallets', ...segments)
  if (fs.existsSync(inRepoWallets)) return inRepoWallets

  return inUserWallets
}

/** Resolve a path relative to the config directory. */
export function configPath(...segments: string[]): string {
  // Honor an env-provided config path for the main config file.
  if (segments.length === 1 && segments[0] === AGENT_CONFIG_FILENAME) {
    const envPath = getEnvConfigPath()
    if (envPath) return resolveAgainstRepo(envPath)
    const canonical = path.join(configBaseDir(), AGENT_CONFIG_FILENAME)
    return fs.existsSync(canonical) ? canonical : getDefaultConfigPath()
  }
  // Chapter 7: check config/instances/<file> first for instance configurations
  if (segments.length === 1) {
    const inInstances = path.join(configBaseDir(), 'instances', segments[0]!)
    if (fs.existsSync(inInstances)) return inInstances
    // Default to instances/ for agent-default.json (zero-fallback model)
    if (segments[0] === 'agent-default.json') {
      return inInstances
    }
  }
  return path.join(configBaseDir(), ...segments)
}

/**
 * Canonical default configuration path.
 * Prefers config/instances/agent-default.json (Chapter 7 zero-fallback model),
 * falling back to config/agent-config.json if the instance file has not yet been initialized.
 */
export function getDefaultConfigPath(): string {
  const base = configBaseDir()
  const candidates = [path.join(base, 'instances', 'agent-default.json'), path.join(base, AGENT_CONFIG_FILENAME)]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  // New canonical default; `etemaro init` creates it.
  return path.join(base, 'instances', 'agent-default.json')
}

/** Canonical resolved agent config path (env override, else instance-first default). */
export const AGENT_CONFIG_PATH = (() => {
  const envPath = getEnvConfigPath()
  return envPath ? resolveAgainstRepo(envPath) : getDefaultConfigPath()
})()

/** Get the etemaro runtime/config home directory (e.g. ~/.config/etemaro).
 *  Resolution order:
 *   1. ETEMARO_HOME env var (explicit override)
 *   2. XDG_CONFIG_HOME/etemaro or ~/.config/etemaro (desktop standard)
 *   3. Fallback to repo-relative path (useful for dev/test)
 */
export function getEtemaroDir(): string {
  const etemaroHome = process.env.ETEMARO_HOME
  if (etemaroHome) {
    return expandUserPath(etemaroHome)
  }

  const home = process.env.HOME || process.env.USERPROFILE
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || (home ? path.join(home, '.config') : undefined)
  return xdgConfigHome ? path.join(xdgConfigHome, 'etemaro') : path.join(home || '', '.config', 'etemaro')
}

export const MAX_INSTRUCTION_LENGTH = 280
export const MAX_NOTE_LENGTH = 280
export const MAX_MANUAL_LESSON_LENGTH = 400
export const MAX_RECENT_EVENTS = 20
export const MAX_DECISIONS = 100
export const SYNC_GRACE_MS = 5 * 60_000
export const MIN_SAFE_BINS_BELOW = 10 // Safe default minimum bins below (fallback if not configured)

// Runtime override set by Config.ts after loading agent-config.json
let _minSafeBinsBelowOverride: number | null = null

export function setMinSafeBinsBelowOverride(value: number): void {
  _minSafeBinsBelowOverride = value
}

export function getMinSafeBinsBelow(): number {
  return _minSafeBinsBelowOverride ?? MIN_SAFE_BINS_BELOW
}
export const MIN_EVOLVE_POSITIONS = 5
export const MAX_CHANGE_PER_STEP = 0.2
export const STAGE_TTL_MS = 600_000
export const CACHE_TTL_MS = 5 * 60 * 1000

export const SOLANA_PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export const DEFAULT_HIVEMIND_URL = 'https://api.agentmeridian.xyz'
export const DEFAULT_AGENT_MERIDIAN_API_URL = 'https://api.agentmeridian.xyz/api'
export const DEFAULT_LLM_BASE_URL = 'https://openrouter.ai/api/v1'
export const DEFAULT_LLM_MODEL = 'openrouter/openrouter-free'

/**
 * Single source of truth for the fallback agentId used when no agentId is configured.
 * Used by Config.ts (config loader), AgentMeridianClient.ts (request identity),
 * logger.ts (log slug), and MeteoraAdapter.ts (relay calls).
 */
export const DEFAULT_AGENT_ID = 'agent-default'

// TODO 2026-09-30: add option to override this in user config, and/or read from env var
export const DEFAULT_AGENT_MERIDIAN_PUBLIC_KEY = 'bWVyaWRpYW4taXMtdGhlLWJlc3QtYWdlbnRz'
export const DEFAULT_HIVEMIND_API_KEY = 'bWVyaWRpYW4taXMtdGhlLWJlc3QtYWdlbnRz'

// File names and paths for data stores
export const SMART_WALLETS_FILENAME = 'smart-wallets.json'
export const STRATEGY_LIB_FILENAME = 'strategy-library.json'
export const SHARED_STRATEGY_LIB_FILENAME = 'strategy-library.shared.json'
export const WALLETS_KEYPAIR_FILENAME = 'wallets.json'
export const CHAT_PORT_FILENAME = 'chat_port.json'
export const CHAT_HISTORY_FILENAME = 'chat_history.json'
export const TOKEN_BLACKLIST_FILENAME = 'token-blacklist.json'
export const DEV_BLOCKLIST_FILENAME = 'dev-blocklist.json'
export const STATE_FILENAME = 'state.json'
export const DECISION_LOG_FILENAME = 'decision-log.json'
export const LESSONS_FILENAME = 'lessons.json'
export const POOL_MEMORY_FILENAME = 'pool-memory.json'
export const SIGNAL_WEIGHTS_FILENAME = 'signal-weights.json'
export const TELEGRAM_QUEUE_FILENAME = 'telegram_queue.json'

// Source identifiers and constants
export const DEFAULT_ENTRY_SOURCE = 'market'
export const DEFAULT_PNL_SOURCE = 'meteora_api'
export const DEFAULT_GMGN_FEE_SOURCE = 'gmgn'

// Default preset names
export const DEFAULT_ACTIVE_STRATEGY_ID = 'single_sided_reseed'
export const DEFAULT_STRATEGY_TYPE = 'bid_ask'

// Desktop chat defaults
export const DEFAULT_DESKTOP_CHAT_ENDPOINT = '/chat'

// Timing defaults (in seconds/minutes/hours)
export const DEFAULT_HEALTH_CHECK_INTERVAL_MIN = 60
export const DEFAULT_STRATEGY_RECALC_INTERVAL_MIN = 5
export const DEFAULT_STRATEGY_WINDOW_DAYS = 60

export const TOKEN_MINTS = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
} as const

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
] as const

export const ROLE_TAGS: Record<string, string[]> = {
  SCREENER: [
    'screening',
    'narrative',
    'strategy',
    'deployment',
    'token',
    'volume',
    'entry',
    'bundler',
    'holders',
    'organic',
  ],
  MANAGER: ['management', 'risk', 'oor', 'fees', 'position', 'hold', 'close', 'pnl', 'rebalance', 'claim'],
  GENERAL: [],
}
