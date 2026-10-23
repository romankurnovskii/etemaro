import type { LogEntry, ManagedAgent, PositionSummary } from './ipc'

/** Managed children have dedicated IPC ports; never fall back to the parent. */
export function agentWsUrl(agent: ManagedAgent, parentUrl: string): string | null {
  if (
    !agent.running ||
    !Number.isInteger(agent.ipcPort) ||
    !agent.ipcPort ||
    agent.ipcPort < 1 ||
    agent.ipcPort > 65535
  )
    return null
  const url = new URL(parentUrl)
  const parentPort = Number(url.port || (url.protocol === 'wss:' ? 443 : 80))
  if (agent.ipcPort === parentPort) return null
  url.port = String(agent.ipcPort)
  url.search = ''
  url.hash = ''
  return url.toString()
}

export function logLevel(log: LogEntry): 'info' | 'warn' | 'error' {
  if (log.category === 'error' || log.category.endsWith('_error')) return 'error'
  if (
    log.category === 'warn' ||
    log.category.endsWith('_warn') ||
    log.category === 'tool_blocked' ||
    log.category === 'safety_block'
  )
    return 'warn'
  return 'info'
}

export interface StrategyChange {
  path: string
  before: string
  after: string
}
export function strategyChanges(before: unknown, after: unknown): StrategyChange[] {
  const flatten = (input: unknown, path = '', out: Record<string, string> = {}) => {
    if (input !== null && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).length) {
      for (const [key, value] of Object.entries(input)) {
        if (key !== 'is_active') flatten(value, path ? `${path}.${key}` : key, out)
      }
    } else out[path || '(root)'] = JSON.stringify(input) ?? '(missing)'
    return out
  }
  const a = flatten(before)
  const b = flatten(after)
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .sort()
    .filter((path) => a[path] !== b[path])
    .map((path) => ({ path, before: a[path] ?? '(missing)', after: b[path] ?? '(missing)' }))
}

export function assetSplit(position: PositionSummary): number | null {
  const x = position.assetXValueUsd
  const y = position.assetYValueUsd
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x + y <= 0
  )
    return null
  return (x / (x + y)) * 100
}

export function binProgress(position: PositionSummary): number | null {
  const { lowerBin: lower, upperBin: upper, activeBin: active } = position
  if (
    typeof lower !== 'number' ||
    typeof upper !== 'number' ||
    typeof active !== 'number' ||
    ![lower, upper, active].every(Number.isFinite) ||
    lower > upper
  )
    return null
  if (lower === upper) return active === lower ? 50 : active < lower ? 0 : 100
  return Math.max(0, Math.min(100, ((active - lower) / (upper - lower)) * 100))
}

export function elapsed(since: string | undefined, now = Date.now()): string {
  if (!since || !Number.isFinite(Date.parse(since))) return 'Not reported'
  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000))
  return seconds < 60
    ? `${seconds}s`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m`
      : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}
