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
  /** Browser-local identity for repeated events with identical timestamps. */
  streamId?: string
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
}

export interface StateSnapshot {
  positions: PositionSummary[]
  totalPnlUsd: number
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
  active?: boolean
}

export interface ChatMessage {
  id: string
  sender: 'user' | 'agent' | 'system'
  text: string
}

export interface LivePosition {
  position: string
  pool: string
  pair?: string
  lower_bin?: number | null
  upper_bin?: number | null
  active_bin?: number | null
  in_range?: boolean | null
  /** Optional extensions; older daemons do not report asset composition. */
  token_x_value_usd?: number | null
  token_y_value_usd?: number | null
}

export type Severity = 'info' | 'warn' | 'error'

export function logSeverity(log: LogEntry): Severity {
  const level = String(log.metadata?.level ?? log.metadata?.severity ?? log.category).toLowerCase()
  if (/(error|fatal|fail)/.test(level)) return 'error'
  if (/(warn|block|degrad)/.test(level)) return 'warn'
  return 'info'
}

export type LoopStage = 'Idle' | 'Evaluating' | 'Rebalancing' | 'Settled'

/** Infer only from this agent's actual state and structured tool events. */
export function loopStage(snapshot: StateSnapshot | null, logs: LogEntry[]): LoopStage | null {
  if (!snapshot) return null
  if (snapshot.busy) {
    const tool = [...logs].reverse().find((log) => ['tool_start', 'tool_finish', 'tool_blocked'].includes(log.category))
    if (
      tool?.category === 'tool_start' &&
      /deploy_position|close_position|swap_token|rebalance/.test(String(tool.metadata?.tool))
    )
      return 'Rebalancing'
    return 'Evaluating'
  }
  return snapshot.positions.length > 0 ? 'Settled' : 'Idle'
}

export function strategyDiff(
  before: unknown,
  after: unknown,
  path = '',
): { path: string; before: unknown; after: unknown }[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return []
  const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
  if (object(before) && object(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .sort()
      .filter((key) => key !== 'is_active')
      .flatMap((key) => strategyDiff(before[key], after[key], path ? `${path}.${key}` : key))
  }
  return [{ path: path || 'strategy', before, after }]
}

/** Keep credentials on the configured daemon's host; agents only change port. */
export function agentEndpoint(baseUrl: string, port: unknown): string {
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Agent IPC port is unavailable')
  const url = new URL(baseUrl)
  url.port = String(port)
  return url.origin
}
