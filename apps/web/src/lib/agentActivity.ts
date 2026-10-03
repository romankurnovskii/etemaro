/**
 * Pure derivations of what one agent is doing, from that agent's own logs and
 * state snapshot. The daemon does not publish a loop phase, so the phase is
 * always an inference from log signals emitted by the daemon:
 *   - agent-loop.ts: `agent_loop_start`, `tool_start` (metadata.tool), `agent_loop_end`
 *   - Daemon.ts: `cron` "Starting screening/management cycle", "Management: all positions STAY"
 *   - MeteoraAdapter.ts: `deploy` / `close` (… "SUCCESS …")
 */
import type { LogEntry, StateSnapshot } from './ipc'
import { type LogRecord, severityOf } from './logs'

export type Phase = 'idle' | 'evaluating' | 'rebalancing' | 'settled'

export const PHASES: readonly Phase[] = ['idle', 'evaluating', 'rebalancing', 'settled']

export type AgentStatus = 'running' | 'idle' | 'stopped' | 'error'

export interface PhaseInference {
  /** null when no phase signal has been seen yet. */
  phase: Phase | null
  /** Always true: the daemon does not report phases directly. */
  inferred: true
  /** The log entry the phase was inferred from. */
  basis: LogEntry | null
}

const REBALANCE_CATEGORIES = new Set(['deploy', 'close', 'swap', 'swap_start', 'claim', 'tx_state'])

function toolName(entry: LogEntry): string | null {
  const tool = entry.metadata?.tool
  if (typeof tool === 'string' && tool) return tool
  const m = /^Tool executing: (\S+)/.exec(entry.message)
  return m?.[1] ?? null
}

/** Phase signalled by a single log entry, or null when the entry is not a phase signal. */
export function phaseSignal(entry: LogEntry, writeTools: ReadonlySet<string>): Phase | null {
  const { category, message } = entry
  if (category === 'agent_loop_end') return 'settled'
  if ((category === 'deploy' || category === 'close') && message.startsWith('SUCCESS')) return 'settled'
  if (category === 'cron' && message.startsWith('Management: all positions STAY')) return 'settled'
  if (REBALANCE_CATEGORIES.has(category)) return 'rebalancing'
  if (category === 'tool_start') {
    const name = toolName(entry)
    return name && writeTools.has(name) ? 'rebalancing' : 'evaluating'
  }
  if (category === 'agent_loop_start') return 'evaluating'
  if (category === 'cron' && /^Starting (screening|management) cycle/.test(message)) return 'evaluating'
  return null
}

/** Latest phase signal in this agent's logs (newest wins). */
export function inferPhase(logs: readonly LogRecord[], writeTools: ReadonlySet<string>): PhaseInference {
  for (let i = logs.length - 1; i >= 0; i--) {
    const entry = (logs[i] as LogRecord).entry
    const phase = phaseSignal(entry, writeTools)
    if (phase) return { phase, inferred: true, basis: entry }
  }
  return { phase: null, inferred: true, basis: null }
}

export interface AgentStatusInput {
  /** Process state from the supervisor (/api/agents). */
  running: boolean
  /** Whether this agent's own IPC stream is connected. */
  hasTelemetry: boolean
  snapshot: StateSnapshot | null
  logs: readonly LogRecord[]
  writeTools: ReadonlySet<string>
}

/**
 * Card status from this agent's own data only.
 *  - stopped: supervisor says the process is not running
 *  - running: process alive but no telemetry yet (cannot say more)
 *  - error: newest error-severity log is newer than the newest phase signal
 *  - running: snapshot.busy, or inferred phase is evaluating/rebalancing
 *  - idle: otherwise
 */
export function deriveStatus(input: AgentStatusInput): AgentStatus {
  if (!input.running) return 'stopped'
  if (!input.hasTelemetry) return 'running'
  let lastError = -1
  let lastSignal = -1
  for (let i = input.logs.length - 1; i >= 0 && (lastError < 0 || lastSignal < 0); i--) {
    const entry = (input.logs[i] as LogRecord).entry
    if (lastError < 0 && severityOf(entry.category) === 'error') lastError = i
    if (lastSignal < 0 && phaseSignal(entry, input.writeTools)) lastSignal = i
  }
  if (lastError > lastSignal) return 'error'
  if (input.snapshot?.busy) return 'running'
  const { phase } = inferPhase(input.logs, input.writeTools)
  return phase === 'evaluating' || phase === 'rebalancing' ? 'running' : 'idle'
}

/** Most recent tool the agent loop started. */
export function lastTool(logs: readonly LogRecord[]): { name: string; ts: string } | null {
  for (let i = logs.length - 1; i >= 0; i--) {
    const entry = (logs[i] as LogRecord).entry
    if (entry.category !== 'tool_start') continue
    const name = toolName(entry)
    if (name) return { name, ts: entry.ts }
  }
  return null
}

/**
 * Most recent decision text: an `agent_reply`, the agent-loop final answer
 * (the `agent` line following "Final answer reached"), or a `cron`
 * "Management: …" verdict.
 */
export function lastDecision(logs: readonly LogRecord[]): { text: string; ts: string } | null {
  for (let i = logs.length - 1; i >= 0; i--) {
    const entry = (logs[i] as LogRecord).entry
    if (entry.category === 'agent_reply') return { text: entry.message, ts: entry.ts }
    if (entry.category === 'cron' && entry.message.startsWith('Management:')) {
      return { text: entry.message, ts: entry.ts }
    }
    const prev = logs[i - 1]?.entry
    if (entry.category === 'agent' && prev?.category === 'agent' && prev.message === 'Final answer reached') {
      return { text: entry.message, ts: entry.ts }
    }
  }
  return null
}
