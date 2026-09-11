/**
 * @file dev-blocklist.ts
 * @description Domain manager for maintaining blocked developer/deployer wallet addresses (dev-blocklist.json).
 *
 * @features
 * - Filters candidate pools deployed by serial rug/PVP developer wallets
 * - Provides add/remove/check methods for developer blocklist entries
 *
 * @sideEffects Reads and writes `data/dev-blocklist.json`
 */

import { sharedConfigPath } from '../shared/constants.js'
import { log } from '../shared/logger.js'
import { readStateFile, writeStateFile } from '../shared/stateStore.js'
import type { BlockedDev } from '../shared/types.js'

const BLOCKLIST_FILE = sharedConfigPath('dev-blocklist.json')

type DevBlocklistDb = Record<string, BlockedDev>

function load(): DevBlocklistDb {
  return readStateFile<DevBlocklistDb>(BLOCKLIST_FILE, {}, { label: 'dev-blocklist' })
}

function save(data: DevBlocklistDb): void {
  writeStateFile(BLOCKLIST_FILE, data)
}

export function isDevBlocked(devWallet: string | null | undefined): boolean {
  if (!devWallet) return false
  return !!load()[devWallet]
}

export function getBlockedDevs(): DevBlocklistDb {
  return load()
}

export function blockDev({
  wallet,
  reason,
  label,
}: {
  wallet: string
  reason?: string
  label?: string
}): Record<string, unknown> {
  if (!wallet) return { error: 'wallet required' }
  const db = load()
  if (db[wallet]) return { already_blocked: true, wallet, label: db[wallet].label, reason: db[wallet].reason }
  db[wallet] = {
    label: label || 'unknown',
    reason: reason || 'no reason provided',
    addedAt: new Date().toISOString(),
  }
  save(db)
  log('dev_blocklist', `Blocked deployer ${label || wallet}: ${reason}`)
  return { blocked: true, wallet, label, reason }
}

export function unblockDev({ wallet }: { wallet: string }): Record<string, unknown> {
  if (!wallet) return { error: 'wallet required' }
  const db = load()
  if (!db[wallet]) return { error: `Wallet ${wallet} not on dev blocklist` }
  const entry = db[wallet]
  delete db[wallet]
  save(db)
  log('dev_blocklist', `Removed deployer ${entry.label || wallet} from blocklist`)
  return { unblocked: true, wallet, was: entry }
}

export function listBlockedDevs(): Record<string, unknown> {
  const db = load()
  const entries = Object.entries(db).map(([wallet, info]) => ({ wallet, ...info }))
  return { count: entries.length, blocked_devs: entries }
}
