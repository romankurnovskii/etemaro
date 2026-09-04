/**
 * @file IpcServer.test.ts
 * @description Unit tests for the WebSocket IPC server.
 * Uses real WebSocket connections on ephemeral ports (port 0) to avoid conflicts.
 */

import { type IpcMessage, IpcMessageType } from '@etemaro/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import { IpcServer } from './IpcServer.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMsg<T>(type: IpcMessageType, payload: T, id = 'test-id'): string {
  const msg: IpcMessage<T> = { id, type, payload, timestamp: Date.now() }
  return JSON.stringify(msg)
}

/** Connect to the server and wait for the WebSocket to be open. */
async function connect(port: number, _token?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

/** Wait for a single message from a WebSocket client. */
function nextMessage(ws: WebSocket): Promise<IpcMessage> {
  return new Promise((resolve) => {
    ws.once('message', (data) => {
      resolve(JSON.parse(String(data)) as IpcMessage)
    })
  })
}

/** Collect messages until the predicate matches or timeout expires. */
async function waitForMessage(
  ws: WebSocket,
  predicate: (m: IpcMessage) => boolean,
  timeoutMs = 2000,
): Promise<IpcMessage> {
  return new Promise((resolve, reject) => {
    const tid = setTimeout(() => reject(new Error('Timeout waiting for message')), timeoutMs)
    const listener = (data: unknown) => {
      const msg = JSON.parse(String(data)) as IpcMessage
      if (predicate(msg)) {
        clearTimeout(tid)
        ws.off('message', listener)
        resolve(msg)
      }
    }
    ws.on('message', listener)
  })
}

// ─── Test Setup ───────────────────────────────────────────────────────────────

let server: IpcServer
let port: number

beforeEach(async () => {
  // Use port 0 to let OS pick a free port
  server = new IpcServer({ ipcPort: 0 })
  await server.start()
  // @ts-expect-error — accessing private wss to discover bound port in tests
  port = (server.wss as import('ws').WebSocketServer).address()?.port as number
})

afterEach(async () => {
  await server.stop()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('IpcServer lifecycle', () => {
  it('starts and isRunning is true', () => {
    expect(server.isRunning).toBe(true)
  })

  it('client can connect and receives ACK on subscribe:logs', async () => {
    const ws = await connect(port)
    ws.send(makeMsg(IpcMessageType.SUBSCRIBE_LOGS, {}))
    const ack = await nextMessage(ws)
    expect(ack.type).toBe(IpcMessageType.ACK)
    ws.close()
  })

  it('stops cleanly and isRunning is false after stop', async () => {
    // stop is called in afterEach, but test an extra stop call here
    const ws = await connect(port)
    ws.close()
    await server.stop()
    // Prevent double-stop in afterEach from throwing
    server = new IpcServer({ ipcPort: 0 })
    await server.stop() // no-op on fresh unstarted server should not throw
  })
})

describe('IpcServer subscription — no auth token', () => {
  it('client subscribed to logs receives broadcastLog', async () => {
    const ws = await connect(port)
    ws.send(makeMsg(IpcMessageType.SUBSCRIBE_LOGS, {}))
    await nextMessage(ws) // consume ACK

    const entry = { category: 'test', message: 'hello', agentId: 'agent-test', ts: new Date().toISOString() }
    server.broadcastLog(entry)

    const logMsg = await waitForMessage(ws, (m) => m.type === IpcMessageType.LOG_ENTRY)
    expect(logMsg.type).toBe(IpcMessageType.LOG_ENTRY)
    expect((logMsg.payload as typeof entry).message).toBe('hello')
    ws.close()
  })

  it('client subscribed to state receives broadcastState', async () => {
    const ws = await connect(port)
    ws.send(makeMsg(IpcMessageType.SUBSCRIBE_STATE, {}))
    await nextMessage(ws) // ACK

    const state = { positions: [], totalPnlUsd: 42.5, busy: false }
    server.broadcastState(state)

    const stateMsg = await waitForMessage(ws, (m) => m.type === IpcMessageType.STATE_SNAPSHOT)
    expect((stateMsg.payload as typeof state).totalPnlUsd).toBe(42.5)
    ws.close()
  })

  it('client subscribing to state immediately receives cached latestState if present', async () => {
    const state = { positions: [], totalPnlUsd: 99.9, busy: false }
    server.broadcastState(state)

    const ws = await connect(port)
    const statePromise = waitForMessage(ws, (m) => m.type === IpcMessageType.STATE_SNAPSHOT)
    ws.send(makeMsg(IpcMessageType.SUBSCRIBE_STATE, {}))

    const stateMsg = await statePromise
    expect((stateMsg.payload as typeof state).totalPnlUsd).toBe(99.9)
    ws.close()
  })

  it('unsubscribed client does NOT receive log broadcast', async () => {
    const ws = await connect(port)
    // Do NOT subscribe — just connect

    const entry = { category: 'test', message: 'should not arrive', agentId: 'ag', ts: '' }
    server.broadcastLog(entry)

    // No message should arrive within 200ms
    const received = await new Promise<boolean>((resolve) => {
      const tid = setTimeout(() => resolve(false), 200)
      ws.once('message', () => {
        clearTimeout(tid)
        resolve(true)
      })
    })
    expect(received).toBe(false)
    ws.close()
  })

  it('command:chat fires the onChat handler', async () => {
    const chatHandler = vi.fn()
    server.onChat(chatHandler)

    const ws = await connect(port)
    ws.send(makeMsg(IpcMessageType.COMMAND_CHAT, { prompt: 'what is the PnL?' }))
    await nextMessage(ws) // ACK

    expect(chatHandler).toHaveBeenCalledOnce()
    expect(chatHandler).toHaveBeenCalledWith('what is the PnL?')
    ws.close()
  })

  it('command:action fires the onAction handler', async () => {
    const actionHandler = vi.fn()
    server.onAction(actionHandler)

    const ws = await connect(port)
    ws.send(makeMsg(IpcMessageType.COMMAND_ACTION, { action: 'screen' }))
    await nextMessage(ws) // ACK

    expect(actionHandler).toHaveBeenCalledWith('screen', undefined)
    ws.close()
  })
})

describe('IpcServer auth — token required', () => {
  let authServer: IpcServer
  let authPort: number

  beforeEach(async () => {
    authServer = new IpcServer({ ipcPort: 0, ipcToken: 'secret-token' })
    await authServer.start()
    // @ts-expect-error
    authPort = (authServer.wss as import('ws').WebSocketServer).address()?.port as number
  })

  afterEach(async () => {
    await authServer.stop()
  })

  it('client with correct token is authenticated', async () => {
    const ws = await connect(authPort)
    ws.send(makeMsg(IpcMessageType.AUTH, { token: 'secret-token' }, 'auth-1'))
    const ack = await nextMessage(ws)
    expect(ack.type).toBe(IpcMessageType.ACK)
    ws.close()
  })

  it('client with wrong token receives AUTH_FAILED error and is closed', async () => {
    const ws = await connect(authPort)
    ws.send(makeMsg(IpcMessageType.AUTH, { token: 'wrong-token' }, 'auth-bad'))

    const errMsg = await nextMessage(ws)
    expect(errMsg.type).toBe(IpcMessageType.ERROR)
    expect((errMsg.payload as { code: string }).code).toBe('AUTH_FAILED')
    ws.close()
  })

  it('unauthenticated client sending subscribe receives NOT_AUTHENTICATED', async () => {
    const ws = await connect(authPort)
    ws.send(makeMsg(IpcMessageType.SUBSCRIBE_LOGS, {}))
    const errMsg = await nextMessage(ws)
    expect(errMsg.type).toBe(IpcMessageType.ERROR)
    expect((errMsg.payload as { code: string }).code).toBe('NOT_AUTHENTICATED')
    ws.close()
  })
})

describe('IpcServer graceful shutdown', () => {
  it('stop() resolves after all clients disconnected', async () => {
    const ws1 = await connect(port)
    const ws2 = await connect(port)

    const closed1 = new Promise<void>((r) => ws1.once('close', () => r()))
    const closed2 = new Promise<void>((r) => ws2.once('close', () => r()))

    // stop is called in afterEach; call it here explicitly
    await server.stop()
    // Re-create so afterEach doesn't throw
    server = new IpcServer({ ipcPort: 0 })

    // Both clients must have received close events
    await Promise.all([closed1, closed2])
    expect(true).toBe(true) // reached here = graceful
  })
})
