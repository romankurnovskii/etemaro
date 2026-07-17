import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, dataPath } from './constants.js';
import { getAgentIdForRequests } from '../adapters/external/AgentMeridianClient.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';
const minLevel = LOG_LEVELS[currentLevel] ?? LOG_LEVELS.info;

const logsDir = dataPath('logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

function getAgentSlug(): string {
  return (getAgentIdForRequests() || 'agent-local').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function getLogPath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(logsDir, `agent-${getAgentSlug()}-${date}.log`);
}

function getAuditPath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(logsDir, `actions-${getAgentSlug()}-${date}.jsonl`);
}

/**
 * Core log function — writes to a per-agent daily rotating log file so that
 * multiple agents/processes sharing the same data dir don't interleave lines.
 * The agent id is embedded in every line for traceability.
 */
export function log(level: string, message: string): void {
  const ts = new Date().toISOString();
  const agentId = getAgentIdForRequests();
  const line = `[${ts}] [${level}] [${agentId}] ${message}\n`;
  try {
    fs.appendFileSync(getLogPath(), line);
  } catch {
    /* ignore */
  }
  if (LOG_LEVELS[level as LogLevel] !== undefined && LOG_LEVELS[level as LogLevel] >= minLevel) {
    process.stdout.write(line);
  }
}

export interface LogActionEntry {
  tool: string;
  args?: Record<string, unknown>;
  result?: unknown;
  duration_ms?: number;
  success?: boolean;
  error?: string;
}

/**
 * Write a structured audit trail entry (JSONL).
 */
export function logAction(entry: LogActionEntry): void {
  const record = {
    ts: new Date().toISOString(),
    agentId: getAgentIdForRequests(),
    ...entry,
  };
  try {
    fs.appendFileSync(getAuditPath(), JSON.stringify(record) + '\n');
  } catch {
    /* ignore */
  }
}
