import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './constants.js';

// ─── Path Utilities ────────────────────────────────────────────

export { REPO_ROOT, repoPath, dataPath, configPath } from './constants.js';

// ─── Math Utilities ────────────────────────────────────────────

export function safeNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

export function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

/** Move current toward target by at most maxChange fraction. */
export function nudge(current: number, target: number, maxChange: number): number {
  const delta = target - current;
  const maxDelta = current * maxChange;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

export function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && isFinite(n);
}

// ─── String Utilities ──────────────────────────────────────────

export function sanitizeStoredText(text: unknown, maxLen = 280): string | null {
  if (text == null) return null;
  const cleaned = String(text)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[<>`]/g, '')
    .trim()
    .slice(0, maxLen);
  return cleaned || null;
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return '?';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(Math.round(n));
}

// ─── Config Utilities ──────────────────────────────────────────

export function numericConfig(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function nonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

// ─── JSON File Utilities ───────────────────────────────────────

export function loadJsonFile<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function saveJsonFile(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ─── Cooldown Utilities ────────────────────────────────────────

export function isOorCloseReason(reason: string | null | undefined): boolean {
  const text = String(reason || '')
    .trim()
    .toLowerCase();
  return text === 'oor' || text.includes('out of range');
}

export function isAdjustedWinRateExcludedReason(reason: string | null | undefined): boolean {
  const text = String(reason || '')
    .trim()
    .toLowerCase();
  return text.includes('out of range') || text.includes('pumped far above range') || text === 'oor';
}

// ─── Timeframe Screening Scales ──────────────────────────────────

export const TIMEFRAME_SCREENING_SCALES: Record<string, { minFeeActiveTvlRatio: number; minVolume: number }> = {
  '5m': { minFeeActiveTvlRatio: 0.02, minVolume: 500 },
  '30m': { minFeeActiveTvlRatio: 0.15, minVolume: 1_000 },
  '1h': { minFeeActiveTvlRatio: 0.2, minVolume: 10_000 },
  '2h': { minFeeActiveTvlRatio: 0.4, minVolume: 20_000 },
  '4h': { minFeeActiveTvlRatio: 0.4, minVolume: 2_000 },
  '12h': { minFeeActiveTvlRatio: 1.5, minVolume: 60_000 },
  '24h': { minFeeActiveTvlRatio: 2.0, minVolume: 10_000 },
};

const DEFAULT_TIMEFRAME = '4h';

export function normalizeTimeframe(timeframe: string | null | undefined): string {
  const tf = String(timeframe || DEFAULT_TIMEFRAME)
    .trim()
    .toLowerCase();
  return TIMEFRAME_SCREENING_SCALES[tf] ? tf : DEFAULT_TIMEFRAME;
}

export function getScreeningDefaultsForTimeframe(timeframe: string | null | undefined) {
  const tf = normalizeTimeframe(timeframe);
  return { timeframe: tf, ...TIMEFRAME_SCREENING_SCALES[tf]! };
}

export function scaleScreeningToTimeframe(timeframe: string | null | undefined): { minFeeActiveTvlRatio: number; minVolume: number } {
  const { minFeeActiveTvlRatio, minVolume } = getScreeningDefaultsForTimeframe(timeframe);
  return { minFeeActiveTvlRatio, minVolume };
}
