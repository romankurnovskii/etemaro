/**
 * @file IpcServer.test.ts
 * @description Unit tests for the WebSocket + HTTP IPC server.
 * Uses real connections on ephemeral ports (port 0) to avoid conflicts.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { type IpcMessage, IpcMessageType, type IpcToolDescriptor, repoPath } from '@etemaro/core'
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

/**
 * Connect and attach a message watcher *before* the socket opens, so messages
 * the server sends immediately on connection cannot race past the listener.
 */
async function connectWatching(
  port: number,
  predicate: (m: IpcMessage) => boolean,
): Promise<{ ws: WebSocket; first: Promise<IpcMessage> }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  const first = waitForMessage(ws, predicate)
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', reject)
  })
  return { ws, first }
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

const SAMPLE_TOOL: IpcToolDescriptor = {
  name: 'get_wallet_balance',
  description: 'Return wallet balances',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  isWrite: false,
  isProtected: false,
}

const WRITE_TOOL: IpcToolDescriptor = {
  name: 'close_position',
  description: 'Close an open position',
  parameters: { type: 'object', properties: { position_address: { type: 'string' } }, required: ['position_address'] },
  isWrite: true,
  isProtected: true,
}

// ─── Test Setup ───────────────────────────────────────────────────────────────

let server: IpcServer
let port: number

beforeEach(async () => {
  // Use port 0 to let OS pick a free port
  server = new IpcServer({ ipcPort: 0 })
  await server.start()
  port = server.boundPort as number
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
    const ws = await connect(port)
    ws.close()
    await server.stop()
    expect(server.isRunning).toBe(false)
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
    authPort = authServer.boundPort as number
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

    await server.stop()
    // Re-create so afterEach doesn't throw
    server = new IpcServer({ ipcPort: 0 })

    await Promise.all([closed1, closed2])
    expect(true).toBe(true) // reached here = graceful
  })
})

// ─── HTTP API + static web UI ─────────────────────────────────────────────────

