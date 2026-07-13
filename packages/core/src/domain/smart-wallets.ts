import { log } from '../shared/logger.js';
import { dataPath, SOLANA_PUBKEY_RE, CACHE_TTL_MS } from '../shared/constants.js';
import { loadJsonFile, saveJsonFile } from '../shared/utils.js';
import type { SmartWallet, SmartWalletHit } from '../shared/types.js';

const WALLETS_PATH = dataPath('smart-wallets.json');

interface SmartWalletsData {
  wallets: SmartWallet[];
}

function loadWallets(): SmartWalletsData {
  return loadJsonFile<SmartWalletsData>(WALLETS_PATH, { wallets: [] });
}

function saveWallets(data: SmartWalletsData): void {
  saveJsonFile(WALLETS_PATH, data);
}

export function addSmartWallet({
  name,
  address,
  category = 'alpha',
  type = 'lp',
}: {
  name: string;
  address: string;
  category?: string;
  type?: 'lp' | 'holder';
}): Record<string, unknown> {
  if (!SOLANA_PUBKEY_RE.test(address)) {
    return { success: false, error: 'Invalid Solana address format' };
  }
  const data = loadWallets();
  const existing = data.wallets.find((w) => w.address === address);
  if (existing) {
    return { success: false, error: `Already tracked as "${existing.name}"` };
  }
  data.wallets.push({ name, address, category, type, addedAt: new Date().toISOString() });
  saveWallets(data);
  log('smart_wallets', `Added wallet: ${name} (${category}, type=${type})`);
  return { success: true, wallet: { name, address, category, type } };
}

export function removeSmartWallet({ address }: { address: string }): Record<string, unknown> {
  const data = loadWallets();
  const wallet = data.wallets.find((w) => w.address === address);
  if (!wallet) return { success: false, error: 'Wallet not found' };
  data.wallets = data.wallets.filter((w) => w.address !== address);
  saveWallets(data);
  log('smart_wallets', `Removed wallet: ${wallet.name}`);
  return { success: true, removed: wallet.name };
}

export function listSmartWallets(): { total: number; wallets: SmartWallet[] } {
  const { wallets } = loadWallets();
  return { total: wallets.length, wallets };
}

// Cache wallet positions for 5 minutes to avoid hammering RPC
const _cache = new Map<string, { positions: Array<{ pool: string }>; fetchedAt: number }>();

/**
 * Callback type for fetching wallet positions — injected by the caller
 * to avoid circular dependency with tools/dlmm.js.
 */
export type GetWalletPositionsFn = (opts: { wallet_address: string }) => Promise<{ positions: Array<{ pool: string }> }>;

/**
 * Check smart wallets' positions against a specific pool.
 *
 * @param opts.pool_address - The pool to check against
 * @param opts.getWalletPositions - Function to fetch wallet positions (injected to avoid circular deps)
 */
export async function checkSmartWalletsOnPool(
  { pool_address }: { pool_address: string },
  getWalletPositions?: GetWalletPositionsFn,
): Promise<{
  pool: string;
  tracked_wallets: number;
  in_pool: SmartWalletHit[];
  confidence_boost: boolean;
  signal: string;
}> {
  const { wallets: allWallets } = loadWallets();
  // Only check LP-type wallets — holder wallets don't have positions
  const wallets = allWallets.filter((w) => !w.type || w.type === 'lp');
  if (wallets.length === 0) {
    return {
      pool: pool_address,
      tracked_wallets: 0,
      in_pool: [],
      confidence_boost: false,
      signal: 'No smart wallets tracked yet — neutral signal',
    };
  }

  const getPositions: GetWalletPositionsFn = getWalletPositions ?? (await import('../adapters/blockchain/MeteoraAdapter.js')).getWalletPositions;

  const results = await Promise.all(
    wallets.map(async (wallet) => {
      try {
        const cached = _cache.get(wallet.address);
        if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
          return { wallet, positions: cached.positions };
        }
        const { positions } = await getPositions({ wallet_address: wallet.address });
        _cache.set(wallet.address, { positions: positions || [], fetchedAt: Date.now() });
        return { wallet, positions: positions || [] };
      } catch {
        return { wallet, positions: [] as Array<{ pool: string }> };
      }
    }),
  );

  const inPool = results
    .filter((r) => r.positions.some((p) => p.pool === pool_address))
    .map((r) => ({ name: r.wallet.name, category: r.wallet.category, address: r.wallet.address }));

  return {
    pool: pool_address,
    tracked_wallets: wallets.length,
    in_pool: inPool,
    confidence_boost: inPool.length > 0,
    signal:
      inPool.length > 0
        ? `${inPool.length}/${wallets.length} smart wallet(s) are in this pool: ${inPool.map((w) => w.name).join(', ')} — STRONG signal`
        : `0/${wallets.length} smart wallets in this pool — neutral, rely on fundamentals`,
  };
}
