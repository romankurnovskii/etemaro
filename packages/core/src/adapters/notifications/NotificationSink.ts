/**
 * @file NotificationSink.ts
 * @description Append-only sink that writes structured desktop notifications to
 * `data/notifications.jsonl`. Each call appends exactly one JSON line.
 *
 * This module is intentionally side-effect-only: it never throws, never affects
 * the Telegram notification path, and requires zero config.
 *
 * The file is consumed by the Tauri v2 desktop app via a file-watch mechanism.
 *
 * @schema  DesktopNotification — see exported interface below
 * @output  data/notifications.jsonl  (one JSON object per line, UTF-8, LF)
 */

import fs from 'node:fs';
import path from 'node:path';
import { dataPath } from '../../shared/constants.js';
import { log } from '../../shared/logger.js';

// ─── Types ────────────────────────────────────────────────────────

export type NotificationType = 'deploy' | 'close' | 'swap' | 'oor' | 'briefing' | 'message';

export interface DesktopNotification {
  /** ISO-8601 UTC timestamp */
  ts: string;
  /** Notification category */
  type: NotificationType;
  /** Emoji icon prefix */
  icon: string;
  /** Short headline (< 80 chars) */
  title: string;
  /** Full message body (mirrors Telegram text) */
  body: string;
}

// ─── Config ───────────────────────────────────────────────────────

const SINK_FILE: string = dataPath('notifications.jsonl');
/** Maximum file size before rotation (10 MB). Keeps the file manageable for the desktop app. */
const MAX_BYTES = 10 * 1024 * 1024;
/** Rotated file path */
const SINK_FILE_OLD: string = dataPath('notifications.jsonl.old');

// ─── Internal helpers ─────────────────────────────────────────────

function ensureDataDir(): void {
  const dir = path.dirname(SINK_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function rotateIfNeeded(): void {
  try {
    if (!fs.existsSync(SINK_FILE)) return;
    const { size } = fs.statSync(SINK_FILE);
    if (size < MAX_BYTES) return;
    // Overwrite the .old file with the current file then truncate
    fs.copyFileSync(SINK_FILE, SINK_FILE_OLD);
    fs.writeFileSync(SINK_FILE, '');
    log('notifications', 'notifications.jsonl rotated (exceeded 10 MB)');
  } catch (e: any) {
    // Rotation is best-effort — never surface errors
    log('notifications_warn', `Rotation check failed: ${e.message}`);
  }
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Append a single DesktopNotification line to `data/notifications.jsonl`.
 *
 * - Fire-and-forget: synchronous write, but all errors are caught and logged.
 * - Never throws — the Telegram path must not be affected.
 * - Thread-safe for single-process use (Node.js event loop is single-threaded).
 */
export function appendNotification(n: DesktopNotification): void {
  try {
    ensureDataDir();
    rotateIfNeeded();
    const line = JSON.stringify(n) + '\n';
    fs.appendFileSync(SINK_FILE, line, { encoding: 'utf8' });
  } catch (e: any) {
    // Intentionally swallowed — desktop sink must never break Telegram path
    log('notifications_warn', `Failed to write desktop notification: ${e.message}`);
  }
}

/**
 * Build and append a notification in one call.
 * Convenience wrapper used by TelegramAdapter notify* functions.
 */
export function notify(type: NotificationType, icon: string, title: string, body: string): void {
  appendNotification({
    ts: new Date().toISOString(),
    type,
    icon,
    title,
    body,
  });
}