describe('IpcServer HTTP + web UI', () => {
  let webServer: IpcServer
  let base: string
  let webDir: string

  beforeEach(async () => {
    webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etemaro-web-'))
    fs.writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>etemaro</title>')
    fs.writeFileSync(path.join(webDir, 'app.js'), 'console.log("hi")')

    webServer = new IpcServer({ ipcPort: 0, webDir, agentId: 'agent-test' })
    webServer.setToolCatalog([SAMPLE_TOOL, WRITE_TOOL])
    await webServer.start()
    base = `http://127.0.0.1:${webServer.boundPort}`
  })

  afterEach(async () => {
    await webServer.stop()
    fs.rmSync(webDir, { recursive: true, force: true })
  })

  it('GET /api/health reports ok, agent id and tool count', async () => {
    const res = await fetch(`${base}/api/health`)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.status).toBe('ok')
    expect(body.agentId).toBe('agent-test')
    expect(body.tools).toBe(2)
  })

  it('GET /api/tools returns the catalog', async () => {
    const res = await fetch(`${base}/api/tools`)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.tools.map((t: IpcToolDescriptor) => t.name)).toEqual(['get_wallet_balance', 'close_position'])
  })

  it('GET /api/state returns the latest snapshot', async () => {
    webServer.broadcastState({ positions: [], totalPnlUsd: 12.5, busy: true })
    const res = await fetch(`${base}/api/state`)
    const body: any = await res.json()
    expect(body.state.totalPnlUsd).toBe(12.5)
    expect(body.state.busy).toBe(true)
  })

  it('POST /api/tool invokes a read tool and returns the result', async () => {
    const handler = vi.fn().mockResolvedValue({ sol: 1.5 })
    webServer.onTool(handler)

    const res = await fetch(`${base}/api/tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'get_wallet_balance', args: {} }),
    })
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.result).toEqual({ sol: 1.5 })
    expect(handler).toHaveBeenCalledWith('get_wallet_balance', {})
  })

  it('POST /api/tool blocks a protected tool without confirm', async () => {
    webServer.onTool(vi.fn().mockResolvedValue({}))
    const res = await fetch(`${base}/api/tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'close_position', args: { position_address: 'x' } }),
    })
    expect(res.status).toBe(403)
    const body: any = await res.json()
    expect(body.error.code).toBe('CONFIRM_REQUIRED')
  })

  it('POST /api/tool allows a protected tool with confirm=true', async () => {
    webServer.onTool(vi.fn().mockResolvedValue({ closed: true }))
    const res = await fetch(`${base}/api/tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'close_position', args: { position_address: 'x' }, confirm: true }),
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as any).result).toEqual({ closed: true })
  })

  it('POST /api/tool returns 404 for an unknown tool', async () => {
    const res = await fetch(`${base}/api/tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'not_a_tool' }),
    })
    expect(res.status).toBe(404)
    expect(((await res.json()) as any).error.code).toBe('UNKNOWN_TOOL')
  })

  it('POST /api/tool surfaces handler errors as 500', async () => {
    webServer.onTool(vi.fn().mockRejectedValue(new Error('boom')))
    const res = await fetch(`${base}/api/tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'get_wallet_balance' }),
    })
    expect(res.status).toBe(500)
    expect(((await res.json()) as any).error.message).toBe('boom')
  })

  it('serves the static web UI at /', async () => {
    const res = await fetch(`${base}/`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('etemaro')
  })

  it('serves JS assets with a JS content type', async () => {
    const res = await fetch(`${base}/app.js`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/javascript')
  })

  it('blocks path traversal', async () => {
    const res = await fetch(`${base}/%2e%2e%2f%2e%2e%2fetc%2fpasswd`)
    expect(res.status).toBe(403)
  })

  it('sends the tool catalog over WebSocket after connect', async () => {
    const { ws, first } = await connectWatching(
      webServer.boundPort as number,
      (m) => m.type === IpcMessageType.TOOL_CATALOG,
    )
    const msg = await first
    expect((msg.payload as { tools: IpcToolDescriptor[] }).tools).toHaveLength(2)
    ws.close()
  })

  it('executes command:tool over WebSocket and returns TOOL_RESULT', async () => {
    webServer.onTool(vi.fn().mockResolvedValue({ sol: 3 }))
    const { ws, first } = await connectWatching(
      webServer.boundPort as number,
      (m) => m.type === IpcMessageType.TOOL_CATALOG,
    )
    await first
    ws.send(makeMsg(IpcMessageType.COMMAND_TOOL, { name: 'get_wallet_balance', args: {} }))
    const result = await waitForMessage(ws, (m) => m.type === IpcMessageType.TOOL_RESULT)
    expect((result.payload as { ok: boolean; result: { sol: number } }).ok).toBe(true)
    expect((result.payload as { result: { sol: number } }).result.sol).toBe(3)
    ws.close()
  })

  it('rejects command:tool for a protected tool without confirm', async () => {
    const { ws, first } = await connectWatching(
      webServer.boundPort as number,
      (m) => m.type === IpcMessageType.TOOL_CATALOG,
    )
    await first
    ws.send(makeMsg(IpcMessageType.COMMAND_TOOL, { name: 'close_position', args: {} }))
    const result = await waitForMessage(ws, (m) => m.type === IpcMessageType.TOOL_RESULT)
    const payload = result.payload as { ok: boolean; code: string }
    expect(payload.ok).toBe(false)
    expect(payload.code).toBe('CONFIRM_REQUIRED')
    ws.close()
  })
})

describe('IpcServer serves the bundled apps/web UI', () => {
  let uiServer: IpcServer
  let base: string

  beforeEach(async () => {
    uiServer = new IpcServer({ ipcPort: 0, webDir: repoPath('apps', 'web'), agentId: 'agent-ui' })
    await uiServer.start()
    base = `http://127.0.0.1:${uiServer.boundPort}`
  })

  afterEach(async () => {
    await uiServer.stop()
  })

  it('serves index.html at /', async () => {
    const res = await fetch(`${base}/`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Etemaro')
    expect(html).toContain('/app.js')
  })

  it('serves the app bundle', async () => {
    const res = await fetch(`${base}/app.js`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('connectWs')
  })

  it('serves styles.css with a CSS content type', async () => {
    const res = await fetch(`${base}/styles.css`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/css')
  })
})

describe('IpcServer HTTP auth', () => {
  let authServer: IpcServer
  let base: string

  beforeEach(async () => {
    authServer = new IpcServer({ ipcPort: 0, ipcToken: 'secret-token', agentId: 'agent-auth' })
    authServer.setToolCatalog([SAMPLE_TOOL])
    await authServer.start()
    base = `http://127.0.0.1:${authServer.boundPort}`
  })

  afterEach(async () => {
    await authServer.stop()
  })

  it('health stays public', async () => {
    const res = await fetch(`${base}/api/health`)
    expect(res.status).toBe(200)
  })

  it('rejects /api/tools without a token', async () => {
    const res = await fetch(`${base}/api/tools`)
    expect(res.status).toBe(401)
  })

  it('accepts /api/tools with a bearer token', async () => {
    const res = await fetch(`${base}/api/tools`, { headers: { Authorization: 'Bearer secret-token' } })
    expect(res.status).toBe(200)
  })

  it('accepts /api/tools with a query token', async () => {
    const res = await fetch(`${base}/api/tools?token=secret-token`)
    expect(res.status).toBe(200)
  })
})
