import type { LogEntry, ManagedAgent, PositionSummary, StateSnapshot } from './ipc'

export type AgentPhase = 'idle' | 'evaluating' | 'rebalancing' | 'settled'
export type FleetStatus = 'running' | 'stopped' | 'idle' | 'error' | AgentPhase
export type LogSeverity = 'info' | 'warn' | 'error'

const PHASES: AgentPhase[] = ['idle', 'evaluating', 'rebalancing', 'settled']

const ERROR_RE = /\b(error|fail(?:ed|ure)?|exception|crash)\b/i
const WARN_RE = /\b(warn(?:ing)?|degraded|retry|timeout)\b/i
const EVAL_RE = /\b(screen|evaluat|candidat|opportunit)/i
const REBAL_RE = /\b(manag|rebalanc|deploy|close|swap|rebalance|settle|exit)/i

export function logSeverity(entry: LogEntry): LogSeverity {
  const hay = `${entry.category} ${entry.message}`
  if (ERROR_RE.test(hay) || /_error$|_fail$|safety_block/i.test(entry.category)) return 'error'
  if (WARN_RE.test(hay) || /_warn$/i.test(entry.category)) return 'warn'
  return 'info'
}

/** Per-agent log lines only — never fold empty/default/global agentId into every card. */
export function agentLogs(logs: LogEntry[], agentId: string): LogEntry[] {
  return logs.filter((l) => l.agentId === agentId)
}

export function lastHeartbeat(logs: LogEntry[], agentId: string): string | null {
  const own = agentLogs(logs, agentId)
  for (let i = own.length - 1; i >= 0; i--) {
    const entry = own[i]
    if (entry?.ts) return entry.ts
  }
  return null
}

/**
 * Heuristic only: StateSnapshot has no agent-loop phase field, so we derive
 * Idle → Evaluating → Rebalancing → Settled from `busy`, open positions, and
 * recent per-agent log text. Prefer a daemon-side phase when one exists.
 */
export function inferPhase(agent: ManagedAgent, snapshot: StateSnapshot | null, logs: LogEntry[]): AgentPhase {
  if (!agent.running) return 'idle'
  const recent = agentLogs(logs, agent.id).slice(-40)
  const recentText = recent.map((l) => `${l.category} ${l.message}`).join('\n')

  if (snapshot?.busy) {
    if (EVAL_RE.test(recentText) && !REBAL_RE.test(recentText.slice(-200))) return 'evaluating'
    if (REBAL_RE.test(recentText)) return 'rebalancing'
    return 'evaluating'
  }

  if ((snapshot?.positions?.length ?? 0) > 0) return 'settled'
  return 'idle'
}

export function fleetStatus(agent: ManagedAgent, phase: AgentPhase, logs: LogEntry[]): FleetStatus {
  if (!agent.running) return 'stopped'
  const recent = agentLogs(logs, agent.id).slice(-20)
  if (recent.some((l) => logSeverity(l) === 'error')) return 'error'
  if (phase === 'idle') return 'idle'
  return phase
}

export function phaseIndex(phase: AgentPhase): number {
  return PHASES.indexOf(phase)
}

export function pipelinePhases(): AgentPhase[] {
  return [...PHASES]
}

export function formatUptime(fromIso: string | null, running: boolean): string {
  if (!running || !fromIso) return '—'
  const start = new Date(fromIso).getTime()
  if (Number.isNaN(start)) return '—'
  const sec = Math.max(0, Math.floor((Date.now() - start) / 1000))
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return `${h}h ${m}m`
}

export function formatAgo(iso: string | null): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (sec < 5) return 'just now'
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  return `${Math.floor(sec / 3600)}h ago`
}

export function shortAddr(addr: string | null | undefined, n = 6): string {
  if (!addr) return '—'
  if (addr.length <= n * 2 + 1) return addr
  return `${addr.slice(0, n)}…${addr.slice(-n)}`
}

export function primaryPool(positions: PositionSummary[]): string {
  const first = positions[0]
  if (!first) return '—'
  return first.tokenSymbol || shortAddr(first.poolAddress)
}

export function assetSplit(positions: PositionSummary[]): { label: string; value: number; pct: number }[] {
  const total = positions.reduce((s, p) => s + Math.max(0, Number(p.valueUsd ?? 0)), 0)
  if (total <= 0) {
    return positions.map((p) => ({
      label: p.tokenSymbol || shortAddr(p.poolAddress, 4),
      value: 0,
      pct: positions.length ? 100 / positions.length : 0,
    }))
  }
  return positions.map((p) => {
    const value = Math.max(0, Number(p.valueUsd ?? 0))
    return {
      label: p.tokenSymbol || shortAddr(p.poolAddress, 4),
      value,
      pct: (value / total) * 100,
    }
  })
}

export function lastDecision(
  logs: LogEntry[],
  agentId: string,
): { decision: string; tool: string; confidence: string } {
  const own = agentLogs(logs, agentId)
  let tool = '—'
  let decision = '—'
  let confidence = '—'

  for (let i = own.length - 1; i >= 0; i--) {
    const l = own[i]
    if (!l) continue
    const meta = l.metadata ?? {}
    if (tool === '—' && (l.category === 'tool_start' || l.category === 'tool_end' || /tool/i.test(l.category))) {
      tool = String(meta.tool ?? meta.name ?? l.message.split(/\s+/)[0] ?? '—')
    }
    if (decision === '—' && (meta.decision || meta.reason || /decision|chose|selected|deploy|close/i.test(l.message))) {
      decision = String(meta.decision ?? meta.reason ?? l.message).slice(0, 120)
    }
    if (confidence === '—' && (meta.confidence != null || meta.score != null)) {
      const c = Number(meta.confidence ?? meta.score)
      confidence = Number.isFinite(c)
        ? c <= 1
          ? `${(c * 100).toFixed(0)}%`
          : c.toFixed(2)
        : String(meta.confidence ?? meta.score)
    }
    if (tool !== '—' && decision !== '—') break
  }
  return { decision, tool, confidence }
}

/** Flat key→string map for strategy preview diffs. */
export function flattenStrategy(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'error' || k === 'available' || k === 'rawText' || k === 'raw') continue
    const key = prefix ? `${prefix}.${k}` : k
    if (v == null) out[key] = 'null'
    else if (typeof v === 'object' && !Array.isArray(v))
      Object.assign(out, flattenStrategy(v as Record<string, unknown>, key))
    else out[key] = Array.isArray(v) ? JSON.stringify(v) : String(v)
  }
  return out
}

export type DiffLine = { kind: 'same' | 'add' | 'del'; text: string }

export function diffMaps(from: Record<string, string>, to: Record<string, string>): DiffLine[] {
  const keys = Array.from(new Set([...Object.keys(from), ...Object.keys(to)])).sort()
  const lines: DiffLine[] = []
  for (const k of keys) {
    const a = from[k]
    const b = to[k]
    if (a === b) lines.push({ kind: 'same', text: `  ${k}: ${a ?? ''}` })
    else {
      if (a !== undefined) lines.push({ kind: 'del', text: `- ${k}: ${a}` })
      if (b !== undefined) lines.push({ kind: 'add', text: `+ ${k}: ${b}` })
    }
  }
  return lines
}
