import { describe, expect, it } from 'vitest'
import type { LogEntry } from './ipc'
import { appendLog, type LogRecord, type LogStore, logKey, logsForAgent, mergedLogs, severityOf } from './logs'

const entry = (agentId: string, message: string, category = 'cron'): LogEntry => ({
  agentId,
  message,
  category,
  ts: '2026-10-03T12:00:00.000Z',
})

function ingest(items: LogEntry[], max?: number): LogStore {
  return items.reduce<LogStore>((store, e, seq) => appendLog(store, { seq, entry: e }, max), {})
}

describe('severityOf', () => {
  it('maps categories like the daemon logger', () => {
    expect(severityOf('error')).toBe('error')
    expect(severityOf('cron_error')).toBe('error')
    expect(severityOf('tx_error')).toBe('error')
    expect(severityOf('warn')).toBe('warn')
    expect(severityOf('telegram_warn')).toBe('warn')
    expect(severityOf('cron')).toBe('info')
    expect(severityOf('debug')).toBe('info')
    expect(severityOf('tool_start')).toBe('info')
  })

  it('is case-insensitive and tolerates empty input', () => {
    expect(severityOf('IPC_ERROR')).toBe('error')
    expect(severityOf('')).toBe('info')
  })
})

describe('per-agent attribution', () => {
  it('buckets strictly by agentId and never leaks across agents', () => {
    const store = ingest([entry('a', 'one'), entry('b', 'two'), entry('agent-default', 'global', 'error')])
    expect(logsForAgent(store, 'a').map((r) => r.entry.message)).toEqual(['one'])
    expect(logsForAgent(store, 'b').map((r) => r.entry.message)).toEqual(['two'])
    expect(logsForAgent(store, 'c')).toEqual([])
  })

  it('does not attribute by prefix or substring', () => {
    const store = ingest([entry('alpha-1', 'x')])
    expect(logsForAgent(store, 'alpha')).toEqual([])
  })

  it('bounds each agent separately so a chatty agent cannot evict others', () => {
    const items = [entry('quiet', 'q'), ...Array.from({ length: 10 }, (_, i) => entry('chatty', `c${i}`))]
    const store = ingest(items, 3)
    expect(logsForAgent(store, 'quiet')).toHaveLength(1)
    expect(logsForAgent(store, 'chatty').map((r) => r.entry.message)).toEqual(['c7', 'c8', 'c9'])
  })

  it('does not mutate the previous store', () => {
    const before = ingest([entry('a', 'one')])
    const after = appendLog(before, { seq: 9, entry: entry('a', 'two') })
    expect(logsForAgent(before, 'a')).toHaveLength(1)
    expect(logsForAgent(after, 'a')).toHaveLength(2)
  })

  it('merges all agents in receive order', () => {
    const store = ingest([entry('a', '1'), entry('b', '2'), entry('a', '3')])
    expect(mergedLogs(store).map((r) => r.entry.message)).toEqual(['1', '2', '3'])
  })
})

describe('logKey', () => {
  it('keeps identical lines from different agents distinct', () => {
    const r1: LogRecord = { seq: 1, entry: entry('a', 'same') }
    const r2: LogRecord = { seq: 2, entry: entry('b', 'same') }
    const r3: LogRecord = { seq: 3, entry: entry('a', 'same') }
    const keys = [r1, r2, r3].map(logKey)
    expect(new Set(keys).size).toBe(3)
    expect(keys[0]).toContain('a')
    expect(keys[1]).toContain('b')
  })
})
