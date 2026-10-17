import type { Decision, LogEntry, LoopStage } from './ipc'

/**
 * Pure presentation logic for the Agent Visualizer.
 *
 * Kept free of React and DOM so the loop-stage derivation, decision
 * formatting and severity classification can be unit-tested directly.
 */

/**
 * Log categories emitted by the daemon's agent loop, mapped onto the four
 * pipeline stages shown in the UI (Idle → Evaluating → Rebalancing → Settled).
 *
 * Categories observed in packages/core/src/application/*.
 */
const STAGE_CATEGORIES: Record<LoopStage, string[]> = {
  Idle: ['agent_loop_end'],
  Evaluating: ['agent_loop_start', 'anti_hallucination_reject'],
  Rebalancing: ['tool_start', 'tool_finish', 'tool_blocked'],
  Settled: ['agent_loop_end'],
}

/** All categories that indicate an active (non-idle) loop iteration. */
const ACTIVE_CATEGORIES = new Set<string>([
  ...STAGE_CATEGORIES.Evaluating,
  ...STAGE_CATEGORIES.Rebalancing,
  'agent_loop_error',
])

/**
 * Derive the current pipeline stage from the tail of the log stream.
 *
 * Scans backwards for the most recent category that maps onto a stage, so a
 * trailing `tool_finish` does not leave the agent looking mid-action once the
 * loop has already closed.
 *
 * - `agent_loop_error` parks the agent in Idle until the next iteration.
 * - `agent_loop_end` settles the iteration.
 * - A tool call means the agent is mid-action (Rebalancing).
 * - A loop start with no tool call yet means it is still Evaluating.
 */
export function deriveLoopStage(logs: readonly LogEntry[]): LoopStage {
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const category = logs[i]?.category
    if (!category) continue
    if (category === 'agent_loop_error') return 'Idle'
    if (category === 'agent_loop_end') return 'Settled'
    if (category === 'tool_start' || category === 'tool_finish' || category === 'tool_blocked') {
      return 'Rebalancing'
    }
    if (category === 'agent_loop_start' || category === 'anti_hallucination_reject') {
      return 'Evaluating'
    }
  }
  return 'Idle'
}

/** True when the most recent log entries show a live loop iteration. */
export function isLoopActive(logs: readonly LogEntry[]): boolean {
  const latest = logs[logs.length - 1]
  if (!latest) return false
  return ACTIVE_CATEGORIES.has(latest.category)
}

/** Classify a log entry's severity from its category. */
export function logSeverity(entry: LogEntry): 'info' | 'warn' | 'error' {
  const category = entry.category ?? ''
  if (category === 'agent_loop_error' || category === 'tool_blocked') return 'error'
  if (category === 'anti_hallucination_reject') return 'warn'
  return 'info'
}

/** Shorten a Solana-style public key for display: `Ab12…Wx90`. */
export function shortenAddress(value: string | null | undefined, head = 4, tail = 4): string {
  if (!value) return '—'
  if (value.length <= head + tail + 1) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

/** Human label for a decision type. */
export function decisionLabel(decision: Decision): string {
  const pool = decision.pool_name ?? decision.pool
  const target = pool ? shortenAddress(pool, 4, 4) : 'unknown pool'
  return `[${decision.actor}] ${decision.type.toUpperCase()} ${target}`
}

/** Relative age of an ISO timestamp, e.g. `3m ago`. */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—'
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return '—'
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 45) return 'just now'
  if (seconds < 90) return '1m ago'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** Render a decision's numeric metrics as compact `key=value` pairs. */
export function formatMetrics(metrics: Record<string, unknown> | undefined): string[] {
  if (!metrics || typeof metrics !== 'object') return []
  return Object.entries(metrics)
    .filter(([, value]) => typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean')
    .map(([key, value]) => `${key}=${String(value)}`)
}
