import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type IpcMessage, IpcMessageType } from '../lib/ipc'
import { acceptsAgentMessage, openAgentStream } from './useAgentConnection'

class FakeSocket {
  static OPEN = 1
  static instances: FakeSocket[] = []
  readyState = 0
  onopen?: () => void
  onmessage?: (e: { data: string }) => void
  onclose?: (e: { code: number }) => void
  onerror?: () => void
  send = vi.fn()
  close = vi.fn()
  constructor(public url: string) {
    FakeSocket.instances.push(this)
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  receive(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }
  disconnect(code = 1006) {
    this.readyState = 3
    this.onclose?.({ code })
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.instances = []
  vi.stubGlobal('WebSocket', FakeSocket)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const message = (type: string, payload: unknown): IpcMessage => ({ id: 'test', type, payload, timestamp: 1 })

describe('agent stream lifecycle', () => {
  it('authenticates before subscribing and targets its own endpoint', () => {
    const status = vi.fn()
    const stream = openAgentStream('ws://127.0.0.1:9001/', 'test-token', { status, message: vi.fn() })
    const ws = FakeSocket.instances[0]!
    ws.open()
    expect(ws.url).toBe('ws://127.0.0.1:9001/')
    expect(ws.send.mock.calls.map(([raw]) => JSON.parse(raw).type)).toEqual([
      'auth',
      'subscribe:logs',
      'subscribe:state',
    ])
    expect(status.mock.calls.flat()).toEqual(['connecting', 'connected'])
    stream.close()
  })
  it('stops retries after an authentication/policy rejection', () => {
    const status = vi.fn()
    const stream = openAgentStream('ws://test/', '', { status, message: vi.fn() })
    FakeSocket.instances[0]!.disconnect(1008)
    vi.advanceTimersByTime(60000)
    expect(FakeSocket.instances).toHaveLength(1)
    expect(status).toHaveBeenLastCalledWith('rejected')
    expect(stream.sendChat('hello')).toBe(false)
    stream.close()
  })
  it('backs off repeated failures and cancels a scheduled reconnect on cleanup', () => {
    const stream = openAgentStream('ws://test/', '', { status: vi.fn(), message: vi.fn() })
    FakeSocket.instances[0]!.disconnect()
    vi.advanceTimersByTime(799)
    expect(FakeSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    FakeSocket.instances[1]!.open()
    FakeSocket.instances[1]!.disconnect()
    vi.advanceTimersByTime(1279)
    expect(FakeSocket.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.instances).toHaveLength(3)
    FakeSocket.instances[2]!.disconnect()
    stream.close()
    vi.advanceTimersByTime(60000)
    expect(FakeSocket.instances).toHaveLength(3)
  })
  it('ignores messages and open callbacks from a disposed endpoint', () => {
    const receive = vi.fn()
    const status = vi.fn()
    const stream = openAgentStream('ws://old/', '', { status, message: receive })
    const ws = FakeSocket.instances[0]!
    stream.close()
    ws.open()
    ws.receive(message('ack', {}))
    ws.disconnect()
    expect(receive).not.toHaveBeenCalled()
    expect(ws.send).not.toHaveBeenCalled()
    expect(status).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('ignores malformed envelopes and resumes after a valid message', () => {
    const receive = vi.fn()
    const stream = openAgentStream('ws://test/', '', { status: vi.fn(), message: receive })
    const ws = FakeSocket.instances[0]!
    ws.onmessage?.({ data: '{broken' })
    ws.receive(null)
    ws.receive([])
    ws.receive({ type: 5 })
    ws.receive(message('ack', {}))
    expect(receive).toHaveBeenCalledTimes(1)
    stream.close()
  })
  it('sends chat only while the current connection is open', () => {
    const stream = openAgentStream('ws://test/', '', { status: vi.fn(), message: vi.fn() })
    expect(stream.sendChat('before')).toBe(false)
    const ws = FakeSocket.instances[0]!
    ws.open()
    expect(stream.sendChat('hello')).toBe(true)
    expect(JSON.parse(ws.send.mock.calls.at(-1)![0]).payload).toEqual({ prompt: 'hello' })
    stream.close()
    expect(stream.sendChat('after')).toBe(false)
  })
})

describe('agent message attribution', () => {
  it('rejects parent and another child snapshots, accepting only its config path', () => {
    const payload = { positions: [], busy: false, configPath: '/config/alpha.json' }
    expect(acceptsAgentMessage(message(IpcMessageType.STATE_SNAPSHOT, payload), '/config/beta.json', 'beta')).toBe(
      false,
    )
    expect(acceptsAgentMessage(message(IpcMessageType.STATE_SNAPSHOT, payload), '/config/alpha.json', 'alpha')).toBe(
      true,
    )
    expect(
      acceptsAgentMessage(message(IpcMessageType.STATE_SNAPSHOT, { positions: [], busy: false }), '/config/alpha.json'),
    ).toBe(false)
  })
  it('rejects global and other-agent logs while retaining explicitly attributed logs', () => {
    const payload = { category: 'tool_start', message: 'inspect', agentId: 'alpha' }
    expect(acceptsAgentMessage(message(IpcMessageType.LOG_ENTRY, payload), undefined, 'beta')).toBe(false)
    expect(acceptsAgentMessage(message(IpcMessageType.LOG_ENTRY, payload), undefined, 'alpha')).toBe(true)
    expect(
      acceptsAgentMessage(message(IpcMessageType.LOG_ENTRY, { ...payload, agentId: '' }), undefined, 'alpha'),
    ).toBe(false)
  })
  it('ignores incomplete state and log payloads', () => {
    expect(acceptsAgentMessage(message(IpcMessageType.STATE_SNAPSHOT, null))).toBe(false)
    expect(acceptsAgentMessage(message(IpcMessageType.STATE_SNAPSHOT, { positions: [] }))).toBe(false)
    expect(acceptsAgentMessage(message(IpcMessageType.LOG_ENTRY, { category: 'test' }))).toBe(false)
  })
})
