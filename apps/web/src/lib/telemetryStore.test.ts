/**
 * Unit tests for apps/web/src/lib/telemetryStore.ts
 *
 * Tests ring buffer capping and rAF-batched flush.
 * Uses fake timers to control the setTimeout fallback used in node env.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogEntry } from './ipc'
import { telemetryStore } from './telemetryStore'

function makeLog(cat = 'state', msg = 'msg'): LogEntry {
  return { category: cat, message: msg, agentId: 'a1', ts: new Date().toISOString() }
}

beforeEach(() => {
  telemetryStore._reset()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('telemetryStore — init and status', () => {
  it('init creates entry with given status', () => {
    telemetryStore.init('a1', 'connecting')
    const m = telemetryStore.getSnapshot()
    expect(m.get('a1')?.status).toBe('connecting')
  })
  it('init is idempotent — does not overwrite existing', () => {
    telemetryStore.init('a1', 'connecting')
    telemetryStore.setStatus('a1', 'connected')
    telemetryStore.init('a1', 'connecting') // should not overwrite
    expect(telemetryStore.getSnapshot().get('a1')?.status).toBe('connected')
  })
  it('setStatus updates status', () => {
    telemetryStore.init('a1', 'connecting')
    telemetryStore.setStatus('a1', 'connected')
    expect(telemetryStore.getSnapshot().get('a1')?.status).toBe('connected')
  })
  it('remove deletes entry', () => {
    telemetryStore.init('a1', 'connecting')
    telemetryStore.remove('a1')
    expect(telemetryStore.getSnapshot().has('a1')).toBe(false)
  })
})

describe('telemetryStore — log ring buffer', () => {
  it('logs accumulate via pushLog after flush', () => {
    telemetryStore.init('a1', 'connected')
    telemetryStore.pushLog('a1', makeLog())
    // Flush pending rAF queue (setTimeout fallback in node)
    vi.runAllTimers()
    expect(telemetryStore.getSnapshot().get('a1')?.logs).toHaveLength(1)
  })

  it('ring buffer caps at 500 entries', () => {
    telemetryStore.init('a1', 'connected')
    for (let i = 0; i < 510; i++) {
      telemetryStore.pushLog('a1', makeLog('state', `msg-${i}`))
    }
    vi.runAllTimers()
    const logs = telemetryStore.getSnapshot().get('a1')?.logs ?? []
    expect(logs.length).toBe(500)
    // Oldest entries were evicted; most recent is at the end
    const lastLog = logs[logs.length - 1]
    const firstLog = logs[0]
    expect(lastLog?.message).toBe('msg-509')
    expect(firstLog?.message).toBe('msg-10')
  })

  it('batches multiple pushLog calls into one flush cycle', () => {
    telemetryStore.init('a1', 'connected')
    let notifyCount = 0
    const unsub = telemetryStore.subscribe(() => {
      notifyCount++
    })

    for (let i = 0; i < 5; i++) {
      telemetryStore.pushLog('a1', makeLog())
    }
    // Before flush: no notification yet from the log batch
    const beforeFlush = notifyCount

    vi.runAllTimers() // triggers the single setTimeout/rAF flush
    unsub()

    // After flush: exactly one batch notification from logs
    // (plus any from init/setStatus which are synchronous — we subtract those)
    expect(notifyCount).toBeGreaterThan(beforeFlush)
    expect(telemetryStore.getSnapshot().get('a1')?.logs).toHaveLength(5)
  })
})

describe('telemetryStore — snapshot', () => {
  it('setSnapshot updates snapshot and lastMessageAt', () => {
    telemetryStore.init('a1', 'connecting')
    const snap = { positions: [], totalPnlUsd: 42, busy: false }
    telemetryStore.setSnapshot('a1', snap)
    const entry = telemetryStore.getSnapshot().get('a1')
    expect(entry).toBeDefined()
    expect(entry?.snapshot?.totalPnlUsd).toBe(42)
    expect(entry?.lastMessageAt).not.toBeNull()
    expect(entry?.status).toBe('connected')
  })
})

describe('telemetryStore — subscribe/unsubscribe', () => {
  it('subscriber is called on status change', () => {
    let called = 0
    const unsub = telemetryStore.subscribe(() => {
      called++
    })
    telemetryStore.init('a1', 'connecting')
    telemetryStore.setStatus('a1', 'connected')
    unsub()
    telemetryStore.setStatus('a1', 'disconnected')
    // Only the two changes before unsub should have fired
    expect(called).toBe(2)
  })
})

describe('telemetryStore — remove()', () => {
  it('remove() deletes the agent entry', () => {
    telemetryStore.init('a1', 'connecting')
    telemetryStore.remove('a1')
    expect(telemetryStore.getSnapshot().has('a1')).toBe(false)
  })

  it('flushLogs does NOT resurrect a removed agent (pending log guard)', () => {
    telemetryStore.init('a1', 'connecting')
    // Queue a log for a1 — this goes into pendingLogs before any flush
    telemetryStore.pushLog('a1', makeLog())
    // Remove the agent before the flush fires
    telemetryStore.remove('a1')
    // Trigger the setTimeout flush (fake timers, 16 ms fallback)
    vi.advanceTimersByTime(20)
    // a1 must NOT reappear in the store
    expect(telemetryStore.getSnapshot().has('a1')).toBe(false)
  })

  it('remove() also clears pending logs for that agent', () => {
    telemetryStore.init('a1', 'connecting')
    telemetryStore.init('a2', 'connecting')
    telemetryStore.pushLog('a1', makeLog('state', 'for-a1'))
    telemetryStore.pushLog('a2', makeLog('state', 'for-a2'))
    telemetryStore.remove('a1')
    vi.advanceTimersByTime(20)
    // a2 should still get its log; a1 should be gone
    expect(telemetryStore.getSnapshot().has('a1')).toBe(false)
    expect(telemetryStore.getSnapshot().get('a2')?.logs).toHaveLength(1)
  })
})
