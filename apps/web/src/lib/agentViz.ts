/**
 * Pure, dependency-free logic for Agent Visualizer derivations.
 *
 * Derivation logic:
 * - phase derivation: daemon `phase` field when available, heuristic fallback
 * - status derivation: running/idle/stopped/error
 * - write-tool pairing for Rebalancing detection
 * - strategy diff
 * - severity / category grouping
 * - bin-range math
 */

import type { LogEntry, PositionSummary, StateSnapshot } from './ipc'

// ─── Phase / pipeline ─────────────────────────────────────────────────────────
export type Phase = 'idle' | 'evaluating' | 'rebalancing' | 'settled'
export type PhaseSource = 'daemon' | 'inferred'

/** Tools that constitute a "write" / rebalancing action in the daemon. */
const WRITE_TOOLS = new Set([
  'deploy_position',
  'close_position',
  'rebalance_position',
  'update_position',
  'compound_fees',
  'swap_tokens',
])

/** Derive the pipeline phase for a single agent.
 *
 * Priority:
 * 1. `snapshot.phase` (daemon-published, authoritative) → evaluating or idle
 * 2. Open `tool_start` for a write tool with no matching `tool_finish` → rebalancing
 * 3. Last write tool finished within 2 min and phase is idle → settled
 * 4. Heuristic from own log categories (only as fallback for older daemons)
 */
export function derivePhase(logs: LogEntry[], snapshot: StateSnapshot | null): { phase: Phase; source: PhaseSource } {
  // 1. Daemon-published phase
  if (snapshot?.phase) {
    const dp = snapshot.phase
    if (dp === 'screening' || dp === 'managing') return { phase: 'evaluating', source: 'daemon' }
    if (dp === 'chat') return { phase: 'idle', source: 'daemon' }
    // idle: check for open write tool below, else idle
  }

  // 2. Write-tool pairing (structured tool_start / tool_finish in log metadata)
  const openWriteTool = findOpenWriteTool(logs)
  if (openWriteTool) return { phase: 'rebalancing', source: snapshot?.phase != null ? 'daemon' : 'inferred' }

  // 3. Settled: last write tool finished within 2 min
  const lastWriteFinish = findLastWriteToolFinish(logs)
  if (lastWriteFinish && Date.now() - lastWriteFinish < 2 * 60 * 1000) {
    return { phase: 'settled', source: snapshot?.phase != null ? 'daemon' : 'inferred' }
  }

  // 4. Heuristic fallback for older daemons without phase field
  if (!snapshot?.phase) {
    const recent = logs.slice(-40)
    for (let i = recent.length - 1; i >= 0; i--) {
      const entry = recent[i]
      if (!entry) continue
      const cat = entry.category
      if (/screen/.test(cat) || /manag/.test(cat)) return { phase: 'evaluating', source: 'inferred' }
      const toolName = (entry.metadata as Record<string, unknown> | undefined)?.tool
      if (typeof toolName === 'string' && WRITE_TOOLS.has(toolName)) return { phase: 'rebalancing', source: 'inferred' }
    }
  }

  return { phase: 'idle', source: snapshot?.phase != null ? 'daemon' : 'inferred' }
}

function findOpenWriteTool(logs: LogEntry[]): string | null {
  // Walk logs in reverse; find tool_start with no subsequent tool_finish for same tool
  const recent = logs.slice(-100)
  const open = new Map<string, number>() // correlationId → index

  for (let i = 0; i < recent.length; i++) {
    const entry = recent[i]
    if (!entry) continue
    const meta = entry.metadata as Record<string, unknown> | undefined
    if (!meta) continue
    if (meta.event === 'tool_start' && typeof meta.tool === 'string' && WRITE_TOOLS.has(meta.tool)) {
      const cid = String(meta.correlationId ?? i)
      open.set(cid, i)
    } else if (meta.event === 'tool_finish') {
      const cid = String(meta.correlationId ?? '')
      if (cid) open.delete(cid)
    }
  }

  for (const [, idx] of open) {
    const entry = recent[idx]
    if (!entry) continue
    const meta = entry.metadata as Record<string, unknown>
    return String(meta.tool ?? '')
  }
  return null
}

function findLastWriteToolFinish(logs: LogEntry[]): number | null {
  const recent = logs.slice(-100)
  for (let i = recent.length - 1; i >= 0; i--) {
    const entry = recent[i]
    if (!entry) continue
    const meta = entry.metadata as Record<string, unknown> | undefined
    if (!meta) continue
    if (meta.event === 'tool_finish' && typeof meta.tool === 'string' && WRITE_TOOLS.has(meta.tool)) {
      const ts = entry.ts
      if (ts) return new Date(ts).getTime()
    }
  }
  return null
}

// ─── Agent status ─────────────────────────────────────────────────────────────
export type AgentStatus = 'running' | 'idle' | 'stopped' | 'error'

export function deriveStatus(running: boolean, logs: LogEntry[], snapshot: StateSnapshot | null): AgentStatus {
  if (!running) return 'stopped'
  // Recent error in own logs
  const recent = logs.slice(-20)
  if (recent.some((l) => /error/.test(l.category))) return 'error'
  // Daemon phase or busy → running
  if (snapshot?.phase && snapshot.phase !== 'idle') return 'running'
  if (snapshot?.busy) return 'running'
  // Has heartbeat-equivalent (any recent log)
  if (recent.length > 0) return 'running'
  return 'idle'
}

// ─── Last heartbeat ───────────────────────────────────────────────────────────
/** ms since last message, or null if no messages yet. */
export function lastHeartbeatMs(lastMessageAt: number | null): number | null {
  return lastMessageAt != null ? Date.now() - lastMessageAt : null
}

