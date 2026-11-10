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

export interface PositionSummary {
  positionAddress: string
  poolAddress: string
  tokenSymbol?: string
  pnlUsd?: number
  pnlPct?: number
  valueUsd?: number
  unclaimedFeesUsd?: number
  deployedAt?: string
  /** Optional visualizer fields; null/absent on older daemons. */
  priceRangeBins?: PriceRangeBins | null
  inRangeStatus?: InRangeStatus | null
  assetSplit?: AssetSplit | null
}

export interface PriceRangeBins {
  lower: number
  upper: number
  active: number | null
}

export interface InRangeStatus {
  inRange: boolean
  minutesOutOfRange: number
}

export interface AssetSplit {
  tokenXPct: number
  tokenYPct: number
}

export interface Uptime {
  startedAt: string
  seconds: number
}

export interface DecisionSummary {
  ts: string
  type: string
  actor: string
  poolName: string | null
  summary: string | null
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
  agentId?: string
  uptime?: Uptime | null
  heartbeatAt?: string
  lastDecision?: DecisionSummary | null
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
  /** When the supervisor spawned the running child; null when stopped or unknown. */
  startedAt: string | null
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

/* ---------- Safe-default normalizers (older daemons omit newer fields) ---------- */

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizeBins(value: unknown): PriceRangeBins | null {
  const v = value as Partial<PriceRangeBins> | null | undefined
  if (!v || !isFiniteNumber(v.lower) || !isFiniteNumber(v.upper)) return null
  return { lower: v.lower, upper: v.upper, active: isFiniteNumber(v.active) ? v.active : null }
}

function normalizeRange(value: unknown): InRangeStatus | null {
  const v = value as Partial<InRangeStatus> | null | undefined
  if (!v || typeof v.inRange !== 'boolean') return null
  return { inRange: v.inRange, minutesOutOfRange: isFiniteNumber(v.minutesOutOfRange) ? v.minutesOutOfRange : 0 }
}

function normalizeSplit(value: unknown): AssetSplit | null {
  const v = value as Partial<AssetSplit> | null | undefined
  if (!v || !isFiniteNumber(v.tokenXPct) || v.tokenXPct < 0 || v.tokenXPct > 100) return null
  return { tokenXPct: v.tokenXPct, tokenYPct: isFiniteNumber(v.tokenYPct) ? v.tokenYPct : 100 - v.tokenXPct }
}

export function normalizePosition(raw: PositionSummary): PositionSummary {
  return {
    ...raw,
    priceRangeBins: normalizeBins(raw.priceRangeBins),
    inRangeStatus: normalizeRange(raw.inRangeStatus),
    assetSplit: normalizeSplit(raw.assetSplit),
  }
}

export function normalizeSnapshot(raw: StateSnapshot): StateSnapshot {
  const uptime = raw.uptime
  const decision = raw.lastDecision
  return {
    ...raw,
    positions: Array.isArray(raw.positions) ? raw.positions.map(normalizePosition) : [],
    totalPnlUsd: isFiniteNumber(raw.totalPnlUsd) ? raw.totalPnlUsd : 0,
    busy: Boolean(raw.busy),
    uptime: uptime && typeof uptime.startedAt === 'string' && isFiniteNumber(uptime.seconds) ? uptime : null,
    lastDecision: decision && typeof decision.ts === 'string' ? decision : null,
  }
}

export function normalizeAgent(raw: ManagedAgent): ManagedAgent {
  return {
    ...raw,
    strategyId: raw.strategyId ?? null,
    pid: raw.pid ?? null,
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
  }
}
