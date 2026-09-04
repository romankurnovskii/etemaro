/**
 * @file ipc-protocol.ts
 * @description Shared WebSocket IPC protocol types used by the daemon (server)
 *   and by the Ink CLI / Desktop (clients). Pure type definitions — no runtime
 *   dependencies so this file can be imported safely in both browser and Node
 *   environments.
 *
 * @messageflow
 *   Client → Daemon: SUBSCRIBE_LOGS | SUBSCRIBE_STATE | COMMAND_CHAT | COMMAND_ACTION
 *   Daemon → Client: LOG_ENTRY | STATE_SNAPSHOT | ACK | ERROR
 */

// ─── Message Type Enum ────────────────────────────────────────────────────────

export enum IpcMessageType {
  // Client → Daemon
  SUBSCRIBE_LOGS = 'subscribe:logs',
  SUBSCRIBE_STATE = 'subscribe:state',
  COMMAND_CHAT = 'command:chat',
  COMMAND_ACTION = 'command:action',
  AUTH = 'auth',

  // Daemon → Client
  LOG_ENTRY = 'log:entry',
  STATE_SNAPSHOT = 'state:snapshot',
  ACK = 'ack',
  ERROR = 'error',
}

// ─── Base Message Envelope ────────────────────────────────────────────────────

/**
 * Every message crossing the WebSocket uses this envelope.
 * `id` is used to correlate ACK responses to requests.
 */
export interface IpcMessage<T = unknown> {
  /** Unique message ID (UUID or nanoid). Used to correlate ACKs. */
  id: string
  /** Message type discriminator. */
  type: IpcMessageType
  /** Message payload — shape depends on `type`. */
  payload: T
  /** Unix epoch ms when the message was created. */
  timestamp: number
}

// ─── Client → Daemon Payloads ────────────────────────────────────────────────

/** Payload for AUTH message — sent first by client if server requires a token. */
export interface IpcAuthPayload {
  token: string
}

/** SUBSCRIBE_LOGS has no payload body. */
export type IpcSubscribeLogsPayload = Record<string, never>

/** SUBSCRIBE_STATE has no payload body. */
export type IpcSubscribeStatePayload = Record<string, never>

/** Chat prompt forwarded to the ReAct agent loop. */
export interface IpcCommandChatPayload {
  prompt: string
}

/** Manual trigger for daemon operations. */
export interface IpcCommandActionPayload {
  action: 'screen' | 'close' | 'stop'
  /** Optional positional arguments (e.g. position_address for close). */
  args?: Record<string, unknown>
}

// ─── Daemon → Client Payloads ────────────────────────────────────────────────

/**
 * A single structured log entry broadcast to all log subscribers.
 * Mirrors `StructuredLogEntry` from logger.ts plus runtime envelope fields.
 */
export interface IpcLogEntry {
  /** Log category matching `logStructured()` categories (e.g. 'tool_start'). */
  category: string
  /** Human-readable log message (already redacted). */
  message: string
  /** Agent ID that emitted the log. */
  agentId: string
  /** ISO timestamp string. */
  ts: string
  /** Optional correlation ID for tracing operations across events. */
  correlationId?: string
  /** Optional structured metadata. */
  metadata?: Record<string, unknown>
}

/**
 * A live snapshot of the daemon's trading state, broadcast to state subscribers
 * after every management cycle and PnL poll.
 */
export interface IpcStateSnapshot {
  /** Currently tracked open positions. */
  positions: IpcPositionSummary[]
  /** Aggregate unrealised + realised PnL in USD. */
  totalPnlUsd: number
  /** ISO timestamp when the next screening cycle is scheduled. */
  nextScreenAt?: string
  /** ISO timestamp when the next management cycle is scheduled. */
  nextManageAt?: string
  /** Whether the daemon is currently executing a cron cycle. */
  busy: boolean
}

/** Minimal position summary for state snapshots. */
export interface IpcPositionSummary {
  positionAddress: string
  poolAddress: string
  tokenSymbol?: string
  pnlUsd?: number
  pnlPct?: number
  valueUsd?: number
  deployedAt?: string
}

// ─── ACK / ERROR ─────────────────────────────────────────────────────────────

/** Acknowledgment payload — echoes the original message ID. */
export interface IpcAckPayload {
  /** ID of the message being acknowledged. */
  ref: string
  ok: true
}

/** Error payload — echoes the original message ID (if any). */
export interface IpcErrorPayload {
  /** ID of the message that triggered the error, if applicable. */
  ref?: string
  code: string
  message: string
}
