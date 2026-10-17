import type { LogEntry, ManagedAgent, StateSnapshot } from './ipc'

export type Severity = 'info' | 'warn' | 'error'
export type Stage = 'idle' | 'evaluating' | 'rebalancing' | 'settled'

export const STAGES: { id: Stage; label: string }[] = [
  { id: 'idle', label: 'Idle' },
  { id: 'evaluating', label: 'Evaluating' },
  { id: 'rebalancing', label: 'Rebalancing' },
  { id: 'settled', label: 'Settled' },
]

export function severityOf(entry: LogEntry): Severity {
  const c = entry.category.toLowerCase()
  if (c === 'error' || c.endsWith('_error') || c === 'tool_blocked') return 'error'
  if (c === 'warn' || c.endsWith('_warn')) return 'warn'
  return 'info'
}

export function stageOfCategory(category: string): Stage | null {
  const c = category.toLowerCase()
  if (/^(screening|strategy|agent|agent_reply|lessons|signal_weights|smart_wallets|blacklist|tool_start)/.test(c))
    return 'evaluating'
  if (/^(deploy|close|swap|positions|wallet|cron)/.test(c) && !c.endsWith('_error') && !c.endsWith('_warn'))
    return 'rebalancing'
  if (c === 'tool_finish' || c === 'state') return 'settled'
  return null
}

export interface AgentTelemetry {
  stage: Stage
  lastLogAt: string | null
  lastTool: string | null
  lastToolOk: boolean | null
  lastDecision: string | null
  errors: number
  warns: number
}

export function telemetryFor(agent: ManagedAgent, logs: LogEntry[], snapshot: StateSnapshot | null): AgentTelemetry {
  const mine = logs.filter((l) => l.agentId === agent.id)
  let stage: Stage = 'idle'
  let lastTool: string | null = null
  let lastToolOk: boolean | null = null
  let lastDecision: string | null = null
  let errors = 0
  let warns = 0
  let stageFound = false
  for (let i = mine.length - 1; i >= 0; i--) {
    const l = mine[i] as LogEntry
    const sev = severityOf(l)
    if (sev === 'error') errors++
    if (sev === 'warn') warns++
    if (!stageFound) {
      const s = stageOfCategory(l.category)
      if (s) {
        stage = s
        stageFound = true
      }
    }
    if (!lastTool && (l.category === 'tool_start' || l.category === 'tool_finish' || l.category === 'tool_blocked')) {
      const t = l.metadata?.tool
      if (typeof t === 'string') {
        lastTool = t
        lastToolOk = l.category === 'tool_finish' ? true : l.category === 'tool_blocked' ? false : null
      }
    }
    if (!lastDecision && (l.category === 'agent_reply' || l.category === 'strategy')) lastDecision = l.message
  }
  if (!agent.running) stage = 'idle'
  else if (snapshot?.busy && !stageFound && snapshot.activeStrategyId === agent.strategyId) stage = 'evaluating'
  const last = mine[mine.length - 1]
  return { stage, lastLogAt: last?.ts ?? null, lastTool, lastToolOk, lastDecision, errors, warns }
}

export type AgentHealth = 'running' | 'idle' | 'stopped' | 'error'

export function healthOf(agent: ManagedAgent, t: AgentTelemetry): AgentHealth {
  if (!agent.running) return 'stopped'
  if (t.errors > 0 && t.lastLogAt && Date.now() - Date.parse(t.lastLogAt) < 120_000 && t.stage === 'idle')
    return 'error'
  return t.stage === 'idle' ? 'idle' : 'running'
}

export function relTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

export function flatten(value: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (value === null || typeof value !== 'object') {
    out[prefix || '(value)'] = JSON.stringify(value)
    return out
  }
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value)
  if (entries.length === 0) out[prefix || '(value)'] = Array.isArray(value) ? '[]' : '{}'
  for (const [k, v] of entries) flatten(v, prefix ? `${prefix}.${k}` : k, out)
  return out
}

export interface DiffRow {
  key: string
  before: string | null
  after: string | null
}

export function diffFlat(a: Record<string, string>, b: Record<string, string>): DiffRow[] {
  const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort()
  const rows: DiffRow[] = []
  for (const key of keys) {
    const before = a[key] ?? null
    const after = b[key] ?? null
    if (before !== after) rows.push({ key, before, after })
  }
  return rows
}
