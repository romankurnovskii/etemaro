/**
 * @file IpcServer.ts
 * @description WebSocket + HTTP server for the Etemaro daemon.
 *
 * Binds a single http.Server (TCP port or Unix domain socket) and attaches a
 * WebSocket upgrade handler. This lets lightweight clients (Ink CLI, browser
 * web UI, Desktop) do everything over one port:
 *   - Stream structured logs in real time
 *   - Receive live state snapshots (positions, PnL, next cron schedule)
 *   - Submit chat prompts and manual action commands
 *   - Browse the tool catalog and invoke any agent tool
 *
 * When `webDir` is configured the same server hosts the static web UI at `/`,
 * so `etemaro serve` needs no second process or port.
 *
 * Auth is optional: when `ipcToken` is set in config, WebSocket clients must
 * send an AUTH message within AUTH_TIMEOUT_MS and HTTP clients must present a
 * bearer token.  When `ipcToken` is absent, all localhost connections are trusted.
 *
 * @pattern Extends existing daemon shutdown pattern (registerExitSignal).
 * @dependencies ws (npm), @etemaro/core IPC protocol types
 */

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import {
  type IpcCommandActionPayload,
  type IpcCommandChatPayload,
  type IpcCommandToolPayload,
  type IpcLogEntry,
  type IpcMessage,
  IpcMessageType,
  type IpcStateSnapshot,
  type IpcToolCatalogPayload,
  type IpcToolDescriptor,
  type IpcToolResultPayload,
} from '@etemaro/core'
import { WebSocket, WebSocketServer } from 'ws'

// ─── Configuration ─────────────────────────────────────────────────────────

export interface IpcServerConfig {
  /** TCP port to listen on (used when ipcSocketPath is absent). Default: 8765. */
  ipcPort?: number
  /** Optional bearer token clients must send in an AUTH message. */
  ipcToken?: string
  /** Unix domain socket path (preferred over TCP when set). */
  ipcSocketPath?: string
  /** Bind host for the TCP listener. Default: 127.0.0.1 (localhost only). */
  ipcHost?: string
  /** Directory containing the static web UI to serve at `/`. */
  webDir?: string
  /** Agent identity reported by `GET /api/health`. */
  agentId?: string
}

/** Control-plane operations for managing agent instances from clients. */
export interface AgentControl {
  list(): unknown[]
  create(name: string): unknown
  start(id: string): unknown
  stop(id: string): unknown
  setStrategy(id: string, strategyId: string): unknown
}

/** Result of an internal tool invocation. */
type ToolOutcome =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; status: number; code: string; message: string }

// ─── Internal State ─────────────────────────────────────────────────────────

/** Milliseconds a client has to send an AUTH message before being kicked. */
const AUTH_TIMEOUT_MS = 2000

/** Maximum accepted JSON body for POST /api/tool. */
const MAX_BODY_BYTES = 1_000_000

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

interface ConnectedClient {
  id: string
  ws: WebSocket
  authenticated: boolean
  authTimer?: ReturnType<typeof setTimeout>
  subscriptions: Set<IpcMessageType.SUBSCRIBE_LOGS | IpcMessageType.SUBSCRIBE_STATE>
}

// ─── IpcServer Class ────────────────────────────────────────────────────────

export class IpcServer {
  private readonly config: IpcServerConfig
  private wss: WebSocketServer | null = null
  private httpServer: ReturnType<typeof createServer> | null = null
  private readonly clients = new Map<string, ConnectedClient>()
  private latestState: IpcStateSnapshot | null = null
  private toolCatalog: IpcToolDescriptor[] = []
  private agentId: string

