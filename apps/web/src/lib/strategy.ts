import { fetchJson } from './api'
import type { StrategySummary } from './ipc'

/**
 * Full strategy record as returned by the `get_strategy` CLI tool
 * (see docs/strategies + config/shared/strategy-library.shared.json).
 */
export interface StrategyDetail extends StrategySummary {
  author?: string
  bestFor?: string
  lpStrategy?: string
  tokenCriteria?: Record<string, unknown>
  entry?: Record<string, unknown>
  range?: Record<string, unknown>
  exit?: Record<string, unknown>
  [key: string]: unknown
}

/** Sections of a strategy that matter when switching strategies mid-flight. */
const DIFF_SECTIONS: Array<{ key: keyof StrategyDetail; label: string }> = [
  { key: 'lpStrategy', label: 'LP strategy' },
  { key: 'tokenCriteria', label: 'Token criteria' },
  { key: 'entry', label: 'Entry' },
  { key: 'range', label: 'Range' },
  { key: 'exit', label: 'Exit' },
]

export interface StrategyDiffRow {
  label: string
  from: string | null
  to: string | null
  changed: boolean
}

function renderValue(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v != null && v !== '' && !(typeof v === 'object' && Object.keys(v as object).length === 0),
    )
    if (entries.length === 0) return null
    return entries.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ')
  }
  return String(value)
}

/** Fetch the full detail record for one strategy id via the CLI tool catalog. */
export async function fetchStrategyDetail(token: string, id: string): Promise<StrategyDetail> {
  const res = await fetchJson<{ result?: { strategy?: StrategyDetail } }>('/api/tool', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'get_strategy', args: { id } }),
  })
  const strategy = res.result?.strategy
  if (!strategy) throw new Error(`Strategy "${id}" not found`)
  return { ...strategy, id }
}

/** Build a side-by-side diff between two strategy records for preview. */
export function diffStrategies(from: StrategyDetail | null, to: StrategyDetail | null): StrategyDiffRow[] {
  return DIFF_SECTIONS.map(({ key, label }) => {
    const fromValue = from ? renderValue(from[key]) : null
    const toValue = to ? renderValue(to[key]) : null
    return { label, from: fromValue, to: toValue, changed: fromValue !== toValue }
  }).filter((row) => row.from != null || row.to != null)
}
