import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openAgentStream } from './useAgentConnection'

class Socket {
  readyState = 1
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  onerror = null
  send = vi.fn()
  close = vi.fn()
  message(type: string, payload: unknown) {
    this.onmessage?.({ data: JSON.stringify({ type, payload }) })
  }
}
const handlers = () => ({ status: vi.fn(), snapshot: vi.fn(), log: vi.fn(), catalog: vi.fn(), reply: vi.fn() })
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
describe('agent stream lifecycle', () => {
  it('authenticates before subscribing and reports connection only after protocol data', () => {
    const socket = new Socket()
    const callbacks = handlers()
    const stream = openAgentStream(
      'ws://test',
      'synthetic-token',
      callbacks,
      undefined,
      () => socket as unknown as WebSocket,
    )
    socket.onopen?.()
    expect(socket.send.mock.calls.map(([payload]) => JSON.parse(payload).type)).toEqual([
      'auth',
      'subscribe:logs',
      'subscribe:state',
    ])
    expect(callbacks.status).not.toHaveBeenCalledWith('connected')
    socket.message('state:snapshot', { positions: [], busy: false, totalPnlUsd: 0 })
    expect(callbacks.status).toHaveBeenLastCalledWith('connected')
    stream.close()
  })
  it('filters other-agent logs and refuses an explicit identity mismatch', () => {
    const socket = new Socket()
    const callbacks = handlers()
    const stream = openAgentStream('ws://test', '', callbacks, 'alpha', () => socket as unknown as WebSocket)
    socket.message('log:entry', { agentId: 'beta', category: 'info', message: 'other' })
    expect(callbacks.log).not.toHaveBeenCalled()
    socket.message('state:snapshot', { agentId: 'beta', positions: [] })
    expect(callbacks.snapshot).toHaveBeenLastCalledWith(null)
    expect(callbacks.status).toHaveBeenLastCalledWith('error')
    expect(socket.close).toHaveBeenCalled()
    stream.close()
  })
  it('stops retrying on rejected authentication', async () => {
    const socket = new Socket()
    const callbacks = handlers()
    const factory = vi.fn(() => socket as unknown as WebSocket)
    const stream = openAgentStream('ws://test', 'invalid', callbacks, undefined, factory)
    socket.onclose?.({ code: 1008 })
    await vi.advanceTimersByTimeAsync(30000)
    expect(factory).toHaveBeenCalledTimes(1)
    expect(callbacks.status).toHaveBeenLastCalledWith('unauthorized')
    stream.close()
  })
  it('backs off transient failures, clears stale state and cancels pending retry', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const first = new Socket()
    const second = new Socket()
    const callbacks = handlers()
    const factory = vi.fn().mockReturnValueOnce(first).mockReturnValue(second)
    const stream = openAgentStream('ws://test', '', callbacks, undefined, factory)
    first.onclose?.({ code: 1006 })
    expect(callbacks.snapshot).toHaveBeenLastCalledWith(null)
    await vi.advanceTimersByTimeAsync(799)
    expect(factory).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(factory).toHaveBeenCalledTimes(2)
    second.onclose?.({ code: 1006 })
    stream.close()
    await vi.advanceTimersByTimeAsync(30000)
    expect(factory).toHaveBeenCalledTimes(2)
  })
  it('ignores disposed callbacks and malformed frames', () => {
    const socket = new Socket()
    const callbacks = handlers()
    const stream = openAgentStream('ws://test', '', callbacks, undefined, () => socket as unknown as WebSocket)
    socket.onmessage?.({ data: 'bad json' })
    socket.message('state:snapshot', null)
    expect(callbacks.snapshot).not.toHaveBeenCalled()
    stream.close()
    socket.message('state:snapshot', { positions: [] })
    expect(callbacks.snapshot).not.toHaveBeenCalled()
    expect(stream.sendChat('do not send')).toBe(false)
  })
})
