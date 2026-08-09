/**
 * Strategy Library — persistent store of LP strategies.
 *
 * Users paste a tweet or description via Telegram.
 * The agent extracts structured criteria and saves it here.
 * During screening, the active strategy's criteria guide token selection and position config.
 */

import { log } from '../shared/logger.js';
import { dataPath, repoPath } from '../shared/constants.js';
import { loadJsonFile, saveJsonFile } from '../shared/utils.js';
import type { Strategy, StrategyLibraryData } from '../shared/types.js';

const STRATEGY_FILE = dataPath('strategy-library.json');
const SHARED_STRATEGY_FILE = repoPath('data', 'strategy-library.shared.json');

function loadPrivate(): StrategyLibraryData {
  return loadJsonFile<StrategyLibraryData>(STRATEGY_FILE, { active: null, strategies: {} });
}

function savePrivate(data: StrategyLibraryData): void {
  saveJsonFile(STRATEGY_FILE, data);
}

function load(): StrategyLibraryData {
  const sharedDb = loadJsonFile<StrategyLibraryData>(SHARED_STRATEGY_FILE, { active: null, strategies: {} });

  if (Object.keys(sharedDb.strategies).length === 0) {
    sharedDb.strategies = DEFAULT_STRATEGIES;
  }

  const privateDb = loadPrivate();

  return {
    active: privateDb.active || sharedDb.active,
    strategies: {
      ...sharedDb.strategies,
      ...privateDb.strategies,
    },
  };
}

// ─── Default Strategies ─────────────────────────────────────────
const DEFAULT_STRATEGIES: Record<string, Strategy> = {
  custom_ratio_spot: {
    id: 'custom_ratio_spot',
    name: 'Custom Ratio Spot',
    author: 'meridian',
    lp_strategy: 'spot',
    token_criteria: { notes: 'Any token. Ratio expresses directional bias.' },
    entry: {
      condition: 'Directional view on token',
      single_side: null,
      notes:
        '75% token = bullish (sell on pump out of range). 75% SOL = bearish/DCA-in (buy on dip). Set bins_below:bins_above proportional to ratio.',
    },
    range: { type: 'custom', notes: 'bins_below:bins_above ratio matches token:SOL ratio. E.g., 75% token → ~52 bins below, ~17 bins above.' },
    exit: { take_profit_pct: 10, notes: 'Close when OOR or TP hit. Re-deploy with updated ratio based on new momentum signals.' },
    best_for: 'Expressing directional bias while earning fees both ways',
  },
  single_sided_reseed: {
    id: 'single_sided_reseed',
    name: 'Single-Sided Bid-Ask + Re-seed',
    author: 'meridian',
    lp_strategy: 'bid_ask',
    token_criteria: { notes: 'Volatile tokens with strong narrative. Must have active volume.' },
    entry: {
      condition: 'Deploy token-only (amount_x only, amount_y=0) bid-ask, bins below active bin only',
      single_side: 'token',
      notes: 'As price drops through bins, token sold for SOL. Bid-ask concentrates at bottom edge.',
    },
    range: { type: 'default', bins_below_pct: 100, notes: 'All bins below active bin. bins_above=0.' },
    exit: {
      notes:
        'When OOR downside: close_position(skip_swap=true) → redeploy token-only bid-ask at new lower price. Do NOT swap to SOL. Full close only when token dead or after N re-seeds with declining performance.',
    },
    best_for: 'Riding volatile tokens down without cutting losses. DCA out via LP.',
  },
  fee_compounding: {
    id: 'fee_compounding',
    name: 'Fee Compounding',
    author: 'meridian',
    lp_strategy: 'any',
    token_criteria: { notes: 'Stable volume pools with consistent fee generation.' },
    entry: { condition: 'Deploy normally with any shape', notes: 'Strategy is about management, not entry shape.' },
    range: { type: 'default', notes: 'Standard range for the pair.' },
    exit: { notes: 'When unclaimed fees > $5 AND in range: claim_fees → add_liquidity back into same position. Normal close rules otherwise.' },
    best_for: 'Maximizing yield on stable, range-bound pools via compounding',
  },
  multi_layer: {
    id: 'multi_layer',
    name: 'Multi-Layer',
    author: 'meridian',
    lp_strategy: 'mixed',
    token_criteria: {
      notes: 'High volume pools. Layer multiple shapes into ONE position via addLiquidityByStrategy to sculpt a composite distribution.',
    },
    entry: {
      condition:
        'Create ONE position, then layer additional shapes onto it with add-liquidity. Each layer adds a different strategy/shape to the same position, compositing them.',
      notes:
        'Step 1: deploy (creates position with first shape). Step 2+: add-liquidity to same position with different shapes. All layers share the same bin range but different distribution curves stack on top of each other.',
      example_patterns: {
        smooth_edge: 'Deploy Bid-Ask (edges) → add-liquidity Spot (fills the middle gap). 2 layers, 1 position.',
        full_composite: 'Deploy Bid-Ask (edges) → add-liquidity Spot (middle) → add-liquidity Curve (center boost). 3 layers, 1 position.',
        edge_heavy: 'Deploy Bid-Ask → add-liquidity Bid-Ask again (double edge weight). 2 layers, 1 position.',
      },
    },
    range: {
      type: 'custom',
      notes: "All layers share the position's bin range (set at deploy). Choose range wide enough for the widest layer needed.",
    },
    exit: { notes: 'Single position — one close, one claim. The composite shape means fees earned reflect ALL layers combined.' },
    best_for: 'Creating custom liquidity distributions by stacking shapes in one position. Single position to manage.',
  },
  partial_harvest: {
    id: 'partial_harvest',
    name: 'Partial Harvest',
    author: 'meridian',
    lp_strategy: 'any',
    token_criteria: { notes: 'High fee pools where taking profit incrementally is preferred.' },
    entry: { condition: 'Deploy normally', notes: 'Strategy is about progressive profit-taking, not entry.' },
    range: { type: 'default', notes: 'Standard range.' },
    exit: {
      take_profit_pct: 10,
      notes:
        'When total return >= 10% of deployed capital: withdraw_liquidity(bps=5000) to take 50% off. Remaining 50% keeps running. Repeat at next threshold.',
    },
    best_for: 'Locking in profits without fully exiting winning positions',
  },
};

