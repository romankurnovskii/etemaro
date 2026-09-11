/**
 * @file smart-wallets.ts
 * @description Domain manager for tracking KOL and whale LP wallet addresses and pool overlap detection (smart-wallets.json).
 *
 * @features
 * - Manages list of tracked smart wallets with category and label tags
 * - Checks candidate pools for active smart wallet LP position overlaps
 *
 * @sideEffects Reads and writes `config/shared/smart-wallets.json`
 */

import { CACHE_TTL_MS, SOLANA_PUBKEY_RE, sharedConfigPath } from '../shared/constants.js'
import { log } from '../shared/logger.js'
import { readStateFile, writeStateFile } from '../shared/stateStore.js'
import type { SmartWallet, SmartWalletHit } from '../shared/types.js'

const WALLETS_PATH = sharedConfigPath('smart-wallets.json')

interface SmartWalletList {
  wallets: SmartWallet[]
}

interface SmartWalletsData {
  lists: Record<string, SmartWalletList>
}

function loadWalletList(listId: string): SmartWalletList {
  const data = readStateFile<SmartWalletsData>(WALLETS_PATH, { lists: {} }, { label: 'smart-wallets' })
  const list = data.lists[listId]
  if (!list) throw new Error(`Smart wallet list "${listId}" not found`)
  return list
}

function loadWallets(): SmartWalletsData {
  return readStateFile<SmartWalletsData>(WALLETS_PATH, { lists: {} }, { label: 'smart-wallets' })
}

function saveWallets(data: SmartWalletsData): void {
  writeStateFile(WALLETS_PATH, data)
}

export function addSmartWallet({
  listId,
  name,
  address,
  category = 'alpha',
  type = 'lp',
}: {
  listId: string
  name: string
  address: string
  category?: string
  type?: 'lp' | 'holder'
}): Record<string, unknown> {
  if (!SOLANA_PUBKEY_RE.test(address)) {
    return { success: false, error: 'Invalid Solana address format' }
  }
  const data = loadWallets()
  const list = data.lists[listId]
  if (!list) throw new Error(`Smart wallet list "${listId}" not found`)
  const existing = list.wallets.find((w) => w.address === address)
  if (existing) {
    return { success: false, error: `Already tracked as "${existing.name}"` }
  }
  list.wallets.push({ name, address, category, type, addedAt: new Date().toISOString() })
  saveWallets(data)
  log('smart_wallets', `Added wallet: ${name} (${category}, type=${type})`)
  return { success: true, wallet: { name, address, category, type } }
}

export function removeSmartWallet({ listId, address }: { listId: string; address: string }): Record<string, unknown> {
  const data = loadWallets()
  const list = data.lists[listId]
  if (!list) throw new Error(`Smart wallet list "${listId}" not found`)
  const wallet = list.wallets.find((w) => w.address === address)
  if (!wallet) return { success: false, error: 'Wallet not found' }
  list.wallets = list.wallets.filter((w) => w.address !== address)
  saveWallets(data)
  _cache.delete(address)
  log('smart_wallets', `Removed wallet: ${wallet.name}`)
  return { success: true, removed: wallet.name }
}

export function listSmartWallets({ listId }: { listId: string }): { total: number; wallets: SmartWallet[] } {
  const { wallets } = loadWalletList(listId)
  return { total: wallets.length, wallets }
}

// Max bounded position cache size to avoid unbounded memory growth
export const MAX_SMART_WALLET_CACHE_SIZE = 500

// Cache wallet positions for 5 minutes to avoid hammering RPC
const _cache = new Map<string, { positions: Array<{ pool: string }>; fetchedAt: number }>()

/**
 * Prunes expired or untracked addresses from the cache, and enforces MAX_SMART_WALLET_CACHE_SIZE.
 */
export function pruneSmartWalletCache(activeAddresses?: Set<string>): void {
  const now = Date.now()
  for (const [addr, entry] of _cache.entries()) {
    if ((activeAddresses && !activeAddresses.has(addr)) || now - entry.fetchedAt >= CACHE_TTL_MS) {
      _cache.delete(addr)
    }
  }
  if (_cache.size > MAX_SMART_WALLET_CACHE_SIZE) {
    const sorted = [..._cache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)
    const toRemove = sorted.slice(0, _cache.size - MAX_SMART_WALLET_CACHE_SIZE)
    for (const [addr] of toRemove) {
      _cache.delete(addr)
    }
  }
}

/**
 * Returns current count of entries in the in-memory smart wallet cache.
 */
export function getSmartWalletCacheSize(): number {
  return _cache.size
}

/**
 * Clears the in-memory cache (for testing).
 */
export function __clearSmartWalletCache(): void {
  _cache.clear()
}

/**
 * Callback type for fetching wallet positions — injected by the caller
 * to avoid circular dependency with tools/dlmm.js.
 */
export type GetWalletPositionsFn = (opts: { wallet_address: string }) => Promise<{ positions: Array<{ pool: string }> }>

/**
 * Check smart wallets' positions against a specific pool.
 *
 * @param opts.pool_address - The pool to check against
 * @param opts.getWalletPositions - Function to fetch wallet positions (injected to avoid circular deps)
 */
export async function checkSmartWalletsOnPool(
  { listId, pool_address }: { listId: string; pool_address: string },
  getWalletPositions?: GetWalletPositionsFn,
): Promise<{
  pool: string
  tracked_wallets: number
  in_pool: SmartWalletHit[]
  confidence_boost: boolean
  signal: string
}> {
  const { wallets: allWallets } = loadWalletList(listId)
  // Only check LP-type wallets — holder wallets don't have positions
  const wallets = allWallets.filter((w) => !w.type || w.type === 'lp')
  if (wallets.length === 0) {
    return {
      pool: pool_address,
      tracked_wallets: 0,
      in_pool: [],
      confidence_boost: false,
      signal: 'No smart wallets tracked yet — neutral signal',
    }
  }

  const activeSet = new Set(wallets.map((w) => w.address))
  pruneSmartWalletCache(activeSet)

  const getPositions: GetWalletPositionsFn =
    getWalletPositions ?? (await import('../adapters/blockchain/MeteoraAdapter.js')).getWalletPositions

  const results = await Promise.all(
    wallets.map(async (wallet) => {
      try {
        const cached = _cache.get(wallet.address)
        if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
          return { wallet, positions: cached.positions }
        }
        const { positions } = await getPositions({ wallet_address: wallet.address })
        if (_cache.size >= MAX_SMART_WALLET_CACHE_SIZE && !_cache.has(wallet.address)) {
          pruneSmartWalletCache(activeSet)
        }
        _cache.set(wallet.address, { positions: positions || [], fetchedAt: Date.now() })
        return { wallet, positions: positions || [] }
      } catch {
        return { wallet, positions: [] as Array<{ pool: string }> }
      }
    }),
  )

  const inPool = results
    .filter((r) => r.positions.some((p) => p.pool === pool_address))
    .map((r) => ({ name: r.wallet.name, category: r.wallet.category, address: r.wallet.address }))

  return {
    pool: pool_address,
    tracked_wallets: wallets.length,
    in_pool: inPool,
    confidence_boost: inPool.length > 0,
    signal:
      inPool.length > 0
        ? `${inPool.length}/${wallets.length} smart wallet(s) are in this pool: ${inPool.map((w) => w.name).join(', ')} — STRONG signal`
        : `0/${wallets.length} smart wallets in this pool — neutral, rely on fundamentals`,
  }
}
