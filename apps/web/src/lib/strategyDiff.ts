export type DiffKind = 'changed' | 'added' | 'removed'
export interface DiffRow {
  path: string
  before: string
  after: string
  kind: DiffKind
}

// Timestamps churn between strategies and are noise in a "what will change" preview.
const VOLATILE = /(_at|At)$/

function flatten(value: unknown, prefix: string, out: Map<string, string>): void {
  if (value !== null && typeof value === 'object') {
    const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value)
    if (entries.length === 0) out.set(prefix, Array.isArray(value) ? '[]' : '{}')
    for (const [k, v] of entries) {
      if (VOLATILE.test(k)) continue
      flatten(v, prefix ? `${prefix}.${k}` : k, out)
    }
    return
  }
  out.set(prefix, typeof value === 'string' ? value : JSON.stringify(value))
}

/** `/api/tool` wraps output in `{ result }`; get_strategy may nest under `strategy`. */
export function unwrapStrategy(res: unknown): unknown {
  const r = (res as { result?: unknown } | null)?.result ?? res
  const s = (r as { strategy?: unknown } | null)?.strategy
  return s ?? r
}

export function diffObjects(before: unknown, after: unknown): DiffRow[] {
  const a = new Map<string, string>()
  const b = new Map<string, string>()
  // A missing side (agent with no current strategy) is an empty set, not a literal `null` row.
  if (before != null) flatten(before, '', a)
  if (after != null) flatten(after, '', b)
  const rows: DiffRow[] = []
  for (const path of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(path)
    const y = b.get(path)
    if (x === y) continue
    rows.push({
      path: path || '(root)',
      before: x ?? '',
      after: y ?? '',
      kind: x === undefined ? 'added' : y === undefined ? 'removed' : 'changed',
    })
  }
  return rows.sort((p, q) => p.path.localeCompare(q.path))
}