function ensureDefaultStrategies(): void {
  const privateDb = loadPrivate();
  let changed = false;

  if (!privateDb.active) {
    privateDb.active = 'custom_ratio_spot';
    changed = true;
  }

  if (changed) {
    savePrivate(privateDb);
    log('strategy', 'Initialized private strategy library');
  }
}

ensureDefaultStrategies();

// ─── Tool Handlers ─────────────────────────────────────────────

interface AddStrategyOpts {
  id: string;
  name: string;
  author?: string;
  lp_strategy?: string;
  token_criteria?: Record<string, unknown>;
  entry?: Record<string, unknown>;
  range?: Record<string, unknown>;
  exit?: Record<string, unknown>;
  best_for?: string;
  raw?: string;
}

/**
 * Add or update a strategy.
 * The agent parses the raw tweet/text and fills in the structured fields.
 */
export function addStrategy({
  id,
  name,
  author = 'unknown',
  lp_strategy = 'bid_ask', // "bid_ask" | "spot" | "curve"
  token_criteria = {}, // { min_mcap, min_age_days, requires_kol, notes }
  entry = {}, // { condition, price_change_threshold_pct, single_side }
  range = {}, // { type, bins_below_pct, notes }
  exit = {}, // { take_profit_pct, notes }
  best_for = '', // short description of ideal conditions
  raw = '', // original tweet/text
}: AddStrategyOpts): Record<string, unknown> {
  if (!id || !name) return { error: 'id and name are required' };

  const privateDb = loadPrivate();

  // Slugify id
  const slug = id
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');

  privateDb.strategies[slug] = {
    id: slug,
    name,
    author,
    lp_strategy,
    token_criteria,
    entry,
    range,
    exit,
    best_for,
    raw,
    added_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Auto-set as active if it's the first strategy
  if (!privateDb.active) privateDb.active = slug;

  savePrivate(privateDb);
  log('strategy', `Strategy saved: ${name} (${slug})`);
  return { saved: true, id: slug, name, active: privateDb.active === slug };
}

/**
 * List all strategies with a summary.
 */
export function listStrategies(): Record<string, unknown> {
  const db = load();
  const strategies = Object.values(db.strategies).map((s) => ({
    id: s.id,
    name: s.name,
    author: s.author,
    lp_strategy: s.lp_strategy,
    best_for: s.best_for,
    active: db.active === s.id,
    added_at: s.added_at?.slice(0, 10),
  }));
  return { active: db.active, count: strategies.length, strategies };
}

/**
 * Get full details of a strategy including raw text and all criteria.
 */
export function getStrategy({ id }: { id: string }): Record<string, unknown> {
  if (!id) return { error: 'id required' };
  const db = load();
  const strategy = db.strategies[id];
  if (!strategy) return { error: `Strategy "${id}" not found`, available: Object.keys(db.strategies) };
  return { ...strategy, is_active: db.active === id };
}

/**
 * Set the active strategy used during screening cycles.
 */
export function setActiveStrategy({ id }: { id: string }): Record<string, unknown> {
  if (!id) return { error: 'id required' };
  const mergedDb = load();
  if (!mergedDb.strategies[id]) return { error: `Strategy "${id}" not found`, available: Object.keys(mergedDb.strategies) };

  const privateDb = loadPrivate();
  privateDb.active = id;
  savePrivate(privateDb);
  log('strategy', `Active strategy set to: ${mergedDb.strategies[id].name}`);
  return { active: id, name: mergedDb.strategies[id].name };
}

/**
 * Remove a strategy.
 */
export function removeStrategy({ id }: { id: string }): Record<string, unknown> {
  if (!id) return { error: 'id required' };
  const privateDb = loadPrivate();

  if (!privateDb.strategies[id]) {
    const sharedDb = loadJsonFile<StrategyLibraryData>(SHARED_STRATEGY_FILE, { active: null, strategies: {} });
    if (sharedDb.strategies[id] || DEFAULT_STRATEGIES[id]) {
      return { error: `Strategy "${id}" is a shared open-source strategy and cannot be removed locally.` };
    }
    return { error: `Strategy "${id}" not found` };
  }

  const name = privateDb.strategies[id].name;
  delete privateDb.strategies[id];

  const sharedDb = loadJsonFile<StrategyLibraryData>(SHARED_STRATEGY_FILE, { active: null, strategies: {} });
  const hasSharedFallback = !!(sharedDb.strategies[id] || DEFAULT_STRATEGIES[id]);

  if (privateDb.active === id && !hasSharedFallback) {
    const available = new Set([...Object.keys(privateDb.strategies), ...Object.keys(sharedDb.strategies), ...Object.keys(DEFAULT_STRATEGIES)]);
    available.delete(id);
    privateDb.active = Array.from(available)[0] || null;
  }

  savePrivate(privateDb);
  log('strategy', `Strategy removed: ${name}`);
  return { removed: true, id, name, new_active: privateDb.active };
}

/**
 * Get the currently active strategy — used by screening cycle.
 */
export function getActiveStrategy(): Strategy | null {
  const db = load();
  if (!db.active || !db.strategies[db.active]) return null;
  return db.strategies[db.active] ?? null;
}

/**
 * Merge fleet presets into the local private library.
 * This preserves local modifications and does not touch the active pointer.
 */
export function mergePresets(presets: unknown[]): void {
  if (!presets || !Array.isArray(presets)) return;
  const privateDb = loadPrivate();
  let changed = false;

  for (const preset of presets) {
    const rawStrategy = preset as Record<string, unknown>;
    const id = rawStrategy.id as string;
    const name = rawStrategy.name as string;
    if (!id || !name) continue;
    
    const slug = id
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');

    // Never overwrite an existing local strategy
    if (!privateDb.strategies[slug]) {
      privateDb.strategies[slug] = {
        id: slug,
        name,
        author: (rawStrategy.author as string) || 'hivemind',
        lp_strategy: (rawStrategy.lp_strategy as string) || 'bid_ask',
        token_criteria: (rawStrategy.token_criteria as Record<string, unknown>) || {},
        entry: (rawStrategy.entry as Record<string, unknown>) || {},
        range: (rawStrategy.range as Record<string, unknown>) || {},
        exit: (rawStrategy.exit as Record<string, unknown>) || {},
        best_for: (rawStrategy.best_for as string) || '',
        raw: (rawStrategy.raw as string) || '',
        added_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      changed = true;
      log('strategy', `Merged HiveMind preset: ${name} (${slug})`);
    }
  }

  if (changed) {
    savePrivate(privateDb);
  }
}
