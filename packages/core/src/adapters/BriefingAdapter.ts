/**
 * @file BriefingAdapter.ts
 * @description Generates an HTML morning briefing message summarizing the last 24h of positions, performance, and lessons.
 *
 * @features
 * - Aggregates open/closed positions, PnL, fees, and new lessons from state.json and lessons.json
 * - Formats a compact, Telegram-ready HTML summary with activity, performance, lessons, and portfolio sections
 *
 * @dependencies none
 * @sideEffects Reads state.json and lessons.json from disk
 */
import fs from "fs";
import { log } from "../shared/logger.js";
import { getPerformanceSummary } from "../domain/lessons.js";
import { dataPath } from "../shared/constants.js";
import type { LessonsData } from "../shared/types.js";

const STATE_FILE = dataPath("state.json");
const LESSONS_FILE = dataPath("lessons.json");

interface PositionRecord {
  deployed_at?: string;
  closed?: boolean;
  closed_at?: string;
  [key: string]: unknown;
}

interface StateData {
  positions: Record<string, PositionRecord>;
  recentEvents?: unknown[];
}

function loadJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (err) {
    log("briefing_error", `Failed to read ${file}: ${(err as Error).message}`);
    return null;
  }
}

export async function generateBriefing(): Promise<string> {
  const state = loadJson<StateData>(STATE_FILE) || { positions: {}, recentEvents: [] };
  const lessonsData = loadJson<LessonsData>(LESSONS_FILE) || { lessons: [], performance: [] };

  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // 1. Positions Activity
  const allPositions = Object.values(state.positions || {});
  const openedLast24h = allPositions.filter(
    (p) => p.deployed_at && new Date(p.deployed_at) > last24h,
  );
  const closedLast24h = allPositions.filter(
    (p) => p.closed && p.closed_at && new Date(p.closed_at) > last24h,
  );

  // 2. Performance Activity (from performance log)
  const perfLast24h = (lessonsData.performance || []).filter(
    (p) => p.recorded_at && new Date(p.recorded_at) > last24h,
  );
  const totalPnLUsd = perfLast24h.reduce(
    (sum, p) => sum + (p.pnl_usd || 0),
    0,
  );
  const totalFeesUsd = perfLast24h.reduce(
    (sum, p) => sum + (p.fees_earned_usd || 0),
    0,
  );

  // 3. Lessons Learned
  const lessonsLast24h = (lessonsData.lessons || []).filter(
    (l) => l.created_at && new Date(l.created_at) > last24h,
  );

  // 4. Current State
  const openPositions = allPositions.filter((p) => !p.closed);
  const perfSummary = getPerformanceSummary() as Record<string, unknown> | null;

  // 5. Format Message
  const lines = [
    "☀️ <b>Morning Briefing</b> (Last 24h)",
    "────────────────",
    `<b>Activity:</b>`,
    `📥 Positions Opened: ${openedLast24h.length}`,
    `📤 Positions Closed: ${closedLast24h.length}`,
    "",
    `<b>Performance:</b>`,
    `💰 Net PnL: ${totalPnLUsd >= 0 ? "+" : ""}$${totalPnLUsd.toFixed(2)}`,
    `💎 Fees Earned: $${totalFeesUsd.toFixed(2)}`,
    perfLast24h.length > 0
      ? `📈 Win Rate (24h): ${Math.round(
          (perfLast24h.filter((p) => (p.pnl_usd ?? 0) > 0).length /
            perfLast24h.length) *
            100,
        )}%`
      : "📈 Win Rate (24h): N/A",
    "",
    `<b>Lessons Learned:</b>`,
    lessonsLast24h.length > 0
      ? lessonsLast24h.map((l) => `• ${l.rule}`).join("\n")
      : "• No new lessons recorded overnight.",
    "",
    `<b>Current Portfolio:</b>`,
    `📂 Open Positions: ${openPositions.length}`,
    perfSummary
      ? `📊 All-time PnL: $${(perfSummary.total_pnl_usd as number).toFixed(2)} (${perfSummary.win_rate_pct as number}% win)`
      : "",
    "────────────────",
  ];

  return lines.join("\n");
}
