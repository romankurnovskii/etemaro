import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Walk up from the given directory until we find the monorepo root,
 * identified by the presence of pnpm-workspace.yaml. Falls back to the
 * previous heuristic (two levels above this file) if no marker is found.
 */
function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(startDir, "../..");
}

/** Absolute path to the repository root (the pnpm workspace root). */
export const REPO_ROOT: string = findRepoRoot(
  path.dirname(fileURLToPath(import.meta.url)),
);

/** Resolve a path relative to the repository root. */
export function repoPath(...segments: string[]): string {
  return path.join(REPO_ROOT, ...segments);
}

/** Resolve a path relative to the data directory. */
export function dataPath(...segments: string[]): string {
  return path.join(REPO_ROOT, "data", ...segments);
}

/** Resolve a path relative to the config directory. */
export function configPath(...segments: string[]): string {
  return path.join(REPO_ROOT, "config", ...segments);
}

export const MAX_INSTRUCTION_LENGTH = 280;
export const MAX_NOTE_LENGTH = 280;
export const MAX_MANUAL_LESSON_LENGTH = 400;
export const MAX_RECENT_EVENTS = 20;
export const MAX_DECISIONS = 100;
export const SYNC_GRACE_MS = 5 * 60_000;
export const MIN_SAFE_BINS_BELOW = 35;
export const MIN_EVOLVE_POSITIONS = 5;
export const MAX_CHANGE_PER_STEP = 0.20;
export const STAGE_TTL_MS = 10 * 60_1000;
export const CACHE_TTL_MS = 5 * 60 * 1000;

export const SOLANA_PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const DEFAULT_HIVEMIND_URL = "https://api.agentmeridian.xyz";
export const DEFAULT_AGENT_MERIDIAN_API_URL = "https://api.agentmeridian.xyz/api";
const DEFAULT_KEY = "bWVyaWRpYW4taXMtdGhlLWJlc3QtYWdlbnRz";
export const DEFAULT_AGENT_MERIDIAN_PUBLIC_KEY = DEFAULT_KEY;
export const DEFAULT_HIVEMIND_API_KEY = DEFAULT_KEY;

export const TOKEN_MINTS = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
} as const;

export const PERFORMANCE_SIGNAL_FIELDS = [
  "organic_score",
  "fee_tvl_ratio",
  "volume",
  "mcap",
  "holder_count",
  "smart_wallets_present",
  "narrative_quality",
  "study_win_rate",
  "hive_consensus",
  "volatility",
  "entry_mcap",
  "entry_tvl",
  "entry_volume",
] as const;

export const ROLE_TAGS: Record<string, string[]> = {
  SCREENER: ["screening", "narrative", "strategy", "deployment", "token", "volume", "entry", "bundler", "holders", "organic"],
  MANAGER: ["management", "risk", "oor", "fees", "position", "hold", "close", "pnl", "rebalance", "claim"],
  GENERAL: [],
};
