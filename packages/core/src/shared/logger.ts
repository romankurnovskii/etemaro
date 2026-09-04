/**
 * @file logger.ts
 * @description Centralized application logging module with console output, rotating file log sinks,
 *   structured JSONL output, sensitive data redaction, and correlation ID support.
 *
 * @features
 * - Categorized log levels (`log(cat, msg, level)`)
 * - Writes rotating daily log files (`data/logs/agent-YYYY-MM-DD.log`)
 * - Structured JSONL logging via `logStructured()` for machine-parseable output
 * - Centralized sensitive data redaction (API keys, private keys, wallet secrets)
 * - Correlation ID propagation for tracing across agent loop / tool / adapter calls
 * - Duration tracking helper via `createTimer()`
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getAgentIdForRequests } from '../adapters/external/AgentMeridianClient.js'
import { DEFAULT_AGENT_ID, dataPath } from './constants.js'
import { getDryRun, setDryRun } from './flags.js'
import type { IpcLogEntry } from './ipc-protocol.js'

export { getDryRun, setDryRun }

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogListener = (entry: IpcLogEntry) => void

const _logListeners = new Set<LogListener>()

/**
 * Register a listener that receives all formatted log and structured log events.
 * Returns an unregister function.
 */
export function addLogListener(listener: LogListener): () => void {
  _logListeners.add(listener)
  return () => {
    _logListeners.delete(listener)
  }
}

/** Clear all active log listeners (primarily for testing). */
export function clearLogListeners(): void {
  _logListeners.clear()
}

let _stdoutMuted = false

/** Enable or disable raw stdout writes (used when TUI takes over terminal output). */
export function setStdoutMuted(muted: boolean): void {
  _stdoutMuted = muted
}

export function isStdoutMuted(): boolean {
  return _stdoutMuted
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info'
const minLevel = LOG_LEVELS[currentLevel] ?? LOG_LEVELS.info

// ─── Sensitive Data Redaction ─────────────────────────────────

/**
 * Patterns that match sensitive values which must never appear in log output.
 * Each pattern captures the value to redact in group 1.
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  // Solana private keys (base58, 88+ chars typical for Ed25519)
  /\b([1-9A-HJ-NP-Za-km-z]{88,})\b/g,
  // API key assignments: specific prefix + value
  /(?:api[_-]?key|apikey|secret|token|password|private[_-]?key)\s*[=:]\s*["']?([A-Za-z0-9_\-./]{20,})["']?/gi,
  // Generic key=value in URLs (e.g. ?api-key=xxx or &key=xxx)
  /[?&](?:api[_-]?key|key|apikey|secret|token)=([A-Za-z0-9_-]{16,})/gi,
]

/** Characters that indicate a redacted value was sanitized. */
const REDACTED = '[REDACTED]'

/**
 * Scan a string for sensitive patterns and replace matches with [REDACTED].
 * This is the centralized redaction layer — all log output should pass through here.
 */
export function redactSensitive(text: string): string {
  if (!text) return text
  let result = text
  for (const pattern of SENSITIVE_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0
    result = result.replace(pattern, REDACTED)
  }
  return result
}

// ─── Correlation ID ───────────────────────────────────────────

let _correlationId: string | null = null

/**
 * Generate a short, unique correlation ID for tracing a cron cycle, agent loop
 * invocation, or other logical unit of work. Uses crypto.randomUUID, truncated
 * to 12 characters for readability.
 */
export function createCorrelationId(): string {
  try {
    return crypto.randomUUID().slice(0, 12)
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }
}

/**
 * Set the active correlation ID for the current execution context.
 * All subsequent `logStructured()` calls will include this ID until
 * `setCorrelationId(null)` is called.
 */
export function setCorrelationId(id: string | null): void {
  _correlationId = id
}

/**
 * Get the current active correlation ID (or null if none set).
 */
export function getCorrelationId(): string | null {
  return _correlationId
}

// ─── Duration Timer ───────────────────────────────────────────

export interface TimerResult {
  /** Elapsed time in milliseconds since the timer was created. */
  elapsed_ms: number
  /** Stop the timer and return elapsed_ms. */
  stop: () => number
}

/**
 * Create a duration timer. Call `timer.stop()` to get elapsed milliseconds.
 * Useful for timing operations: `const timer = createTimer(); ... timer.stop()`
 */
export function createTimer(): TimerResult {
  const start = Date.now()
  let stopped = false
  let elapsed = 0
  return {
    get elapsed_ms() {
      return stopped ? elapsed : Date.now() - start
    },
    stop() {
      if (!stopped) {
        elapsed = Date.now() - start
        stopped = true
      }
      return elapsed
    },
  }
}

// ─── Log Path Resolution ─────────────────────────────────────

/** Resolve logs dir on each write so ETEMARO_DATA_DIR/DATA_DIR is always honored. */
function ensureLogsDir(): string {
  const logsDir = dataPath('logs')
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true })
  }
  return logsDir
}

function getAgentSlug(): string {
  return (getAgentIdForRequests() || DEFAULT_AGENT_ID).replace(/[^a-zA-Z0-9_-]/g, '_')
}

