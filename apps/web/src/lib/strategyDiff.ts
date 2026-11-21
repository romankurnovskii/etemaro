export type DiffKind = 'added' | 'removed' | 'changed'

export interface DiffRow {
  /** Dotted path, e.g. `range.min`. */
  key: string
  kind: DiffKind
  before?: unknown
  after?: unknown
}

/** Fields of a `get_strategy` result that describe the parent daemon, not the strategy. */
export const IGNORED_STRATEGY_KEYS: readonly string[] = ['is_active']

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Flatten nested objects into dotted keys. Arrays, primitives and empty
 * objects are leaves.
 */
export function flatten(value: unknown, prefix = ''): Record<string, unknown> {
  if (!isPlainObject(value) || (prefix && Object.keys(value).length === 0)) {
    return prefix ? { [prefix]: value } : {}
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    Object.assign(out, flatten(v, prefix ? `${prefix}.${k}` : k))
  }
  return out
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return false
}

/**
 * Recursive diff between two strategy objects, one row per changed leaf.
 * `before` may be null (agent has no strategy yet) — every leaf is then "added".
 */
export function diffStrategies(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  ignore: readonly string[] = IGNORED_STRATEGY_KEYS,
): DiffRow[] {
  const strip = (obj: Record<string, unknown> | null) =>
    obj ? Object.fromEntries(Object.entries(obj).filter(([k]) => !ignore.includes(k))) : {}
  const a = flatten(strip(before))
  const b = flatten(strip(after))
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
  const rows: DiffRow[] = []
  for (const key of keys) {
    const inA = Object.hasOwn(a, key)
    const inB = Object.hasOwn(b, key)
    if (inA && !inB) rows.push({ key, kind: 'removed', before: a[key] })
    else if (!inA && inB) rows.push({ key, kind: 'added', after: b[key] })
    else if (!sameValue(a[key], b[key])) rows.push({ key, kind: 'changed', before: a[key], after: b[key] })
  }
  return rows
}

/** Compact display of a diff leaf value. */
export function formatDiffValue(value: unknown): string {
  if (value === undefined) return '—'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}
