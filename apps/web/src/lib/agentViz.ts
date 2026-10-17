import type { LogEntry, ManagedAgent, StateSnapshot } from './ipc'

export type Severity = 'info' | 'warn' | 'error'
export const SEVERITIES: readonly Severity[] = ['info', 'warn', 'error']

export const PHASES = ['Idle', 'Evaluating', 'Rebalancing', 'Settled'] as const
export type Phase = (typeof PHASES)[number]

export type FleetStatus = 'running' | 'idle' | 'stopped' | 'error'

/** Recent-activity windows used by the inference below (ms). */
const IN_FLIGHT_MS = 90_000
const SETTLED_MS = 120_000
const ERROR_MS = 300_000

/**
 * The daemon's logger has no level field: it maps the free-form category to a
 * level (`*error*` -> error, `*warn*` -> warn, otherwise info). Mirror that rule
 * so the UI filters agree with what the daemon prints to stdout.
 */
export function logSeverity(entry: Pick<LogEntry, 'category'>): Severity {
  const c = entry.category.toLowerCase()
  if (c.includes('error')) return 'error'
  if (c.includes('warn')) return 'warn'
  return 'info'
}

export function tsMs(entry: Pick<LogEntry, 'ts'>): number {
  const t = Date.parse(entry.ts)
  return Number.isNaN(t) ? 0 : t
}

/** Strict per-agent filter. Unattributed lines are never folded into an agent. */
export function agentLogs(logs: LogEntry[], agentId: string): LogEntry[] {
  return logs.filter((l) => l.agentId === agentId)
}

function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * The WebSocket snapshot describes a single agent process. It carries its
 * `configPath`, so attribute it to the managed agent with the same config
 * instead of showing one agent's positions on every card.
 */
export function snapshotFor(agent: ManagedAgent, snapshot: StateSnapshot | null): StateSnapshot | null {
  if (!snapshot?.configPath) return null
  return normPath(snapshot.configPath) === normPath(agent.configPath) ? snapshot : null
}

export function lastHeartbeat(entries: LogEntry[]): number | null {
  const last = entries[entries.length - 1]
  return last ? tsMs(last) : null
}

type Kind = 'evaluate' | 'rebalance' | 'settled'

function classify(e: LogEntry): Kind | null {
  const c = e.category.toLowerCase()
  if (c.includes('error') || c.includes('warn')) return null
  if (c === 'screening') return 'evaluate'
  if (c === 'cron' && /^(Starting management cycle|Triggering screening cycle|Post-management)/.test(e.message)) {
    return 'evaluate'
  }
  if (c === 'deploy') return /^SUCCESS/.test(e.message) ? 'settled' : 'rebalance'
  if (c === 'close') return /success|complete/i.test(e.message) ? 'settled' : 'rebalance'
  return null
}

/**
 * HEURISTIC. The daemon does not publish a phase, so this is inferred from the
 * agent's own recent log categories plus the snapshot `busy` flag when known.
 * The UI labels the result as inferred. A daemon-side `phase` field would
 * replace this function outright.
 */
export function inferPhase(entries: LogEntry[], busy: boolean | null, now: number): Phase {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (!e) continue
    const kind = classify(e)
    if (!kind) continue
    const age = now - tsMs(e)
    if (kind === 'settled') return age <= SETTLED_MS ? 'Settled' : 'Idle'
    if (busy === false) return 'Idle'
    if (busy === true || age <= IN_FLIGHT_MS) return kind === 'rebalance' ? 'Rebalancing' : 'Evaluating'
    return 'Idle'
  }
  return busy ? 'Evaluating' : 'Idle'
}

export function fleetStatus(
  agent: ManagedAgent,
  entries: LogEntry[],
  hasTelemetry: boolean,
  phase: Phase,
  now: number,
): FleetStatus {
  if (!agent.running) return 'stopped'
  if (entries.some((l) => logSeverity(l) === 'error' && now - tsMs(l) <= ERROR_MS)) return 'error'
  if (!hasTelemetry) return 'running' // process is up, but no telemetry reaches this console
  return phase === 'Evaluating' || phase === 'Rebalancing' ? 'running' : 'idle'
}

export function lastByCategory(entries: LogEntry[], category: string): LogEntry | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e && e.category === category) return e
  }
  return null
}

export function relTime(ms: number | null, now: number): string {
  if (ms === null) return '—'
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function shortAddr(a: string): string {
  return a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a
}
