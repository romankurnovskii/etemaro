/**
 * Unit tests for apps/web/src/lib/socket.ts
 *
 * Tests socket backoff/jitter and 1008 stop (fake WebSocket + fake timers).
 *
 * Strategy: set globalThis.WebSocket to FakeWs BEFORE importing DaemonSocket
 * (via top-level await dynamic import), so the constructor closure captures our fake.
 * Uses vitest fake timers for backoff/retry assertions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Minimal fake WebSocket ───────────────────────────────────────────────────
const instances: FakeWs[] = []

class FakeWs {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  url: string
  readyState: number = FakeWs.CONNECTING
  onopen: (() => void) | null = null
  onclose: ((e: { code: number; reason: string }) => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  sentMessages: string[] = []

  constructor(url: string) {
    this.url = url
    instances.push(this)
  }

  send(data: string) { this.sentMessages.push(data) }

  close(code = 1000, reason = '') {
    this.readyState = FakeWs.CLOSED
    this.onclose?.({ code, reason })
  }

  triggerOpen() {
    this.readyState = FakeWs.OPEN
    this.onopen?.()
  }

  triggerClose(code: number, reason = '') {
    this.readyState = FakeWs.CLOSED
    this.onclose?.({ code, reason })
  }
}

// Install fake globally BEFORE dynamic import of socket module
;(globalThis as Record<string, unknown>).WebSocket = FakeWs

// Top-level await so FakeWs is in global scope when DaemonSocket is evaluated
const { DaemonSocket } = await import('./socket')

function latest(): FakeWs {
  const ws = instances[instances.length - 1]
  if (!ws) throw new Error('No WebSocket instances — did DaemonSocket.connect() get called?')
  return ws
}

beforeEach(() => {
  instances.length = 0
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

// ─── Auth handshake ───────────────────────────────────────────────────────────
describe('DaemonSocket — auth handshake', () => {
  it('sends AUTH message on open', () => {
    const sock = new DaemonSocket('ws://localhost:8080', 'tok-abc')
    sock.connect()
    latest().triggerOpen()
    sock.dispose()
    const types = latest().sentMessages.map((s) => {
      try { return (JSON.parse(s) as { type: string }).type } catch { return null }
    })
    expect(types).toContain('auth')
  })

  it('emits status=connected on open', () => {
    const statuses: string[] = []
    const sock = new DaemonSocket('ws://localhost:8080', 'tok-abc')
    sock.on('status', (s) => statuses.push(s))
    sock.connect()
    latest().triggerOpen()
    sock.dispose()
    expect(statuses).toContain('connected')
  })

  it('emits status=disconnected after non-1008 close', () => {
    const statuses: string[] = []
    const sock = new DaemonSocket('ws://localhost:8080', 'tok-abc')
    sock.on('status', (s) => statuses.push(s))
    sock.connect()
    latest().triggerOpen()
    latest().triggerClose(1006)
    sock.dispose()
    expect(statuses).toContain('disconnected')
  })
})

// ─── 1008 AUTH_FAILED ─────────────────────────────────────────────────────────
describe('DaemonSocket — 1008 stop', () => {
  it('emits auth-failed event on 1008 close', () => {
    const authFailed: boolean[] = []
    const sock = new DaemonSocket('ws://localhost:8080', 'bad-token')
    sock.on('auth-failed', () => authFailed.push(true))
    sock.connect()
    latest().triggerOpen()
    latest().triggerClose(1008)
    sock.dispose()
    expect(authFailed).toHaveLength(1)
  })

  it('emits status=auth-failed on 1008', () => {
    const statuses: string[] = []
    const sock = new DaemonSocket('ws://localhost:8080', 'bad-token')
    sock.on('status', (s) => statuses.push(s))
    sock.connect()
    latest().triggerOpen()
    latest().triggerClose(1008)
    sock.dispose()
    expect(statuses).toContain('auth-failed')
  })

  it('does NOT reconnect after 1008 (no new WebSocket after 30 s)', () => {
    const sock = new DaemonSocket('ws://localhost:8080', 'bad-token')
    sock.connect()
    latest().triggerOpen()
    latest().triggerClose(1008)
    vi.advanceTimersByTime(30_000)
    sock.dispose()
    // Only the original WebSocket — no retry
    expect(instances).toHaveLength(1)
  })

  it('does NOT emit auth-failed on normal 1000 close', () => {
    const authFailed: boolean[] = []
    const sock = new DaemonSocket('ws://localhost:8080', 'tok-abc')
    sock.on('auth-failed', () => authFailed.push(true))
    sock.connect()
    latest().triggerOpen()
    latest().triggerClose(1000)
    sock.dispose()
    expect(authFailed).toHaveLength(0)
  })
})

// ─── Exponential backoff ─────────────────────────────────────────────────────
describe('DaemonSocket — exponential backoff', () => {
  it('reconnects after ~800 ms on transient 1006 close', () => {
    const sock = new DaemonSocket('ws://localhost:8080', 'tok-abc')
    sock.connect()
    latest().triggerOpen()
    latest().triggerClose(1006)
    const before = instances.length
    vi.advanceTimersByTime(2000) // Past 800 ms min + 25% jitter
    sock.dispose()
    expect(instances.length).toBeGreaterThan(before)
  })

  it('dispose() cancels pending retry — no new WS created', () => {
    const sock = new DaemonSocket('ws://localhost:8080', 'tok-abc')
    sock.connect()
    latest().triggerOpen()
    latest().triggerClose(1006)
    sock.dispose() // Dispose before retry fires
    const before = instances.length
    vi.advanceTimersByTime(10_000)
    expect(instances.length).toBe(before)
  })
})

// ─── dispose() idempotency ────────────────────────────────────────────────────
describe('DaemonSocket — dispose() idempotency', () => {
  it('calling dispose() twice does not throw', () => {
    const sock = new DaemonSocket('ws://localhost:8080', 'tok-abc')
    expect(() => { sock.dispose(); sock.dispose() }).not.toThrow()
  })

  it('connect() after dispose() is a no-op — no WS created', () => {
    const sock = new DaemonSocket('ws://localhost:8080', 'tok-abc')
    sock.dispose()
    sock.connect()
    vi.advanceTimersByTime(5000)
    expect(instances).toHaveLength(0)
  })
})
