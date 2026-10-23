import type { IpcLogEntry, IpcPositionSummary, IpcStateSnapshot } from './ipc-protocol.js'

type Phase = NonNullable<IpcStateSnapshot['phase']>
type ToolStatus = NonNullable<IpcStateSnapshot['lastTool']>['status']
export type PositionTelemetry = Pick<
  IpcPositionSummary,
  'lowerBin' | 'upperBin' | 'activeBin' | 'inRange' | 'assetSplit'
>

const PORTFOLIO_TOOLS = new Set([
  'deploy_position',
  'close_position',
  'claim_fees',
  'swap_token',
  'swap_all_tokens_to_sol',
  'sweep_unsold_tokens',
  'close_all_positions',
])

/** Pure execution observer. It cannot invoke tools, read wallets, or perform I/O. */
export class AgentTelemetry {
  private readonly activities = new Set<symbol>()
  private readonly tools = new Map<string, string>()
  private phase: Phase = 'Idle'
  private phaseSince: string
  private lastDecision: IpcStateSnapshot['lastDecision'] = null
  private lastTool: IpcStateSnapshot['lastTool'] = null
  private lastToolId: string | null = null
  private lastError: IpcStateSnapshot['lastError'] = null

  constructor(private readonly now: () => number = Date.now) {
    this.phaseSince = this.timestamp()
  }

  /** Called at the actual entry to a supervised daemon cycle or agentLoop invocation. */
  beginActivity(): symbol {
    if (this.activities.size === 0 && this.tools.size === 0) this.lastError = null
    const id = Symbol('daemon-activity')
    this.activities.add(id)
    this.refreshPhase()
    return id
  }

  /** End the same activity in finally; an error is a redacted execution error, not trade evidence. */
  finishActivity(id: symbol, error?: string): void {
    if (!this.activities.delete(id)) return
    if (error) this.lastError = { message: error, ts: this.timestamp() }
    this.refreshPhase(error ? 'Idle' : 'Settled')
  }

  /** Consume structured producer events; never guess a phase from prose or a busy flag. */
  observeLog(entry: IpcLogEntry): boolean {
    const metadata = entry.metadata
    if (
      entry.category === 'tool_execution_start' &&
      typeof metadata?.executionId === 'string' &&
      typeof metadata.tool === 'string'
    ) {
      if (this.activities.size === 0 && this.tools.size === 0) this.lastError = null
      this.tools.set(metadata.executionId, metadata.tool)
      this.lastToolId = metadata.executionId
      this.lastTool = { name: metadata.tool, ts: entry.ts, status: 'running' }
      this.refreshPhase()
      return true
    }
    if (entry.category === 'tool_execution_end' && typeof metadata?.executionId === 'string') {
      const name = this.tools.get(metadata.executionId)
      if (!name) return false
      this.tools.delete(metadata.executionId)
      const status: ToolStatus =
        metadata.outcome === 'completed' || metadata.outcome === 'blocked' ? metadata.outcome : 'failed'
      if (this.lastToolId === metadata.executionId) this.lastTool = { name, ts: entry.ts, status }
      if (status === 'failed') this.lastError = { message: `Tool execution failed: ${name}`, ts: entry.ts }
      this.refreshPhase(status === 'failed' ? 'Idle' : 'Settled')
      return true
    }
    if (entry.category === 'safety_block' && typeof metadata?.tool === 'string') {
      this.lastToolId = null
      this.lastTool = { name: metadata.tool, ts: entry.ts, status: 'blocked' }
      return true
    }
    if (entry.category === 'decision_recorded') {
      this.lastDecision = { summary: entry.message, ts: entry.ts }
      return true
    }
    if (entry.level === 'error') {
      this.lastError = { message: entry.message, ts: entry.ts }
      return true
    }
    return false
  }

  /** Snapshot copies prevent consumers from mutating execution state. */
  snapshot(): Pick<
    IpcStateSnapshot,
    'phase' | 'phaseSince' | 'lastDecision' | 'lastTool' | 'confidence' | 'lastError'
  > {
    return {
      phase: this.phase,
      phaseSince: this.phaseSince,
      lastDecision: this.lastDecision ? { ...this.lastDecision } : null,
      lastTool: this.lastTool ? { ...this.lastTool } : null,
      confidence: null,
      lastError: this.lastError ? { ...this.lastError } : null,
    }
  }

  private timestamp(): string {
    return new Date(this.now()).toISOString()
  }