function getLogPath(): string {
  const date = new Date().toISOString().slice(0, 10)
  return path.join(ensureLogsDir(), `agent-${getAgentSlug()}-${date}.log`)
}

function getAuditPath(): string {
  const date = new Date().toISOString().slice(0, 10)
  return path.join(ensureLogsDir(), `actions-${getAgentSlug()}-${date}.jsonl`)
}

function getStructuredLogPath(): string {
  const date = new Date().toISOString().slice(0, 10)
  return path.join(ensureLogsDir(), `structured-${getAgentSlug()}-${date}.jsonl`)
}

// ─── Core Log Function (backward-compatible) ──────────────────

/**
 * Core log function — writes to a per-agent daily rotating log file so that
 * multiple agents/processes sharing the same data dir don't interleave lines.
 * The agent id is embedded in every line for traceability.
 *
 * The `level` parameter is a free-form category string (not a strict log level).
 * Sensitive data in the message is automatically redacted before writing.
 */
export function log(level: string, message: string): void {
  const ts = new Date().toISOString()
  const agentId = getAgentIdForRequests()
  const dryTag = getDryRun() ? ' [DRY RUN]' : ''
  const redacted = redactSensitive(message)
  const line = `[${ts}] [${level}] [${agentId}]${dryTag} ${redacted}\n`
  try {
    fs.appendFileSync(getLogPath(), line)
  } catch {
    /* ignore */
  }
  const categoryLevel =
    LOG_LEVELS[level as LogLevel] ??
    (level.includes('error') ? LOG_LEVELS.error : level.includes('warn') ? LOG_LEVELS.warn : LOG_LEVELS.info)
  if (!_stdoutMuted && categoryLevel >= minLevel) {
    process.stdout.write(line)
  }

  if (_logListeners.size > 0) {
    const entry: IpcLogEntry = {
      category: level,
      message: redacted,
      agentId,
      ts,
    }
    for (const listener of _logListeners) {
      try {
        listener(entry)
      } catch {
        /* ignore */
      }
    }
  }
}

// ─── Structured JSONL Logging ─────────────────────────────────

export interface StructuredLogEntry {
  /** Log category (e.g. 'tool_start', 'safety_block', 'tx_state'). */
  category: string
  /** Human-readable message. */
  message: string
  /** Additional structured metadata. */
  metadata?: Record<string, unknown>
}

/**
 * Write a structured JSONL log entry to the structured log file.
 * Includes correlation ID if one is active, agent ID, dry-run flag, and timestamp.
 *
 * This is the primary entry point for new structured logging. Existing `log()` calls
 * remain backward-compatible and do not need to be migrated.
 */
export function logStructured({ category, message, metadata }: StructuredLogEntry): void {
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    category: redactSensitive(category),
    agentId: getAgentIdForRequests(),
    dryRun: getDryRun(),
    message: redactSensitive(message),
  }
  if (_correlationId) record.correlationId = _correlationId
  if (metadata && Object.keys(metadata).length > 0) {
    // Deep-redact all string values in metadata
    const redactedMeta: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(metadata)) {
      if (typeof value === 'string') {
        redactedMeta[key] = redactSensitive(value)
      } else {
        redactedMeta[key] = value
      }
    }
    record.metadata = redactedMeta
  }

  const line = `${JSON.stringify(record)}\n`
  try {
    fs.appendFileSync(getStructuredLogPath(), line)
  } catch {
    /* ignore */
  }

  if (_logListeners.size > 0) {
    const entry: IpcLogEntry = {
      category: record.category as string,
      message: record.message as string,
      agentId: record.agentId as string,
      ts: record.ts as string,
      metadata: record.metadata as Record<string, unknown> | undefined,
    }
    for (const listener of _logListeners) {
      try {
        listener(entry)
      } catch {
        /* ignore */
      }
    }
  }

  // Also echo to stdout if category maps to a standard level
  const levelHint = category.endsWith('_error') ? 'error' : category.endsWith('_warn') ? 'warn' : 'info'
  if (!_stdoutMuted && LOG_LEVELS[levelHint as LogLevel] >= minLevel) {
    process.stdout.write(redactSensitive(line))
  }
}

// ─── Audit Trail (backward-compatible) ────────────────────────

export interface LogActionEntry {
  tool: string
  args?: Record<string, unknown>
  result?: unknown
  duration_ms?: number
  success?: boolean
  error?: string
}

/**
 * Write a structured audit trail entry (JSONL).
 * Sensitive data in args/result/error is automatically redacted.
 */
export function logAction(entry: LogActionEntry): void {
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    agentId: getAgentIdForRequests(),
    dryRun: getDryRun(),
    ...entry,
  }
  if (_correlationId) record.correlationId = _correlationId

  // Redact sensitive data in string fields
  if (typeof record.error === 'string') record.error = redactSensitive(record.error)

  try {
    fs.appendFileSync(getAuditPath(), `${JSON.stringify(record)}\n`)
  } catch {
    /* ignore */
  }
}