export function fmtHeartbeat(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 5000) return 'just now'
  if (ms < 60000) return `${Math.floor(ms / 1000)}s ago`
  return `${Math.floor(ms / 60000)}m ago`
}

// ─── Uptime ───────────────────────────────────────────────────────────────────
export function fmtUptime(startedAt: string | null | undefined, now: number): string {
  if (!startedAt) return '—'
  const ms = now - new Date(startedAt).getTime()
  if (Number.isNaN(ms) || ms < 0) return '—'
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

// ─── Execution summary ────────────────────────────────────────────────────────
export interface ExecSummary {
  lastTool: string | null
  lastToolArgs: string | null
  lastDecision: string | null
  confidence: number | null
}

export function deriveExecSummary(logs: LogEntry[]): ExecSummary {
  let lastTool: string | null = null
  let lastToolArgs: string | null = null
  let lastDecision: string | null = null
  let confidence: number | null = null

  for (let i = logs.length - 1; i >= 0; i--) {
    const logEntry = logs[i]
    if (!logEntry) continue
    const meta = logEntry.metadata as Record<string, unknown> | undefined
    if (!meta) continue
    if (lastTool == null && meta.event === 'tool_start' && typeof meta.tool === 'string') {
      lastTool = meta.tool
      lastToolArgs = meta.args != null ? JSON.stringify(meta.args).slice(0, 80) : null
    }
    if (lastDecision == null && meta.event === 'agent_reply' && typeof meta.text === 'string') {
      lastDecision = meta.text.slice(0, 120)
    }
    if (confidence == null && typeof meta.confidence === 'number') {
      confidence = meta.confidence
    }
    if (lastTool != null && lastDecision != null) break
  }

  return { lastTool, lastToolArgs, lastDecision, confidence }
}

// ─── Strategy diff ────────────────────────────────────────────────────────────
/** Fields to omit from the diff (volatile timestamps). */
const DIFF_IGNORE = new Set(['addedAt', 'updatedAt', 'created_at', 'updated_at'])

export type DiffRowKind = 'changed' | 'added' | 'removed'
export interface DiffRow {
  key: string
  kind: DiffRowKind
  from: string
  to: string
}

/** Recursively flatten a nested object into dot-notation keys. Stops at arrays/primitives. */
function flattenObject(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flattenObject(v as Record<string, unknown>, fullKey))
    } else {
      out[fullKey] = v
    }
  }
  return out
}

export function strategyDiff(
  current: Record<string, unknown> | null,
  target: Record<string, unknown> | null,
): DiffRow[] {
  if (!current || !target) return []
  // Flatten so nested params (e.g. range.min) diff individually, not as a blob.
  const flatCurrent = flattenObject(current)
  const flatTarget = flattenObject(target)
  const allKeys = new Set([...Object.keys(flatCurrent), ...Object.keys(flatTarget)]).values()
  const rows: DiffRow[] = []
  for (const key of allKeys) {
    if (DIFF_IGNORE.has(key.split('.')[0] ?? key)) continue
    const from = flatCurrent[key]
    const to = flatTarget[key]
    const fromStr = from != null ? JSON.stringify(from) : undefined
    const toStr = to != null ? JSON.stringify(to) : undefined
    if (fromStr === toStr) continue
    if (fromStr == null) rows.push({ key, kind: 'added', from: '', to: toStr ?? '' })
    else if (toStr == null) rows.push({ key, kind: 'removed', from: fromStr, to: '' })
    else rows.push({ key, kind: 'changed', from: fromStr, to: toStr })
  }
  return rows
}

// ─── Log severity ─────────────────────────────────────────────────────────────
export type LogSeverity = 'error' | 'warn' | 'info'

/** Mirror the daemon logger's own category→severity rule (logger.ts:217-219). */
export function logSeverity(entry: LogEntry): LogSeverity {
  const cat = entry.category ?? ''
  if (/error/.test(cat)) return 'error'
  if (/warn/.test(cat)) return 'warn'
  return 'info'
}

// ─── Bin-range math ───────────────────────────────────────────────────────────
export interface BinBarSegment {
  idx: number
  kind: 'in-range' | 'out-range' | 'active-in' | 'active-out'
}

/** Build segments for the bin-range visualization.
 * Returns null if any required field is missing (never fakes data).
 */
export function buildBinSegments(pos: PositionSummary): BinBarSegment[] | null {
  const { lowerBin, upperBin, activeBin, inRange } = pos
  if (lowerBin == null || upperBin == null || activeBin == null) return null

  const lo = Math.min(lowerBin, upperBin)
  const hi = Math.max(lowerBin, upperBin)
  const span = hi - lo + 1
  if (span <= 0 || span > 200) return null // guard against bogus data

  const SLOTS = Math.min(span, 20)
  const step = span / SLOTS
  const segments: BinBarSegment[] = []

  for (let i = 0; i < SLOTS; i++) {
    const binStart = lo + i * step
    const binEnd = lo + (i + 1) * step
    // Half-open [binStart, binEnd) so each bin maps to exactly one segment.
    // The range check below uses <= on both sides — intentionally different.
    const isActive = activeBin >= binStart && activeBin < binEnd
    const kind: BinBarSegment['kind'] = isActive
      ? inRange
        ? 'active-in'
        : 'active-out'
      : activeBin >= lo && activeBin <= hi
        ? 'in-range'
        : 'out-range'
    segments.push({ idx: i, kind })
  }
  return segments
}
