/**
 * @file hivemindBridge.ts
 * @description Lazy bridge to HivemindAdapter, extracted from lessons.ts.
 */
import type { Lesson } from '../shared/types.js'

// ─── HiveMind Bridge ───────────────────────────────────────────
// Lazy-loaded to avoid circular dependency at import time.
// hivemind.js lives at the repo root (not yet ported to TS).

let _hivemind: {
  pushHiveLesson: (lesson: any) => Promise<any>
  pushHivePerformanceEvent: (event: Record<string, unknown>) => Promise<any>
  getSharedLessonsForPrompt: (opts: any) => string | null
} | null = null

let _hivemindLoadAttempted = false

async function ensureHivemind(): Promise<typeof _hivemind> {
  if (_hivemind || _hivemindLoadAttempted) return _hivemind
  _hivemindLoadAttempted = true
  try {
    const mod = await import('../adapters/external/HivemindAdapter.js')
    _hivemind = {
      pushHiveLesson: mod.pushHiveLesson,
      pushHivePerformanceEvent: mod.pushHivePerformanceEvent,
      getSharedLessonsForPrompt: mod.getSharedLessonsForPrompt,
    }
  } catch {
    // hivemind not available — no-op
  }
  return _hivemind
}

export async function pushHiveLesson(lesson: Lesson): Promise<void> {
  const hm = await ensureHivemind()
  if (hm) void hm.pushHiveLesson(lesson)
}

export async function pushHivePerformanceEvent(event: Record<string, unknown>): Promise<void> {
  const hm = await ensureHivemind()
  if (hm) void hm.pushHivePerformanceEvent(event)
}

export function getSharedLessonsForPrompt(opts: { agentType: string; maxLessons: number }): string | null {
  if (_hivemind) return _hivemind.getSharedLessonsForPrompt(opts)
  // Fire-and-forget async load for next call
  void ensureHivemind()
  return null
}
