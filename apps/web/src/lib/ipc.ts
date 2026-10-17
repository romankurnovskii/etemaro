/**
 * Browser-safe IPC protocol mirror of packages/core/src/shared/ipc-protocol.ts.
 * Kept local so the browser bundle never pulls Node-only core modules.
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
  /** Browser-only stable key taken from the IPC envelope. */
  clientId?: string
  level?: 'debug' | 'info' | 'warn' | 'error'
  category: string
  message: string
  agentId: string
  ts: string
  correlationId?: string
  metadata?: Record<string, unknown>
}

export interface PositionSummary {
  positionAddress: string
  poolAddress: string
  tokenSymbol?: string
  pnlUsd?: number
  pnlPct?: number
  valueUsd?: number
  deployedAt?: string
  lowerBin?: number | null
  upperBin?: number | null
  activeBin?: number | null
  inRange?: boolean | null
  assetSplit?: { tokenXAmount: number; tokenYAmount: number } | null
}

export interface StateSnapshot {
  positions: PositionSummary[]
  totalPnlUsd: number
  totalPnlUsdKnown?: boolean
  nextScreenAt?: string
  nextManageAt?: string
  busy: boolean
  walletAddress?: string | null
  activeStrategyId?: string | null
  configPath?: string
  phase?: 'Idle' | 'Evaluating' | 'Rebalancing' | 'Settled'
  phaseSince?: string
  lastDecision?: { summary: string; ts: string } | null
  lastTool?: { name: string; ts: string; status: 'running' | 'completed' | 'blocked' | 'failed' } | null
  confidence?: number | null
  lastError?: { message: string; ts: string } | null
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
  /** Configured TCP port; it does not imply a successful connection. */
  ipcPort?: number | null
  /** Actual supervisor start time, absent for older daemon versions. */
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
