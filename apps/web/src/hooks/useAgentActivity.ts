import { useMemo, useRef } from 'react'
import type { LogEntry, ManagedAgent } from '../lib/ipc'

/** The four canonical phases of the Etemaro agent loop, plus runtime states. */
export type AgentPhase = 'idle' | 'evaluating' | 'rebalancing' | 'settled' | 'error'

/** Ordered pipeline used by the visualizer: Idle → Evaluating → Rebalancing → Settled. */
export const PHASE_PIPELINE: AgentPhase[] = ['idle', 'evaluating', 'rebalancing', 'settled']

export interface AgentActivity {
  /** Current derived phase of the agent loop. */
  phase: AgentPhase
  /** Epoch ms of the last phase transition (or null when unknown). */
  phaseSince: number | null
  /** ISO ts of the most recent log line emitted by this agent. */
  lastHeartbeat: string | null
  /** Name of the last tool the agent invoked (from `tool_start` metadata). */
  lastTool: string | null
  /** Human summary of the agent's last completed decision cycle. */
  lastDecision: string | null
  /** Most recent error message, if the agent is in the error phase. */
  error: string | null
  /** Active pair/pool symbol, best-effort from recent telemetry. */
  activePair: string | null
  /** Number of log lines observed this session. */
  events: number
  /** Epoch ms when the agent was first seen running this session (uptime anchor). */
  runningSince: number | null
}

const EMPTY_ACTIVITY: AgentActivity = {
  phase: 'idle',
  phaseSince: null,
  lastHeartbeat: null,
  lastTool: null,
  lastDecision: null,
  error: null,
  activePair: null,
  events: 0,
  runningSince: null,
}

/** How long an agent stays "active" after its last event before falling back to idle. */
const ACTIVITY_TIMEOUT_MS = 90_000

/** Map a log category to a phase transition. */
function phaseForCategory(category: string): AgentPhase | null {
  if (category.endsWith('_error') || category.endsWith('_fail')) return 'error'
  if (category === 'agent_loop_start' || category === 'tool_start' || category === 'screening') {
    return 'evaluating'
  }
  if (
    category.startsWith('swap_') ||
    category.startsWith('tx_') ||
    category === 'position_opened' ||
    category === 'position_closed'
  ) {
    return 'rebalancing'
  }
  if (category === 'agent_loop_end' || category === 'swap_finish') return 'settled'
  return null
}

/** Extract a pair/pool hint out of a log's message or metadata. */
function pairFromLog(entry: LogEntry): string | null {
  const meta = entry.metadata
  if (meta && typeof meta === 'object') {
    const pair = (meta as Record<string, unknown>).pair
    if (typeof pair === 'string' && pair) return pair
    const pool = (meta as Record<string, unknown>).pool
    if (typeof pool === 'string' && pool) return pool
  }
  // SOL is the quote side of every Meteora DLMM pool; "SOL" appearing in a
  // market message usually identifies the active pair, e.g. "BONK/SOL".
  const match = entry.message.match(/\b([A-Z0-9]{2,10})\/SOL\b/)
  return match ? match[0] : null
}

function toolFromLog(entry: LogEntry): string | null {
  if (entry.category !== 'tool_start') return null
  const meta = entry.metadata
  if (meta && typeof meta === 'object') {
    const tool = (meta as Record<string, unknown>).tool
    if (typeof tool === 'string' && tool) return tool
  }
  const match = entry.message.match(/Tool executing: (\S+)/)
  return match?.[1] ?? null
}

/**
 * Derives live per-agent runtime activity from the WebSocket log stream.
 * Pure derivation on top of the existing telemetry — no new protocol needed.
 */
export function useAgentActivity(logs: LogEntry[], agents: ManagedAgent[]): Record<string, AgentActivity> {
  // Uptime anchors survive log list churn (the connection hook caps logs at 500).
  const anchorsRef = useRef<Map<string, number>>(new Map())
  const now = Date.now()

  // Track running transitions for uptime anchors.
  for (const agent of agents) {
    if (agent.running && !anchorsRef.current.has(agent.id)) {
      anchorsRef.current.set(agent.id, now)
    }
    if (!agent.running) {
      anchorsRef.current.delete(agent.id)
    }
  }

  return useMemo(() => {
    const byAgent = new Map<string, AgentActivity>()
    for (const agent of agents) {
      const anchor = anchorsRef.current.get(agent.id) ?? null
      byAgent.set(agent.id, { ...EMPTY_ACTIVITY, runningSince: agent.running ? anchor : null })
    }

    // Replay the log window chronologically; later events win.
    for (const entry of logs) {
      const id = entry.agentId
      if (!id) continue
      let activity = byAgent.get(id)
      if (!activity) {
        activity = { ...EMPTY_ACTIVITY }
        byAgent.set(id, activity)
      }
      activity.events += 1
      activity.lastHeartbeat = entry.ts
      const tool = toolFromLog(entry)
      if (tool) activity.lastTool = tool
      const pair = pairFromLog(entry)
      if (pair) activity.activePair = pair
      const phase = phaseForCategory(entry.category)
      if (phase) {
        activity.phase = phase
        activity.phaseSince = Date.parse(entry.ts) || null
      }
      if (phase === 'error') activity.error = entry.message
      if (phase !== 'error' && entry.category !== 'agent_loop_error') activity.error = null
      if (entry.category === 'agent_loop_end') {
        activity.lastDecision = entry.message
      }
    }

    // Agents whose last event is stale drop back to idle (unless stopped/errored).
    for (const [id, activity] of byAgent) {
      const agent = agents.find((a) => a.id === id)
      if (!agent) continue
      if (activity.phase === 'error' || activity.phase === 'idle' || activity.phase === 'settled') continue
      if (!activity.lastHeartbeat) continue
      const last = Date.parse(activity.lastHeartbeat)
      if (Number.isFinite(last) && now - last > ACTIVITY_TIMEOUT_MS) {
        activity.phase = 'idle'
        activity.phaseSince = last
      }
    }

    return Object.fromEntries(byAgent)
  }, [logs, agents, now])
}

/** Format a duration (ms) as a compact human string like `1h 04m` or `42s`. */
export function formatUptime(fromMs: number | null, nowMs: number = Date.now()): string {
  if (!fromMs) return '—'
  const totalSeconds = Math.max(0, Math.floor((nowMs - fromMs) / 1000))
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  return `${seconds}s`
}

/** "32s ago" style relative time for heartbeats. */
export function formatSince(iso: string | null, nowMs: number = Date.now()): string {
  if (!iso) return '—'
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return '—'
  const delta = Math.max(0, Math.floor((nowMs - ts) / 1000))
  if (delta < 5) return 'just now'
  if (delta < 60) return `${delta}s ago`
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`
  return `${Math.floor(delta / 3600)}h ago`
}
