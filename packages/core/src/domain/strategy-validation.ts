/**
 * @file strategy-validation.ts
 * @description Single source of truth for validating Etemaro strategy JSON files.
 *
 * The strategy loader (`StrategyLibraryManager.loadMerged`) performs a raw JSON cast
 * with no normalisation, so an unknown or snake_case field is silently dropped rather
 * than rejected. These validators surface that explicitly: whether a strategy file is
 * valid, and which fields the runtime will ignore.
 *
 * Exposed through the CLI (`etemaro strategy validate <file...>`) so agents call the
 * CLI instead of re-implementing the schema.
 */
import fs from 'node:fs'

export type StrategyValidationStatus = 'VALID' | 'INVALID'

export interface StrategyValidationEntry {
  /** Library key when the document is `{ strategies: { key: ... } }`. */
  key: string | null
  id: string
  status: StrategyValidationStatus
  errors: string[]
  warnings: string[]
  infos: string[]
  unknownFields: string[]
  legacyFields: Array<{ field: string; canonical: string }>
  /** For each known field present: whether the runtime consumes it. */
  usage: Record<string, string>
}

export interface StrategyValidationReport {
  ok: boolean
  entries: StrategyValidationEntry[]
  totals: { checked: number; valid: number; invalid: number }
}

export interface StrategyFileValidationReport extends StrategyValidationReport {
  file: string
  parseError?: string
}

export interface StrategyValidationOptions {
  /** Promote unknown top-level fields from warning to error. */
  strict?: boolean
  /** Active strategy id from the loaded user config (for requirement checks). */
  activeStrategyId?: string | null
  /** True when the active strategy must define smartWalletListId (entrySource=smart_wallets). */
  requireSmartWalletListId?: boolean
  /** Warn when the active strategy has no list but opportunity.smartWalletScoreBonus > 0 (optional boost). */
  warnMissingSmartWalletListIdForBonus?: boolean
  /** List ids present in smart-wallets.json (for existence checks). */
  knownSmartWalletListIds?: readonly string[] | null
}

/** Top-level keys the runtime reads or writes. Anything else is ignored. */
export const STRATEGY_CANONICAL_KEYS = [
  'id',
  'name',
  'author',
  'smartWalletListId',
  'lpStrategy',
  'tokenCriteria',
  'entry',
  'range',
  'exit',
  'bestFor',
  'raw',
  'addedAt',
  'updatedAt',
] as const

/** Legacy snake_case keys → canonical camelCase. These are ignored by the loader. */
export const STRATEGY_LEGACY_KEYS: Readonly<Record<string, string>> = {
  lp_strategy: 'lpStrategy',
  token_criteria: 'tokenCriteria',
  best_for: 'bestFor',
  added_at: 'addedAt',
  updated_at: 'updatedAt',
}

const NESTED_KNOWN: Readonly<Record<string, readonly string[]>> = {
  tokenCriteria: ['min_mcap', 'min_age_days', 'requires_kol', 'notes'],
  entry: ['condition', 'price_change_threshold_pct', 'singleSide', 'notes'],
  range: ['type', 'binsBelowPct', 'notes'],
  exit: ['takeProfitPct', 'notes'],
}

const NESTED_LEGACY: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  entry: { single_side: 'singleSide' },
  range: { bins_below_pct: 'binsBelowPct' },
  exit: { take_profit_pct: 'takeProfitPct' },
}

const OBJECT_KEYS = new Set(['tokenCriteria', 'entry', 'range', 'exit'])
const LP_STRATEGIES = ['bid_ask', 'spot', 'curve', 'mixed', 'any']
const RANGE_TYPES = ['tight', 'default', 'wide', 'panda', 'custom']
const SINGLE_SIDES = ['sol', 'token']

