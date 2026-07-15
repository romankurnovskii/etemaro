import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, dataPath } from './constants.js';

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

function getLogPath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(logsDir, `agent-${date}.log`);
}

function getAuditPath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(logsDir, `actions-${date}.jsonl`);
}

/**
 * Core log function — writes to daily rotating log file.
 */
export function log(level: string, message: string): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${message}\n`;
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
    ...entry,
  };
  try {
    fs.appendFileSync(getAuditPath(), JSON.stringify(record) + '\n');
  } catch {
    /* ignore */
  }
}
