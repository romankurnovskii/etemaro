/**
 * Token blacklist — mints the agent should never deploy into.
 *
 * Agent can blacklist via Telegram ("blacklist this token, it rugged").
 * Screening filters blacklisted tokens before passing pools to the LLM.
 */

import { log } from '../shared/logger.js';
import { dataPath } from '../shared/constants.js';
import { loadJsonFile, saveJsonFile } from '../shared/utils.js';
import type { BlacklistedToken } from '../shared/types.js';

const BLACKLIST_FILE = dataPath('token-blacklist.json');

type BlacklistDb = Record<string, BlacklistedToken>;

function load(): BlacklistDb {
  return loadJsonFile<BlacklistDb>(BLACKLIST_FILE, {});
}

function save(data: BlacklistDb): void {
  saveJsonFile(BLACKLIST_FILE, data);
}

// ─── Check ─────────────────────────────────────────────────────

/**
 * Returns true if the mint is on the blacklist.
 * Used in screening.js before returning pools to the LLM.
 */
export function isBlacklisted(mint: string | null | undefined): boolean {
  if (!mint) return false;
  const db = load();
  return !!db[mint];
}

// ─── Tool Handlers ─────────────────────────────────────────────

/**
 * Tool handler: add_to_blacklist
 */
export function addToBlacklist({ mint, symbol, reason }: { mint: string; symbol?: string; reason?: string }): Record<string, unknown> {
  if (!mint) return { error: 'mint required' };

  const db = load();

  if (db[mint]) {
    return {
      already_blacklisted: true,
      mint,
      symbol: db[mint].symbol,
      reason: db[mint].reason,
    };
  }

  db[mint] = {
    symbol: symbol || 'UNKNOWN',
    reason: reason || 'no reason provided',
    added_at: new Date().toISOString(),
    added_by: 'agent',
  };

  save(db);
  log('blacklist', `Blacklisted ${symbol || mint}: ${reason}`);
  return { blacklisted: true, mint, symbol, reason };
}

/**
 * Tool handler: remove_from_blacklist
 */
export function removeFromBlacklist({ mint }: { mint: string }): Record<string, unknown> {
  if (!mint) return { error: 'mint required' };

  const db = load();

  if (!db[mint]) {
    return { error: `Mint ${mint} not found on blacklist` };
  }

  const entry = db[mint];
  delete db[mint];
  save(db);
  log('blacklist', `Removed ${entry.symbol || mint} from blacklist`);
  return { removed: true, mint, was: entry };
}

/**
 * Tool handler: list_blacklist
 */
export function listBlacklist(): Record<string, unknown> {
  const db = load();
  const entries = Object.entries(db).map(([mint, info]) => ({
    mint,
    ...info,
  }));

  return {
    count: entries.length,
    blacklist: entries,
  };
}