/** Whether each known field influences behaviour. Kept in sync with the runtime. */
export const STRATEGY_FIELD_USAGE: Readonly<Record<string, string>> = {
  id: 'used (library key + active pointer)',
  name: 'used (logs, lists, LLM strategy context)',
  author: 'stored/descriptive',
  smartWalletListId: 'USED (startup validation + smart-wallet screening)',
  lpStrategy: 'stored/descriptive (deploy uses config.strategy.strategyMeteora)',
  tokenCriteria: 'stored/descriptive (not read by screening)',
  entry: 'partial (condition/notes feed the LLM context; singleSide not consumed)',
  range: 'stored/descriptive (not read at deploy)',
  exit: 'partial (notes feed the LLM context; takeProfitPct not consumed)',
  bestFor: 'used (LLM strategy context + lists)',
  raw: 'stored/descriptive',
  addedAt: 'stored/descriptive',
  updatedAt: 'stored/descriptive',
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const typeOf = (v: unknown): string => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v)
const isIsoDate = (v: unknown): boolean => typeof v === 'string' && !Number.isNaN(Date.parse(v))

interface CollectedEntry {
  key: string | null
  id: string
  strategy: unknown
}

/**
 * Collect strategy entries from any accepted document shape:
 * - `{ strategies: { <id>: {...} } }` (library)
 * - a single strategy object
 */
export function collectStrategyEntries(doc: unknown): CollectedEntry[] {
  if (isObject(doc) && isObject(doc.strategies)) {
    return Object.entries(doc.strategies).map(([key, strategy]) => ({
      key,
      id: isObject(strategy) && typeof strategy.id === 'string' && strategy.id ? strategy.id : key,
      strategy,
    }))
  }
  if (isObject(doc)) {
    return [{ key: null, id: typeof doc.id === 'string' && doc.id ? doc.id : '(no id)', strategy: doc }]
  }
  return [{ key: null, id: '(no id)', strategy: doc }]
}

/** Validate a single strategy entry. */
export function validateStrategyEntry(entry: CollectedEntry, opts: { strict?: boolean } = {}): StrategyValidationEntry {
  const { key, id, strategy } = entry
  const errors: string[] = []
  const warnings: string[] = []
  const infos: string[] = []
  const unknownFields: string[] = []
  const legacyFields: Array<{ field: string; canonical: string }> = []
  const usage: Record<string, string> = {}

  if (!isObject(strategy)) {
    return {
      key,
      id,
      status: 'INVALID',
      errors: [`strategy is not a JSON object (got ${typeOf(strategy)})`],
      warnings,
      infos,
      unknownFields,
      legacyFields,
      usage,
    }
  }

  for (const req of ['id', 'name'] as const) {
    const value = strategy[req]
    if (typeof value !== 'string' || value.trim() === '') {
      errors.push(`missing required string field "${req}"`)
    }
  }

  for (const field of Object.keys(strategy)) {
    if (field in STRATEGY_LEGACY_KEYS) {
      const canonical = STRATEGY_LEGACY_KEYS[field] ?? field
      legacyFields.push({ field, canonical })
      errors.push(`legacy snake_case field "${field}" is ignored — rename to "${canonical}"`)
      continue
    }
    if (!(STRATEGY_CANONICAL_KEYS as readonly string[]).includes(field)) {
      unknownFields.push(field)
      warnings.push(`unknown field "${field}" is not part of the Strategy schema — will be ignored`)
      if (opts.strict) errors.push(`unknown field "${field}" rejected by --strict`)
      continue
    }
    usage[field] = STRATEGY_FIELD_USAGE[field] ?? 'unknown'
    const expected = OBJECT_KEYS.has(field) ? 'object' : 'string'
    const actual = typeOf(strategy[field])
    if (expected === 'object' ? !isObject(strategy[field]) : actual !== expected) {
      errors.push(`field "${field}" should be ${expected} but is ${actual}`)
    }
  }

  if (typeof strategy.lpStrategy === 'string' && !LP_STRATEGIES.includes(strategy.lpStrategy)) {
    warnings.push(`lpStrategy "${strategy.lpStrategy}" is not one of ${LP_STRATEGIES.join('|')}`)
  }
  for (const d of ['addedAt', 'updatedAt'] as const) {
    if (strategy[d] !== undefined && !isIsoDate(strategy[d])) {
      warnings.push(`field "${d}" is not a parseable ISO date`)
    }
  }

  for (const [parent, known] of Object.entries(NESTED_KNOWN)) {
    const obj = strategy[parent]
    if (!isObject(obj)) continue
    const legacyMap = NESTED_LEGACY[parent] ?? {}
    for (const field of Object.keys(obj)) {
      if (field in legacyMap) {
        errors.push(`legacy field "${parent}.${field}" is ignored — rename to "${parent}.${legacyMap[field]}"`)
      } else if (!known.includes(field)) {
        infos.push(`nested field "${parent}.${field}" is not documented for "${parent}" (stored but likely unused)`)
      }
    }
  }
  if (
    isObject(strategy.entry) &&
    typeof strategy.entry.singleSide === 'string' &&
    !SINGLE_SIDES.includes(strategy.entry.singleSide)
  ) {
    warnings.push(`entry.singleSide "${strategy.entry.singleSide}" should be one of ${SINGLE_SIDES.join('|')}`)
  }
  if (
    isObject(strategy.range) &&
    typeof strategy.range.type === 'string' &&
    !RANGE_TYPES.includes(strategy.range.type)
  ) {
    warnings.push(`range.type "${strategy.range.type}" is not one of ${RANGE_TYPES.join('|')}`)
  }

  return {
    key,
    id,
    status: errors.length === 0 ? 'VALID' : 'INVALID',
    errors,
    warnings,
    infos,
    unknownFields,
    legacyFields,
    usage,
  }
}