  private chatHandler: ((prompt: string) => void) | null = null
  private actionHandler: ((action: string, args?: unknown) => void) | null = null
  private toolHandler: ((name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>) | null = null
  private agentControl: AgentControl | null = null

  constructor(config: IpcServerConfig) {
    this.config = config
    this.agentId = config.agentId ?? 'agent-default'
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Start the server. Binds to a Unix socket if `ipcSocketPath` is configured,
   * otherwise to TCP `ipcPort` on `ipcHost` (default 127.0.0.1:8765).
   */
  async start(): Promise<void> {
    const { ipcSocketPath, ipcPort = 8765, ipcHost = '127.0.0.1' } = this.config

    this.httpServer = createServer((req, res) => {
      void this._handleHttpRequest(req, res)
    })
    this.wss = new WebSocketServer({ server: this.httpServer })
    // Bind failures surface through the httpServer 'error' listener below; keep ws quiet.
    this.wss.on('error', () => {})

    if (ipcSocketPath) {
      // Remove stale socket file if present (crash recovery)
      if (fs.existsSync(ipcSocketPath)) fs.unlinkSync(ipcSocketPath)
      const dir = path.dirname(ipcSocketPath)
      if (dir) fs.mkdirSync(dir, { recursive: true })

      await new Promise<void>((resolve, reject) => {
        this.httpServer?.once('error', reject)
        this.httpServer?.listen(ipcSocketPath, () => resolve())
      })
      // Ensure socket is accessible by the daemon process owner
      try {
        fs.chmodSync(ipcSocketPath, 0o600)
      } catch {
        /* best-effort */
      }
    } else {
      await new Promise<void>((resolve, reject) => {
        this.httpServer?.once('error', reject)
        this.httpServer?.listen(ipcPort, ipcHost, () => resolve())
      })
    }

    this.wss.on('connection', (ws) => this._handleConnection(ws))
  }

  /**
   * Gracefully stop the server — close all client connections, then close the
   * WebSocket server and HTTP server, and remove any Unix socket file.
   */
  async stop(): Promise<void> {
    for (const client of this.clients.values()) {
      client.ws.close(1001, 'Server shutting down')
    }
    this.clients.clear()

    const wss = this.wss
    this.wss = null
    if (wss) {
      await new Promise<void>((resolve) => wss.close(() => resolve()))
    }

    const httpServer = this.httpServer
    this.httpServer = null
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    }

    if (this.config.ipcSocketPath && fs.existsSync(this.config.ipcSocketPath)) {
      try {
        fs.unlinkSync(this.config.ipcSocketPath)
      } catch {
        /* best-effort */
      }
    }
  }

  /** Broadcast a log entry to all clients subscribed to SUBSCRIBE_LOGS. */
  broadcastLog(entry: IpcLogEntry): void {
    this._broadcast(IpcMessageType.SUBSCRIBE_LOGS, {
      id: randomUUID(),
      type: IpcMessageType.LOG_ENTRY,
      payload: entry,
      timestamp: Date.now(),
    })
  }

  /** Broadcast a state snapshot to all clients subscribed to SUBSCRIBE_STATE. */
  broadcastState(state: IpcStateSnapshot): void {
    this.latestState = state
    this._broadcast(IpcMessageType.SUBSCRIBE_STATE, {
      id: randomUUID(),
      type: IpcMessageType.STATE_SNAPSHOT,
      payload: state,
      timestamp: Date.now(),
    })
  }

  /** Broadcast a chat reply to all connected authenticated clients. */
  broadcastChatReply(reply: string, inReplyTo?: string): void {
    const msg: IpcMessage = {
      id: randomUUID(),
      type: IpcMessageType.ACK,
      payload: { ref: inReplyTo || 'chat', ok: true, reply },
      timestamp: Date.now(),
    }
    const data = JSON.stringify(msg)
    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN && client.authenticated) {
        try {
          client.ws.send(data)
        } catch {
          /* ignore */
        }
      }
    }
  }

  /** Register the handler called when a client sends command:chat. */
  onChat(handler: (prompt: string) => void): void {
    this.chatHandler = handler
  }

  /** Register the handler called when a client sends command:action. */
  onAction(handler: (action: string, args?: unknown) => void): void {
    this.actionHandler = handler
  }

  /** Register the handler invoked for command:tool / POST /api/tool. */
  onTool(handler: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>): void {
    this.toolHandler = handler
  }

  /** Publish the tool catalog (sent to WS clients after AUTH, served at /api/tools). */
  setToolCatalog(tools: IpcToolDescriptor[]): void {
    this.toolCatalog = tools
  }

  /** Register the agent control plane (backs /api/agents*). */
  setAgentControl(control: AgentControl): void {
    this.agentControl = control
  }

  /** Set the agent identity reported by /api/health and the UI. */
  setAgentId(agentId: string): void {
    this.agentId = agentId
  }

  /** Whether the server is running. */
  get isRunning(): boolean {
    return this.httpServer !== null
  }

  /** Actual bound TCP port (null for Unix sockets or when stopped). */
  get boundPort(): number | null {
    const addr = this.httpServer?.address()
    return typeof addr === 'object' && addr ? addr.port : null
  }

  /** Configured agent identity. */
  get currentAgentId(): string {
    return this.agentId
  }

  // ─── HTTP ─────────────────────────────────────────────────────────────────

  private async _handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('X-Content-Type-Options', 'nosniff')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    let url: URL
    try {
      url = new URL(req.url || '/', 'http://localhost')
    } catch {
      this._sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'Malformed URL' } })
      return
    }
    const pathname = url.pathname

    if (pathname === '/api/health') {
      this._sendJson(res, 200, {
        status: 'ok',
        agentId: this.agentId,
        webUi: Boolean(this.config.webDir),
        tools: this.toolCatalog.length,
      })
      return
    }

    if (pathname.startsWith('/api/')) {
      if (!this._isHttpAuthorized(req, url)) {
        this._sendJson(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' } })
        return
      }

      if (pathname === '/api/agents' || pathname.startsWith('/api/agents/')) {
        await this._handleAgentControl(req, res, pathname)
        return
      }

      if (pathname === '/api/state' && req.method === 'GET') {
        this._sendJson(res, 200, {
          state: this.latestState ?? { positions: [], totalPnlUsd: 0, busy: false },
          agentId: this.agentId,
        })
        return
      }

      if (pathname === '/api/tools' && req.method === 'GET') {
        const payload: IpcToolCatalogPayload = { tools: this.toolCatalog }
        this._sendJson(res, 200, { agentId: this.agentId, ...payload })
        return
      }

      if (pathname === '/api/tool' && req.method === 'POST') {
        await this._handleHttpTool(req, res)
        return
      }

      this._sendJson(res, 404, { error: { code: 'NOT_FOUND', message: `No API route: ${pathname}` } })
      return
    }

    this._serveStatic(pathname, res)
  }

  private async _handleAgentControl(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    if (!this.agentControl) {
      this._sendJson(res, 503, { error: { code: 'NO_AGENT_CONTROL', message: 'Agent control is not available' } })
      return
    }
    try {
      if (pathname === '/api/agents' && req.method === 'GET') {
        this._sendJson(res, 200, { agents: this.agentControl.list() })
        return
      }
      if (pathname === '/api/agents' && req.method === 'POST') {
        const body = await this._readJsonBody(req)
        const agent = this.agentControl.create(String(body?.name ?? ''))
        this._sendJson(res, 200, { ok: true, agent })
        return
      }
      const match = pathname.match(/^\/api\/agents\/([^/]+)\/(start|stop|strategy)$/)
      if (match && req.method === 'POST') {
        const id = decodeURIComponent(match[1] as string)
        const action = match[2]
        if (action === 'start') {
          this._sendJson(res, 200, { ok: true, agent: this.agentControl.start(id) })
          return
        }
        if (action === 'stop') {
          this._sendJson(res, 200, { ok: true, agent: this.agentControl.stop(id) })
          return
        }
        const body = await this._readJsonBody(req)
        const agent = this.agentControl.setStrategy(id, String(body?.strategyId ?? ''))
        this._sendJson(res, 200, { ok: true, agent })
        return
      }
      this._sendJson(res, 404, { error: { code: 'NOT_FOUND', message: `No agent route: ${pathname}` } })
    } catch (e: any) {
      this._sendJson(res, 400, { error: { code: 'AGENT_OPERATION_FAILED', message: e?.message || String(e) } })
    }
  }

  private async _readJsonBody(req: IncomingMessage): Promise<any> {
    return JSON.parse((await this._readBody(req)) || '{}')
  }

  private async _handleHttpTool(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let parsed: { name?: unknown; args?: unknown; confirm?: unknown }
    try {
      parsed = JSON.parse((await this._readBody(req)) || '{}')
    } catch (e: any) {
      this._sendJson(res, 400, { error: { code: 'INVALID_JSON', message: e?.message || 'Invalid JSON body' } })
      return
    }

    const outcome = await this._invokeTool(parsed?.name, parsed?.args, parsed?.confirm)
    if (!outcome.ok) {
      this._sendJson(res, outcome.status, { error: { code: outcome.code, message: outcome.message } })
      return
    }
    this._sendJson(res, 200, { ok: true, agentId: this.agentId, result: outcome.result })
  }

  private _readBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
        if (body.length > limit) {
          reject(new Error('Request body too large'))
          req.destroy()
        }
      })
      req.on('end', () => resolve(body))
      req.on('error', reject)
    })
  }

  private _isHttpAuthorized(req: IncomingMessage, url: URL): boolean {
    if (!this.config.ipcToken) return true
    const header = req.headers.authorization
    if (header === `Bearer ${this.config.ipcToken}`) return true
    if (url.searchParams.get('token') === this.config.ipcToken) return true
    return false
  }

  private _serveStatic(pathname: string, res: ServerResponse): void {
    const webDir = this.config.webDir
    if (!webDir) {
      this._sendJson(res, 404, {
        error: { code: 'NO_WEB_UI', message: 'Web UI not bundled. Run from the repo or set webDir.' },
      })
      return
    }

    const rootDir = path.resolve(webDir)
    let rel = pathname
    try {
      rel = decodeURIComponent(pathname)
    } catch {
      /* use raw */
    }
    if (rel === '/' || rel === '') rel = '/index.html'

    // Path traversal guard: resolved path must stay inside rootDir.
    const resolved = path.resolve(rootDir, `.${rel}`)
    if (resolved !== rootDir && !resolved.startsWith(rootDir + path.sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Forbidden')
      return
    }

    let target = resolved
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      // SPA fallback for extension-less routes.
      target = path.extname(rel) ? target : path.join(rootDir, 'index.html')
    }

    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not found')
      return
    }

    const ext = path.extname(target).toLowerCase()
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    })
    res.end(fs.readFileSync(target))
  }

  private _sendJson(res: ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body)
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(payload)
  }

  // ─── Tool invocation ──────────────────────────────────────────────────────

  private async _invokeTool(nameRaw: unknown, argsRaw: unknown, confirmRaw: unknown): Promise<ToolOutcome> {
    if (typeof nameRaw !== 'string' || !nameRaw.trim()) {
      return { ok: false, status: 400, code: 'INVALID_TOOL', message: 'Tool name is required' }
    }
    const name = nameRaw.trim()
    const descriptor = this.toolCatalog.find((t) => t.name === name)
    if (!descriptor) {
      return { ok: false, status: 404, code: 'UNKNOWN_TOOL', message: `Unknown tool: ${name}` }
    }
    if (descriptor.isProtected && confirmRaw !== true) {
      return {
        ok: false,
        status: 403,
        code: 'CONFIRM_REQUIRED',
        message: `Tool "${name}" changes state; pass confirm=true to execute`,
      }
    }
    if (!this.toolHandler) {
      return { ok: false, status: 503, code: 'NO_HANDLER', message: 'No tool handler registered' }
    }
    const args =
      argsRaw && typeof argsRaw === 'object' && !Array.isArray(argsRaw) ? (argsRaw as Record<string, unknown>) : {}
    try {
      const result = await this.toolHandler(name, args)
      return { ok: true, result: result ?? {} }
    } catch (e: any) {
      return { ok: false, status: 500, code: 'TOOL_FAILED', message: e?.message || String(e) }
    }
  }

  // ─── WebSocket ────────────────────────────────────────────────────────────

  private _handleConnection(ws: WebSocket): void {
    const id = randomUUID()
    const client: ConnectedClient = {
      id,
      ws,
      authenticated: !this.config.ipcToken, // No token = auto-auth
      subscriptions: new Set(),
    }
    this.clients.set(id, client)

    // Auth timeout: if token required and client doesn't auth quickly, drop them
    if (this.config.ipcToken) {
      client.authTimer = setTimeout(() => {
        if (!client.authenticated) {
          this._sendError(ws, undefined, 'AUTH_TIMEOUT', 'Authentication timeout')
          ws.close(1008, 'Auth timeout')
        }
      }, AUTH_TIMEOUT_MS)
    } else {
      this._sendCatalog(ws)
    }

    ws.on('message', (data) => this._handleMessage(client, data))
    ws.on('close', () => {
      if (client.authTimer) clearTimeout(client.authTimer)
      this.clients.delete(id)
    })
    ws.on('error', () => {
      this.clients.delete(id)
    })
  }

  private _handleMessage(client: ConnectedClient, data: unknown): void {
    let msg: IpcMessage
    try {
      msg = JSON.parse(String(data)) as IpcMessage
    } catch {
      this._sendError(client.ws, undefined, 'INVALID_JSON', 'Message is not valid JSON')
      return
    }

    // Auth gate: process AUTH before anything else
    if (msg.type === IpcMessageType.AUTH) {
      const payload = msg.payload as { token?: string }
      if (this.config.ipcToken && payload.token !== this.config.ipcToken) {
        this._sendError(client.ws, msg.id, 'AUTH_FAILED', 'Invalid token')
        client.ws.close(1008, 'Auth failed')
        return
      }
      client.authenticated = true
      if (client.authTimer) clearTimeout(client.authTimer)
      this._sendAck(client.ws, msg.id)
      this._sendCatalog(client.ws)
      return
    }

    // Require auth for all other messages
    if (!client.authenticated) {
      this._sendError(client.ws, msg.id, 'NOT_AUTHENTICATED', 'Send AUTH first')
      return
    }

    switch (msg.type) {
      case IpcMessageType.SUBSCRIBE_LOGS:
        client.subscriptions.add(IpcMessageType.SUBSCRIBE_LOGS)
        this._sendAck(client.ws, msg.id)
        break

      case IpcMessageType.SUBSCRIBE_STATE:
        client.subscriptions.add(IpcMessageType.SUBSCRIBE_STATE)
        this._sendAck(client.ws, msg.id)
        if (this.latestState) {
          this._send(client.ws, {
            id: randomUUID(),
            type: IpcMessageType.STATE_SNAPSHOT,
            payload: this.latestState,
            timestamp: Date.now(),
          })
        }
        break

      case IpcMessageType.COMMAND_CHAT: {
        const payload = msg.payload as IpcCommandChatPayload
        if (payload?.prompt && this.chatHandler) {
          this.chatHandler(payload.prompt)
        }
        this._sendAck(client.ws, msg.id)
        break
      }

      case IpcMessageType.COMMAND_ACTION: {
        const payload = msg.payload as IpcCommandActionPayload
        if (payload?.action && this.actionHandler) {
          this.actionHandler(payload.action, payload.args)
        }
        this._sendAck(client.ws, msg.id)
        break
      }

      case IpcMessageType.COMMAND_TOOL: {
        const payload = msg.payload as IpcCommandToolPayload
        const ref = msg.id
        this._sendAck(client.ws, ref)
        void this._invokeTool(payload?.name, payload?.args, payload?.confirm).then((outcome) => {
          const resultPayload: IpcToolResultPayload = outcome.ok
            ? { ref, name: String(payload?.name ?? ''), ok: true, result: outcome.result }
            : { ref, name: String(payload?.name ?? ''), ok: false, error: outcome.message, code: outcome.code }
          this._send(client.ws, {
            id: randomUUID(),
            type: IpcMessageType.TOOL_RESULT,
            payload: resultPayload,
            timestamp: Date.now(),
          })
        })
        break
      }

      default:
        this._sendError(client.ws, msg.id, 'UNKNOWN_TYPE', `Unknown message type: ${msg.type}`)
    }
  }

  /** Send to all clients matching the subscription type. */
  private _broadcast(
    subscription: IpcMessageType.SUBSCRIBE_LOGS | IpcMessageType.SUBSCRIBE_STATE,
    msg: IpcMessage,
  ): void {
    const serialised = JSON.stringify(msg)
    for (const client of this.clients.values()) {
      if (client.authenticated && client.subscriptions.has(subscription) && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(serialised)
      }
    }
  }

  private _sendCatalog(ws: WebSocket): void {
    if (!this.toolCatalog.length) return
    const payload: IpcToolCatalogPayload = { tools: this.toolCatalog }
    this._send(ws, {
      id: randomUUID(),
      type: IpcMessageType.TOOL_CATALOG,
      payload,
      timestamp: Date.now(),
    })
  }

  private _send(ws: WebSocket, msg: IpcMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }

  private _sendAck(ws: WebSocket, ref: string): void {
    const ack: IpcMessage = {
      id: randomUUID(),
      type: IpcMessageType.ACK,
      payload: { ref, ok: true },
      timestamp: Date.now(),
    }
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(ack))
  }

  private _sendError(ws: WebSocket, ref: string | undefined, code: string, message: string): void {
    const errMsg: IpcMessage = {
      id: randomUUID(),
      type: IpcMessageType.ERROR,
      payload: { ref, code, message },
      timestamp: Date.now(),
    }
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(errMsg))
  }
}