  private refreshPhase(finished: Phase = 'Evaluating'): void {
    const next = [...this.tools.values()].some((name) => PORTFOLIO_TOOLS.has(name))
      ? 'Rebalancing'
      : this.activities.size > 0 || this.tools.size > 0
        ? 'Evaluating'
        : finished
    if (this.phase !== next) {
      this.phase = next
      this.phaseSince = this.timestamp()
    }
  }
}

/** Finite observations only: missing/empty values never become fabricated zeros. */
function finiteObservation(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null
  try {
    const text = typeof value === 'number' ? undefined : String(value).trim()
    if (text === '') return null
    const number = typeof value === 'number' ? value : Number(text)
    return Number.isFinite(number) ? number : null
  } catch {
    return null
  }
}

function binObservation(value: unknown): number | null {
  const number = finiteObservation(value)
  return number !== null && Number.isInteger(number) ? number : null
}

/** Convert measured raw SDK amounts only when measured mint decimals are available. */
function humanAmount(raw: unknown, decimals: unknown): number | null {
  const amount = finiteObservation(raw)
  const scale = finiteObservation(decimals)
  if (amount === null || amount < 0 || scale === null || !Number.isInteger(scale) || scale < 0 || scale > 255)
    return null
  const human = amount / 10 ** scale
  return Number.isFinite(human) ? human : null
}

/** Projection of already-fetched observations. No price/RPC requests and no historical active-bin fallback. */
export function projectPositionTelemetry(input: {
  lowerBin?: unknown
  upperBin?: unknown
  activeBin?: unknown
  inRange?: unknown
  tokenXRaw?: unknown
  tokenYRaw?: unknown
  tokenXDecimals?: unknown
  tokenYDecimals?: unknown
}): PositionTelemetry {
  const lowerBin = binObservation(input.lowerBin)
  const upperBin = binObservation(input.upperBin)
  const activeBin = binObservation(input.activeBin)
  const validBounds = lowerBin !== null && upperBin !== null && lowerBin <= upperBin
  const inRange =
    validBounds && activeBin !== null
      ? activeBin >= lowerBin && activeBin <= upperBin
      : typeof input.inRange === 'boolean'
        ? input.inRange
        : null
  const tokenXAmount = humanAmount(input.tokenXRaw, input.tokenXDecimals)
  const tokenYAmount = humanAmount(input.tokenYRaw, input.tokenYDecimals)
  return {
    lowerBin: validBounds ? lowerBin : null,
    upperBin: validBounds ? upperBin : null,
    activeBin,
    inRange,
    assetSplit: tokenXAmount !== null && tokenYAmount !== null ? { tokenXAmount, tokenYAmount } : null,
  }
}

/** A cached position carries only fields explicitly projected from a live source. */
export function cachedPositionTelemetry(live: Record<string, unknown> | undefined): PositionTelemetry {
  const data = live?.visualization
  if (!data || typeof data !== 'object' || Array.isArray(data)) return projectPositionTelemetry({})
  const source = data as PositionTelemetry
  const bins = projectPositionTelemetry(source)
  const x = finiteObservation(source.assetSplit?.tokenXAmount)
  const y = finiteObservation(source.assetSplit?.tokenYAmount)
  return {
    ...bins,
    assetSplit: x !== null && x >= 0 && y !== null && y >= 0 ? { tokenXAmount: x, tokenYAmount: y } : null,
  }
}

/** UI-only USD selection. Legacy *_usd fields can actually contain SOL in solMode. */
export function observedUsd(trueUsd: unknown, legacyValue: unknown, solMode: boolean): number | undefined {
  const measured = finiteObservation(trueUsd)
  if (measured !== null) return measured
  return solMode ? undefined : (finiteObservation(legacyValue) ?? undefined)
}

/** Aggregate only a complete set of USD observations; false marks the wire placeholder as unknown. */
export function observedPnlTotal(positions: readonly Pick<IpcPositionSummary, 'pnlUsd'>[]): {
  totalPnlUsd: number
  totalPnlUsdKnown: boolean
} {
  const known = positions.every((position) => typeof position.pnlUsd === 'number' && Number.isFinite(position.pnlUsd))
  return {
    totalPnlUsd: known
      ? Math.round(positions.reduce((sum, position) => sum + (position.pnlUsd ?? 0), 0) * 100) / 100
      : 0,
    totalPnlUsdKnown: known,
  }
}
