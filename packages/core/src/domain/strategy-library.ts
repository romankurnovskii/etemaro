/**
 * @file strategy-library.ts
 * @description Domain manager for saving, retrieving, and merging active LP strategy profiles (strategy-library.json).
 *
 * @features
 * - Manages named LP strategy profiles (bid-ask, spot, custom bin distributions)
 * - Sets active deployment strategy profile
 * - Merges preset profiles pulled from HiveMind fleet
 *
 */

import fs from 'node:fs'
import { config } from '../config/Config.js'
import { configPath, getDataDir, repoPath, strategyLibraryPath } from '../shared/constants.js'
import { log } from '../shared/logger.js'
import type { Strategy, StrategyLibraryData } from '../shared/types.js'
import { loadJsonFile, saveJsonFile } from '../shared/utils.js'
import { DEFAULT_STRATEGIES } from './defaultStrategies.js'

export { DEFAULT_STRATEGIES } from './defaultStrategies.js'

// ─── Strategy Library Manager ─────────────────────────────────
const STRATEGY_FILE = strategyLibraryPath('strategy-library.json')
const SHARED_STRATEGY_FILE = repoPath('data', 'strategy-library.shared.json')

export type StrategySource = 'shared' | 'private' | 'default'

export interface ResolvedStrategyLibrary {
  data: StrategyLibraryData
  collisions: string[]
  sources: Record<string, StrategySource>
}

interface SharedLibraryInfo {
  data: StrategyLibraryData
  fromDefaults: boolean
}

/**
 * Central owner of strategy library path resolution and source handling.
 * Resolves the private (local) and shared (repo-tracked, local shared file,
 * or bundled defaults) strategy libraries, merges them with collision
 * detection, and validates the active strategy pointer at agent boot.
 *
 * See https://github.com/romankurnovskii/etemaro/issues/218
 */
export class StrategyLibraryManager {
  readonly paths = {
    dataDir: getDataDir(),
    privatePath: STRATEGY_FILE,
    sharedPath: SHARED_STRATEGY_FILE,
  }

  loadPrivate(): StrategyLibraryData {
    return loadJsonFile<StrategyLibraryData>(this.paths.privatePath, { strategies: {} })
  }

  savePrivate(data: StrategyLibraryData): void {
    saveJsonFile(this.paths.privatePath, data)
  }

  private loadSharedWithInfo(): SharedLibraryInfo {
    let sharedDb = loadJsonFile<StrategyLibraryData>(this.paths.sharedPath, { strategies: {} })

    if (Object.keys(sharedDb.strategies).length === 0) {
      const localSharedFile = strategyLibraryPath('strategy-library.shared.json')
      if (fs.existsSync(localSharedFile)) {
        sharedDb = loadJsonFile<StrategyLibraryData>(localSharedFile, { strategies: {} })
      }
    }

    if (Object.keys(sharedDb.strategies).length === 0) {
      return { data: { strategies: { ...DEFAULT_STRATEGIES } }, fromDefaults: true }
    }
    return { data: sharedDb, fromDefaults: false }
  }

  loadMerged(): ResolvedStrategyLibrary {
    const shared = this.loadSharedWithInfo()
    const privateDb = this.loadPrivate()

    const sources: Record<string, StrategySource> = {}
    for (const id of Object.keys(shared.data.strategies)) {
      sources[id] = shared.fromDefaults ? 'default' : 'shared'
    }

    const collisions: string[] = []
    for (const id of Object.keys(privateDb.strategies)) {
      if (sources[id] === 'shared' || sources[id] === 'default') {
        collisions.push(id)
        log('strategy', `Warning: private strategy '${id}' collides with a shared strategy id and overrides it.`)
        log(
          'strategy',
          'Duplicate strategy ids between shared and private libraries should be resolved (see issue #148).',
        )
      }
      sources[id] = 'private'
    }

    return {
      data: {
        strategies: {
          ...shared.data.strategies,
          ...privateDb.strategies,
        },
      },
      collisions,
      sources,
    }
  }

  /**
   * Validate that the configured active strategy is present in the merged library.
   * Throws an error with a clear message if the validation fails. Called at agent boot.
   */
  validate(): void {
    const activeId = config.strategy.activeStrategyId
    if (!activeId || activeId.trim() === '') {
      throw new Error(`Startup failed: 'activeStrategyId' is missing or empty in config.`)
    }
    const merged = this.loadMerged()
    if (!merged.data.strategies[activeId]) {
      throw new Error(
        `Startup failed: Strategy '${activeId}' specified in config is not found in the strategy library.`,
      )
    }
  }
}

