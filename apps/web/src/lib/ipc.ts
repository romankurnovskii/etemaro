/**
 * Browser-safe IPC protocol mirror of packages/core/src/shared/ipc-protocol.ts.
 * Kept local so the browser bundle never pulls Node-only core modules.
 *
 * Extended in #342 to mirror the new optional telemetry fields added in
 * feat(daemon): expose per-agent telemetry for the web console (#342).
 */
export const IpcMessageType = {
  SUBSCRIBE_LOGS: 'subscribe:logs',
  SUBSCRIBE_STATE: 'subscribe:state',
  COMMAND_CHAT: 'command:chat',
  COMMAND_ACTION: 'command:action',
  COMMAND_TOOL: 'command:tool',
  AUTH: 'auth',
  LOG_ENTRY: 'log:entry',
  STATE_SNAPSHOT: 'state:snapshot',
  TOOL_CATALOG: 'tool:catalog',
  TOOL_RESULT: 'tool:result',
  ACK: 'ack',
  ERROR: 'error',
} as const

export interface IpcMessage<T = unknown> {
  id: string
  type: string
  payload: T
  timestamp: number
}

export interface LogEntry {
  category: string
  message: string
  agentId: string
  ts: string
  correlationId?: string
  metadata?: Record<string, unknown>
}

/** Minimal position summary for state snapshots. Extended with bin-range data. */
export interface PositionSummary {
  positionAddress: string
  poolAddress: string
  tokenSymbol?: string
  pnlUsd?: number
  pnlPct?: number
  valueUsd?: number
  unclaimedFeesUsd?: number
  deployedAt?: string
  /** Real bin data from MeteoraAdapter — optional, absent on older daemons. */
  lowerBin?: number
  upperBin?: number
  activeBin?: number
  inRange?: boolean
  minutesOutOfRange?: number
}

export interface StateSnapshot {
  positions: PositionSummary[]
  totalPnlUsd: number
  /** Lifetime realized PnL across all closed positions. */
  totalRealizedPnlUsd?: number
  /** Realized PnL achieved during the current daemon session. */
  sessionPnlUsd?: number
  /** Aggregate unclaimed fees across all open positions. */
  unclaimedFeesUsd?: number
  nextScreenAt?: string
  nextManageAt?: string
  busy: boolean
  walletAddress?: string | null
  activeStrategyId?: string | null
  configPath?: string
  dryRun?: boolean
  /** Authoritative phase from the daemon's own busy flags. Optional — absent on older daemons. */
  phase?: 'idle' | 'screening' | 'managing' | 'chat'
  /** Agent instance id, populated by the daemon. */
  agentId?: string
  /** ISO timestamp when the current daemon session started. */
  startedAt?: string
}

export interface JsonSchema {
  type?: string
  description?: string
  enum?: unknown[]
  items?: JsonSchema
  properties?: Record<string, JsonSchema>
  required?: string[]
}

export interface ToolDescriptor {
  name: string
  description: string
  parameters: JsonSchema
  isWrite: boolean
  isProtected: boolean
}

export interface ManagedAgent {
  id: string
  name: string
  description?: string
  strategyId: string | null
  running: boolean
  pid: number | null
  configPath: string
  dataDir: string
  /** TCP port the agent's own IpcServer listens on. Available after Commit 1. */
  ipcPort?: number | null
  /** ISO timestamp when this agent was last started. */
  startedAt?: string | null
}

export interface StrategySummary {
  id: string
  name?: string
  active?: boolean
}

export interface ChatMessage {
  id: string
  sender: 'user' | 'agent' | 'system'
  text: string
}

/** HTTP 200 domain-error payloads from ToolExecutor. */
export interface ToolResultError {
  error: string
  blocked?: boolean
}

export interface AckPayload {
  id: string
  reply?: string
}

export interface ErrorPayload {
  code: string
  message: string
}
