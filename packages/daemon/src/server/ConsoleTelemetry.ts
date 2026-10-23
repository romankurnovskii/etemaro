import type { IpcLogEntry, IpcPositionSummary, IpcStateSnapshot } from '@etemaro/core'

export class ConsoleTelemetry {
  phase: NonNullable<IpcStateSnapshot['phase']> = 'idle'
  lastTool: IpcStateSnapshot['lastTool']
  private readonly writes = new Set<string>()

  observe(entry: IpcLogEntry, writeTools: ReadonlySet<string>): boolean {
    const tool = entry.metadata?.tool
    const key = `${entry.correlationId ?? ''}:${String(tool)}:${String(entry.metadata?.step ?? '')}`
    if (entry.category === 'agent_loop_start') this.phase = this.writes.size ? 'rebalancing' : 'evaluating'
    else if (entry.category === 'agent_loop_error' || entry.category === 'agent_loop_end') {
      for (const pending of this.writes)
        if (pending.startsWith(`${entry.correlationId ?? ''}:`)) this.writes.delete(pending)
      this.phase = entry.category === 'agent_loop_error' ? 'error' : this.writes.size ? 'rebalancing' : 'settled'
    } else if (entry.category === 'tool_start' && typeof tool === 'string') {
      if (writeTools.has(tool)) this.writes.add(key)
      this.phase = this.writes.size ? 'rebalancing' : 'evaluating'
      this.lastTool = { name: tool, status: 'running', at: entry.ts }
    } else if ((entry.category === 'tool_finish' || entry.category === 'tool_blocked') && typeof tool === 'string') {
      this.writes.delete(key)
      this.phase = this.writes.size ? 'rebalancing' : 'evaluating'
      this.lastTool = {
        name: tool,
        status: entry.category === 'tool_blocked' || entry.metadata?.success === false ? 'failed' : 'completed',
        at: entry.ts,
      }
    } else return false
    return true
  }
}

export function livePositionFor(
  position: Record<string, unknown>,
  live: Record<string, unknown>[],
): Record<string, unknown> | undefined {
  const id = position.position ?? position.position_address
  if (typeof id !== 'string' || !id) return undefined
  return live.find((candidate) => (candidate.position ?? candidate.position_address) === id)
}

/** Add only measured values. Missing/null telemetry is never replaced with zero. */
export function positionTelemetry(live: Record<string, unknown> | undefined): Partial<IpcPositionSummary> {
  const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
  const lowerBin = number(live?.lower_bin)
  const upperBin = number(live?.upper_bin)
  const activeBin = number(live?.active_bin)
  const inRange =
    lowerBin != null && upperBin != null && activeBin != null
      ? activeBin >= lowerBin && activeBin <= upperBin
      : undefined
  return {
    lowerBin,
    upperBin,
    activeBin,
    inRange,
    assetXValueUsd: number(live?.asset_x_value_usd),
    assetYValueUsd: number(live?.asset_y_value_usd),
  }
}