export const strategyLibraryManager = new StrategyLibraryManager()

// ─── Thin delegates over the manager ─────────────────────────
function loadPrivate(): StrategyLibraryData {
  return strategyLibraryManager.loadPrivate()
}

function savePrivate(data: StrategyLibraryData): void {
  strategyLibraryManager.savePrivate(data)
}

function load(): StrategyLibraryData {
  return strategyLibraryManager.loadMerged().data
}

// ─── Tool Handlers ─────────────────────────────────────────────

interface AddStrategyOpts {
  id: string
  name: string
  author?: string
  lpStrategy?: string
  tokenCriteria?: Record<string, unknown>
  entry?: Record<string, unknown>
  range?: Record<string, unknown>
  exit?: Record<string, unknown>
  bestFor?: string
  raw?: string
}

/**
 * Add or update a strategy.
 * The agent parses the raw tweet/text and fills in the structured fields.
 */
export function addStrategy({
  id,
  name,
  author = 'unknown',
  lpStrategy = 'bid_ask', // "bid_ask" | "spot" | "curve"
  tokenCriteria = {}, // { min_mcap, min_age_days, requires_kol, notes }
  entry = {}, // { condition, price_change_threshold_pct, singleSide }
  range = {}, // { type, binsBelowPct, notes }
  exit = {}, // { takeProfitPct, notes }
  bestFor = '', // short description of ideal conditions
  raw = '', // original tweet/text
}: AddStrategyOpts): Record<string, unknown> {
  if (!id || !name) return { error: 'id and name are required' }

  const privateDb = loadPrivate()

  // Slugify id
  const slug = id
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')

  privateDb.strategies[slug] = {
    id: slug,
    name,
    author,
    lpStrategy,
    tokenCriteria,
    entry,
    range,
    exit,
    bestFor,
    raw,
    addedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  // Auto-set as active if it's the first strategy
  savePrivate(privateDb)
  let isActive = false
  if (Object.keys(privateDb.strategies).length === 1) {
    setActiveStrategy({ id: slug })
    isActive = true
  }

  log('strategy', `Strategy saved: ${name} (${slug})`)
  return { saved: true, id: slug, name, active: isActive }
}

/**
 * List all strategies with a summary.
 */
export function listStrategies(): Record<string, unknown> {
  const db = load()
  const activeId = config.strategy.activeStrategyId
  const strategies = Object.values(db.strategies).map((s) => ({
    id: s.id,
    name: s.name,
    author: s.author,
    lpStrategy: s.lpStrategy,
    bestFor: s.bestFor,
    active: activeId === s.id,
    addedAt: s.addedAt?.slice(0, 10),
  }))
  return { active: activeId, count: strategies.length, strategies }
}

/**
 * Get full details of a strategy including raw text and all criteria.
 */
export function getStrategy({ id }: { id: string }): Record<string, unknown> {
  if (!id) return { error: 'id required' }
  const db = load()
  const strategy = db.strategies[id]
  if (!strategy) return { error: `Strategy "${id}" not found`, available: Object.keys(db.strategies) }
  return { ...strategy, is_active: config.strategy.activeStrategyId === id }
}

/**
 * Set the active strategy used during screening cycles.
 */
export function setActiveStrategy({ id }: { id: string }): Record<string, unknown> {
  if (!id) return { error: 'id required' }
  const mergedDb = load()
  if (!mergedDb.strategies[id])
    return { error: `Strategy "${id}" not found`, available: Object.keys(mergedDb.strategies) }

  const userConfigPath = configPath('user-config.json')
  try {
    if (fs.existsSync(userConfigPath)) {
      const raw = JSON.parse(fs.readFileSync(userConfigPath, 'utf8'))
      if (!raw.strategy) raw.strategy = {}
      raw.strategy.activeStrategyId = id
      fs.writeFileSync(userConfigPath, `${JSON.stringify(raw, null, 2)}\n`)
    } else {
      throw new Error(`user-config.json not found at ${userConfigPath}`)
    }
  } catch (err) {
    const errorMsg = `Failed to update user config: ${err}`
    log('strategy', errorMsg)
    return { error: errorMsg }
  }

  config.strategy.activeStrategyId = id
  log('strategy', `Active strategy set to: ${mergedDb.strategies[id].name}`)
  return { active: id, name: mergedDb.strategies[id].name }
}

/**
 * Remove a strategy.
 */
export function removeStrategy({ id }: { id: string }): Record<string, unknown> {
  if (!id) return { error: 'id required' }
  const privateDb = loadPrivate()

  if (!privateDb.strategies[id]) {
    const sharedDb = loadJsonFile<StrategyLibraryData>(strategyLibraryManager.paths.sharedPath, { strategies: {} })
    if (sharedDb.strategies[id] || DEFAULT_STRATEGIES[id]) {
      return { error: `Strategy "${id}" is a shared open-source strategy and cannot be removed locally.` }
    }
    return { error: `Strategy "${id}" not found` }
  }

  const name = privateDb.strategies[id].name
  delete privateDb.strategies[id]

  const sharedDb = loadJsonFile<StrategyLibraryData>(strategyLibraryManager.paths.sharedPath, { strategies: {} })
  const hasSharedFallback = !!(sharedDb.strategies[id] || DEFAULT_STRATEGIES[id])

  if (config.strategy.activeStrategyId === id && !hasSharedFallback) {
    const available = new Set([
      ...Object.keys(privateDb.strategies),
      ...Object.keys(sharedDb.strategies),
      ...Object.keys(DEFAULT_STRATEGIES),
    ])
    available.delete(id)
    const newActive = Array.from(available)[0] || null
    if (newActive) {
      setActiveStrategy({ id: newActive })
    } else {
      // Clear the active strategy pointer if no strategies exist at all
      const userConfigPath = configPath('user-config.json')
      try {
        if (fs.existsSync(userConfigPath)) {
          const raw = JSON.parse(fs.readFileSync(userConfigPath, 'utf8'))
          if (!raw.strategy) raw.strategy = {}
          raw.strategy.activeStrategyId = null
          fs.writeFileSync(userConfigPath, `${JSON.stringify(raw, null, 2)}\n`)
        }
      } catch (err) {
        log('strategy', `Failed to update user config during removal: ${err}`)
      }
      config.strategy.activeStrategyId = '' // empty string represents null
    }
  }

  savePrivate(privateDb)
  log('strategy', `Strategy removed: ${name}`)
  return { removed: true, id, name, new_active: config.strategy.activeStrategyId }
}

/**
 * Get the currently active strategy — used by screening cycle.
 */
export function getActiveStrategy(): Strategy | null {
  const db = load()
  const activeId = config.strategy.activeStrategyId
  if (!activeId || !db.strategies[activeId]) return null
  return db.strategies[activeId] ?? null
}

/**
 * Validate that the configured active strategy is present in the strategy library.
 * Throws an error with a clear message if the validation fails. Runs at agent boot.
 */
export function validateActiveStrategy(): void {
  strategyLibraryManager.validate()
}

/**
 * Merge fleet presets into the local private library.
 * This preserves local modifications and does not touch the active pointer.
 */
export function mergePresets(presets: unknown[]): void {
  if (!presets || !Array.isArray(presets)) return
  const privateDb = loadPrivate()
  let changed = false

  for (const preset of presets) {
    const rawStrategy = preset as Record<string, unknown>
    const id = rawStrategy.id as string
    const name = rawStrategy.name as string
    if (!id || !name) continue

    const slug = id
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '')

    // Never overwrite an existing local strategy
    if (!privateDb.strategies[slug]) {
      privateDb.strategies[slug] = {
        id: slug,
        name,
        author: (rawStrategy.author as string) || 'hivemind',
        lpStrategy: (rawStrategy.lpStrategy as string) || 'bid_ask',
        tokenCriteria: (rawStrategy.tokenCriteria as Record<string, unknown>) || {},
        entry: (rawStrategy.entry as Record<string, unknown>) || {},
        range: (rawStrategy.range as Record<string, unknown>) || {},
        exit: (rawStrategy.exit as Record<string, unknown>) || {},
        bestFor: (rawStrategy.bestFor as string) || '',
        raw: (rawStrategy.raw as string) || '',
        addedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      changed = true
      log('strategy', `Merged HiveMind preset: ${name} (${slug})`)
    }
  }

  if (changed) {
    savePrivate(privateDb)
  }
}
