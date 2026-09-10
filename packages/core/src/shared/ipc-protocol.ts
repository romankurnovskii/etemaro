/**
 * @file ipc-protocol.ts
 * @description Shared WebSocket IPC protocol types used by the daemon (server)
 *   and by the Ink CLI / Desktop (clients). Pure type definitions — no runtime
 *   dependencies so this file can be imported safely in both browser and Node
 *   environments.
 *
 * @messageflow
 *   Client → Daemon: SUBSCRIBE_LOGS | SUBSCRIBE_STATE | COMMAND_CHAT | COMMAND_ACTION | COMMAND_TOOL
 *   Daemon → Client: LOG_ENTRY | STATE_SNAPSHOT | TOOL_CATALOG | TOOL_RESULT | ACK | ERROR
 */

// ─── Message Type Enum ────────────────────────────────────────────────────────

export enum IpcMessageType {
  // Client → Daemon
  SUBSCRIBE_LOGS = 'subscribe:logs',
  SUBSCRIBE_STATE = 'subscribe:state',
  COMMAND_CHAT = 'command:chat',
  COMMAND_ACTION = 'command:action',
  COMMAND_TOOL = 'command:tool',
  AUTH = 'auth',

  // Daemon → Client
  LOG_ENTRY = 'log:entry',
  STATE_SNAPSHOT = 'state:snapshot',
  TOOL_CATALOG = 'tool:catalog',
  TOOL_RESULT = 'tool:result',
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

/**
 * Generic invocation of any registered agent tool by name.
 * Mirrors the LLM tool surface 1:1 (see ToolDefinitions.ts) so new tools
 * reach every client without protocol changes.
 */
export interface IpcCommandToolPayload {
  /** Tool name, e.g. 'get_wallet_balance' or 'deploy_position'. */
  name: string
  /** Tool arguments matching the tool's JSON Schema. */
  args?: Record<string, unknown>
  /** Required true for state-changing (protected) tools. */
  confirm?: boolean
}

/** A single tool exposed to clients (derived from the LLM tool schema). */
export interface IpcToolDescriptor {
  name: string
  description: string
  /** JSON Schema object describing accepted arguments. */
  parameters: Record<string, unknown>
  /** True when the tool moves funds / mutates on-chain state. */
  isWrite: boolean
  /** True when the tool must be explicitly confirmed before execution. */
  isProtected: boolean
}

/** Full catalog of tools, sent to clients after authentication. */
export interface IpcToolCatalogPayload {
  tools: IpcToolDescriptor[]
}

/** Result of a COMMAND_TOOL invocation. */
export interface IpcToolResultPayload {
  /** ID of the COMMAND_TOOL message this result answers. */
  ref: string
  name: string
  ok: boolean
  result?: Record<string, unknown>
  error?: string
  /** Machine-readable error code when ok === false. */
  code?: string
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