/**
 * Validate a strategy document. Applies the active-strategy requirement when
 * `opts.activeStrategyId` / `opts.requireSmartWalletListId` are supplied.
 */
export function validateStrategyDocument(doc: unknown, opts: StrategyValidationOptions = {}): StrategyValidationReport {
  const collected = collectStrategyEntries(doc)
  const entries = collected.map((entry) => {
    const isActive =
      opts.activeStrategyId == null
        ? collected.length === 1
        : entry.key === opts.activeStrategyId || entry.id === opts.activeStrategyId
    const result = validateStrategyEntry(entry, { strict: opts.strict })
    const strategy = entry.strategy

    if (entry.key !== null && isObject(strategy) && typeof strategy.id === 'string' && strategy.id !== entry.key) {
      result.warnings.push(
        `library key "${entry.key}" does not match strategy.id "${strategy.id}" (lookup uses the key)`,
      )
    }

    if (isActive && opts.requireSmartWalletListId && isObject(strategy) && !strategy.smartWalletListId) {
      result.errors.push(
        'active strategy requires "smartWalletListId" because screening.entrySource is "smart_wallets" (startup validation will fail)',
      )
      result.status = 'INVALID'
    }
    if (isActive && opts.warnMissingSmartWalletListIdForBonus && isObject(strategy) && !strategy.smartWalletListId) {
      result.warnings.push(
        'active strategy has no smartWalletListId while opportunity.smartWalletScoreBonus>0 — the smart-wallet boost is skipped (optional in market mode)',
      )
    }
    if (isObject(strategy) && typeof strategy.smartWalletListId === 'string' && opts.knownSmartWalletListIds) {
      if (!opts.knownSmartWalletListIds.includes(strategy.smartWalletListId)) {
        result.errors.push(
          `smartWalletListId "${strategy.smartWalletListId}" not found in smart-wallets.json (available: ${opts.knownSmartWalletListIds.join(', ') || 'none'})`,
        )
        result.status = 'INVALID'
      }
    }
    return result
  })

  const valid = entries.filter((e) => e.status === 'VALID').length
  return {
    ok: valid === entries.length,
    entries,
    totals: { checked: entries.length, valid, invalid: entries.length - valid },
  }
}

/** Read and validate a strategy JSON file. */
export function validateStrategyFile(
  filePath: string,
  opts: StrategyValidationOptions = {},
): StrategyFileValidationReport {
  let doc: unknown
  try {
    doc = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return {
      file: filePath,
      ok: false,
      parseError: message,
      entries: [
        {
          key: null,
          id: '(parse error)',
          status: 'INVALID',
          errors: [message],
          warnings: [],
          infos: [],
          unknownFields: [],
          legacyFields: [],
          usage: {},
        },
      ],
      totals: { checked: 1, valid: 0, invalid: 1 },
    }
  }
  return { file: filePath, ...validateStrategyDocument(doc, opts) }
}
