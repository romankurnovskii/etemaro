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
  category: string
  message: string
  agentId: string
  ts: string
  correlationId?: string
  metadata?: Record<string, unknown>
}

export type LogSeverity = 'info' | 'warn' | 'error'

export const LOOP_STAGES = ['Idle', 'Evaluating', 'Rebalancing', 'Settled'] as const
export type LoopStage = (typeof LOOP_STAGES)[number]

export interface PositionSummary {
  positionAddress: string
  poolAddress: string
  tokenSymbol?: string
  pnlUsd?: number
  pnlPct?: number
  valueUsd?: number
  deployedAt?: string
  binRange?: { minBinId: number; maxBinId: number } | [number, number]
  inRange?: boolean
  assetSplit?: {
    tokenX?: number
    tokenY?: number
    tokenXSymbol?: string
    tokenYSymbol?: string
    ratioX?: number
  }
  activeBin?: number
  unclaimedFeesUsd?: number
}

export interface StateSnapshot {
  positions: PositionSummary[]
  totalPnlUsd: number
  totalRealizedPnlUsd?: number
  sessionPnlUsd?: number
  unclaimedFeesUsd?: number
  nextScreenAt?: string
  nextManageAt?: string
  busy: boolean
  walletAddress?: string | null
  activeStrategyId?: string | null
  configPath?: string
  dryRun?: boolean
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
}

export interface StrategySummary {
  id: string
  name?: string
  description?: string
  active?: boolean
  parameters?: Record<string, unknown>
}

export interface StrategyDetails {
  id: string
  name?: string
  description?: string
  parameters?: Record<string, unknown>
  minLiquidityUsd?: number
  stopLossPct?: number
  takeProfitPct?: number
  binStep?: number
  rebalanceInterval?: string | number
  [key: string]: unknown
}

export interface ChatMessage {
  id: string
  sender: 'user' | 'agent' | 'system'
  text: string
}

export type DecisionType = 'deploy' | 'close' | 'skip' | 'no_deploy' | 'note'

export interface Decision {
  id: string
  ts: string
  type: DecisionType
  actor: string
  pool: string | null
  pool_name: string | null
  position: string | null
  summary: string | null
  reason: string | null
  risks: string[]
  metrics: Record<string, unknown>
  rejected: string[]
}
