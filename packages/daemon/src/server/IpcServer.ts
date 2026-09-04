/**
 * @file IpcServer.ts
 * @description WebSocket IPC server for the Etemaro daemon.
 *
 * Binds a WebSocket server on a Unix domain socket (preferred) or a TCP port
 * so that lightweight clients (Ink CLI, Desktop) can:
 *   - Stream structured logs in real time
 *   - Receive live state snapshots (positions, PnL, next cron schedule)
 *   - Submit chat prompts and manual action commands
 *
 * Auth is optional: when `ipcToken` is set in config, connecting clients must
 * send an AUTH message within AUTH_TIMEOUT_MS; otherwise the connection is
 * closed.  When `ipcToken` is absent, all local connections are trusted.
 *
 * @pattern Extends existing daemon shutdown pattern (registerExitSignal).
 * @dependencies ws (npm), @etemaro/core IPC protocol types
 */

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { createServer } from 'node:http'
import {
  type IpcCommandActionPayload,
  type IpcCommandChatPayload,
  type IpcLogEntry,
  type IpcMessage,
  IpcMessageType,
  type IpcStateSnapshot,
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
}

// ─── Internal State ─────────────────────────────────────────────────────────

/** Milliseconds a client has to send an AUTH message before being kicked. */
const AUTH_TIMEOUT_MS = 2000

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

  private chatHandler: ((prompt: string) => void) | null = null
  private actionHandler: ((action: string, args?: unknown) => void) | null = null

  constructor(config: IpcServerConfig) {
    this.config = config
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Start the WebSocket server.  Binds to Unix socket if `ipcSocketPath` is
   * configured, otherwise binds to TCP `ipcPort` (defaulting to 8765).
   */
  async start(): Promise<void> {
    const { ipcSocketPath, ipcPort = 8765 } = this.config

    if (ipcSocketPath) {
      // Remove stale socket file if present (crash recovery)
      if (fs.existsSync(ipcSocketPath)) {
        fs.unlinkSync(ipcSocketPath)
      }
      // Ensure parent directory exists
      const dir = ipcSocketPath.substring(0, ipcSocketPath.lastIndexOf('/'))
      if (dir) fs.mkdirSync(dir, { recursive: true })

      this.httpServer = createServer()
      this.wss = new WebSocketServer({ server: this.httpServer })
      await new Promise<void>((resolve) => {
        this.httpServer?.listen(ipcSocketPath, () => resolve())
      })
      // Ensure socket is accessible by the daemon process owner
      try {
        fs.chmodSync(ipcSocketPath, 0o600)
      } catch {
        /* best-effort */
      }
    } else {
      this.wss = new WebSocketServer({ port: ipcPort })
      await new Promise<void>((resolve, reject) => {
        this.wss?.once('listening', resolve)
        this.wss?.once('error', reject)
      })
    }

    this.wss.on('connection', (ws) => this._handleConnection(ws))
  }

  /**
   * Gracefully stop the server — close all client connections, then close the
   * WebSocket server and HTTP server (if used).
   */
  async stop(): Promise<void> {
    // Close all clients
    for (const client of this.clients.values()) {
      client.ws.close(1001, 'Server shutting down')
    }
    this.clients.clear()

    await new Promise<void>((resolve) => {
      if (this.wss) {
        this.wss.close(() => resolve())
      } else {
        resolve()
      }
    })

    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer?.close(() => resolve())
      })
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

  /** Whether the server is running. */
  get isRunning(): boolean {
    return this.wss !== null
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

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
