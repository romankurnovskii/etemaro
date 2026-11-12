import type { LogEntry } from './ipc'

export type Severity = 'info' | 'warn' | 'error'

export const SEVERITIES: readonly Severity[] = ['info', 'warn', 'error']

/** A received log entry plus a monotonically increasing receive index. */
export interface LogRecord {
  seq: number
  entry: LogEntry
}

/** Log records bucketed strictly by the entry's own `agentId`. */
export type LogStore = Readonly<Record<string, readonly LogRecord[]>>

export const MAX_LOGS_PER_AGENT = 500

/**
 * Severity from a log category. Mirrors the daemon logger
 * (packages/core/src/shared/logger.ts `log()`): explicit `error`/`warn`
 * categories, otherwise substring match; everything else (incl. debug) is info.
 */
export function severityOf(category: string): Severity {
  const c = String(category ?? '').toLowerCase()
  if (c.includes('error')) return 'error'
  if (c.includes('warn')) return 'warn'
  return 'info'
}

/** Stable React key: agent + receive index, so identical lines never collide. */
export function logKey(record: LogRecord): string {
  return `${record.entry.agentId}:${record.seq}`
}

/** Append one record to its agent's bucket (immutable, bounded per agent). */
export function appendLog(store: LogStore, record: LogRecord, maxPerAgent = MAX_LOGS_PER_AGENT): LogStore {
  const agentId = record.entry.agentId
  const prev = store[agentId] ?? []
  const next = prev.length >= maxPerAgent ? [...prev.slice(prev.length - maxPerAgent + 1), record] : [...prev, record]
  return { ...store, [agentId]: next }
}

/** Logs attributed to one agent — exact `agentId` match only. */
export function logsForAgent(store: LogStore, agentId: string): readonly LogRecord[] {
  return store[agentId] ?? []
}

/** All agents' logs in receive order. */
export function mergedLogs(store: LogStore): LogRecord[] {
  return Object.values(store)
    .flat()
    .sort((a, b) => a.seq - b.seq)
}
