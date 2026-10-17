import type { Decision, LogEntry, LogSeverity, LoopStage } from './ipc'

/**
 * Pure presentation logic for the Agent Visualizer.
 * Kept free of React and DOM so all loop-stage derivation, diffing,
 * formatting, and metrics calculation can be unit-tested directly.
 */

const STAGE_CATEGORIES: Record<LoopStage, string[]> = {
  Idle: ['agent_loop_end'],
  Evaluating: ['agent_loop_start', 'anti_hallucination_reject'],
  Rebalancing: ['tool_start', 'tool_finish', 'tool_blocked'],
  Settled: ['agent_loop_end'],
}

const ACTIVE_CATEGORIES = new Set<string>([
  ...STAGE_CATEGORIES.Evaluating,
  ...STAGE_CATEGORIES.Rebalancing,
  'agent_loop_error',
])

/**
 * Derive the current pipeline stage from the tail of the log stream.
 * Scans backwards for the most recent category that maps onto a stage.
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

/** True when the most recent log entries indicate a live, ongoing loop iteration. */
export function isLoopActive(logs: readonly LogEntry[]): boolean {
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const category = logs[i]?.category
    if (!category) continue
    if (category === 'agent_loop_end' || category === 'agent_loop_error') {
      return false
    }
    if (ACTIVE_CATEGORIES.has(category)) {
      return true
    }
  }
  return false
}

/** Classify a log entry's severity from its category or message. */
export function logSeverity(entry: LogEntry): LogSeverity {
  const category = (entry.category ?? '').toLowerCase()
  const msg = (entry.message ?? '').toLowerCase()
  if (
    category === 'agent_loop_error' ||
    category === 'tool_blocked' ||
    category.includes('error') ||
    msg.includes('error') ||
    msg.includes('failed')
  ) {
    return 'error'
  }
  if (category === 'anti_hallucination_reject' || category.includes('warn') || msg.includes('warning')) {
    return 'warn'
  }
  return 'info'
}

/** Shorten a public key or address: `Ab12…Wx90`. */
export function shortenAddress(value: string | null | undefined, head = 4, tail = 4): string {
  if (!value) return '—'
  if (value.length <= head + tail + 1) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

/** Format relative age of an ISO timestamp, e.g. `3m ago`. */
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

/** Human-readable label for a decision entry. */
export function decisionLabel(decision: Decision): string {
  const pool = decision.pool_name ?? decision.pool
  const target = pool ? shortenAddress(pool, 4, 4) : 'active pool'
  return `[${decision.actor}] ${decision.type.toUpperCase()} ${target}`
}

/** Render a decision's numeric/string metrics as compact key=value items. */
export function formatMetrics(metrics: Record<string, unknown> | undefined): string[] {
  if (!metrics || typeof metrics !== 'object') return []
  return Object.entries(metrics)
    .filter(([, value]) => typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean')
    .map(([key, value]) => `${key}=${String(value)}`)
}

export interface LastToolSummary {
  name: string
  timestamp: string
  status: 'running' | 'completed' | 'failed'
}

/** Extract the last tool invocation and status from the log stream. */
export function extractLastTool(logs: readonly LogEntry[]): LastToolSummary | null {
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const entry = logs[i]
    if (!entry) continue
    const cat = entry.category
    if (cat === 'tool_start' || cat === 'tool_finish' || cat === 'tool_blocked') {
      const match = entry.message.match(/tool\s+([a-zA-Z0-9_-]+)/i)
      const name = match?.[1] ? match[1] : ((entry.metadata?.toolName as string | undefined) ?? 'tool')
      const status: LastToolSummary['status'] =
        cat === 'tool_blocked' ? 'failed' : cat === 'tool_finish' ? 'completed' : 'running'
      return {
        name,
        timestamp: entry.ts,
        status,
      }
    }
  }
  return null
}

/** Extract all unique categories from the log stream for quick filtering tags. */
export function extractCategories(logs: readonly LogEntry[]): string[] {
  const set = new Set<string>()
  for (const log of logs) {
    if (log.category) set.add(log.category)
  }
  return Array.from(set).sort()
}

export interface StrategyDiffEntry {
  key: string
  from: unknown
  to: unknown
  status: 'added' | 'removed' | 'changed' | 'unchanged'
}

/**
 * Compare two strategy parameter maps to generate an exact diff
 * before switching strategies on an agent.
 */
export function computeStrategyDiff(
  current: Record<string, unknown> | null | undefined,
  target: Record<string, unknown> | null | undefined,
): StrategyDiffEntry[] {
  const currentMap = current ?? {}
  const targetMap = target ?? {}
  const allKeys = Array.from(new Set([...Object.keys(currentMap), ...Object.keys(targetMap)])).sort()

  const entries: StrategyDiffEntry[] = []
  for (const key of allKeys) {
    const hasCurrent = Object.hasOwn(currentMap, key)
    const hasTarget = Object.hasOwn(targetMap, key)

    if (!hasCurrent && hasTarget) {
      entries.push({ key, from: undefined, to: targetMap[key], status: 'added' })
    } else if (hasCurrent && !hasTarget) {
      entries.push({ key, from: currentMap[key], to: undefined, status: 'removed' })
    } else {
      const fromVal = currentMap[key]
      const toVal = targetMap[key]
      const isSame = JSON.stringify(fromVal) === JSON.stringify(toVal)
      entries.push({
        key,
        from: fromVal,
        to: toVal,
        status: isSame ? 'unchanged' : 'changed',
      })
    }
  }
  return entries
}
