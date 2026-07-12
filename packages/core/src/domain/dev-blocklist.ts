/**
 * Dev (deployer) blocklist — deployer wallet addresses that should never be deployed into.
 *
 * Agent/user can add deployers via Telegram ("block this deployer").
 * Screening hard-filters any pool whose base token was deployed by a blocked wallet
 * before the pool list reaches the LLM.
 */

import { log } from "../shared/logger.js";
import { dataPath } from "../shared/constants.js";
import { loadJsonFile, saveJsonFile } from "../shared/utils.js";
import type { BlockedDev } from "../shared/types.js";

const BLOCKLIST_FILE = dataPath("dev-blocklist.json");

type DevBlocklistDb = Record<string, BlockedDev>;

function load(): DevBlocklistDb {
  return loadJsonFile<DevBlocklistDb>(BLOCKLIST_FILE, {});
}

function save(data: DevBlocklistDb): void {
  saveJsonFile(BLOCKLIST_FILE, data);
}

export function isDevBlocked(devWallet: string | null | undefined): boolean {
  if (!devWallet) return false;
  return !!load()[devWallet];
}

export function getBlockedDevs(): DevBlocklistDb {
  return load();
}

export function blockDev({ wallet, reason, label }: { wallet: string; reason?: string; label?: string }): Record<string, unknown> {
  if (!wallet) return { error: "wallet required" };
  const db = load();
  if (db[wallet]) return { already_blocked: true, wallet, label: db[wallet].label, reason: db[wallet].reason };
  db[wallet] = {
    label: label || "unknown",
    reason: reason || "no reason provided",
    added_at: new Date().toISOString(),
  };
  save(db);
  log("dev_blocklist", `Blocked deployer ${label || wallet}: ${reason}`);
  return { blocked: true, wallet, label, reason };
}

export function unblockDev({ wallet }: { wallet: string }): Record<string, unknown> {
  if (!wallet) return { error: "wallet required" };
  const db = load();
  if (!db[wallet]) return { error: `Wallet ${wallet} not on dev blocklist` };
  const entry = db[wallet];
  delete db[wallet];
  save(db);
  log("dev_blocklist", `Removed deployer ${entry.label || wallet} from blocklist`);
  return { unblocked: true, wallet, was: entry };
}

export function listBlockedDevs(): Record<string, unknown> {
  const db = load();
  const entries = Object.entries(db).map(([wallet, info]) => ({ wallet, ...info }));
  return { count: entries.length, blocked_devs: entries };
}
