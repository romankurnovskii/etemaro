/**
 * @file HivemindAdapter.ts
 * @description Adapter for collective intelligence sync (registration, lesson sharing, preset pulling, performance events).
 *
 * @features
 * - Registers agent heartbeats and syncs shared fleet lessons/presets
 * - Pushes performance events and derived trade lessons to HiveMind API
 * - Maintains local cache with environment-safe storage & ID generation
 *
 * @dependencies fetch, Config, StrategyLibrary
 * @sideEffects Network requests to HiveMind API and local cache persistence
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import { config } from '../../config/Config.js'
import { mergePresets } from '../../domain/strategy-library.js'
import { USER_CONFIG_PATH } from '../../shared/constants.js'
import { log } from '../../shared/logger.js'
import type { AgentRole, HiveMindCache, HiveMindSharedLesson } from '../../shared/types.js'
import { dataPath, repoPath, sanitizeStoredText } from '../../shared/utils.js'

// ─── Constants ─────────────────────────────────────────────────

const CACHE_PATH = dataPath('hivemind-cache.json')
const PACKAGE_JSON_PATH = repoPath('package.json')
const HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000

let _heartbeatTimer: ReturnType<typeof setInterval> | null = null

// ─── Helpers ───────────────────────────────────────────────────

function safeRandomBytesHex(byteCount: number): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomBytes === 'function') {
    return crypto.randomBytes(byteCount).toString('hex')
  }
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    const array = new Uint8Array(byteCount)
    globalThis.crypto.getRandomValues(array)
    return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('')
  }
  return Math.random()
    .toString(36)
    .substring(2, 2 + byteCount * 2)
}

function safeRandomUUID(): string {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function readJson<T>(filePath: string, fallback: T): T {
  if (typeof fs?.existsSync !== 'function' || !fs.existsSync(filePath)) return fallback
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(filePath: string, value: unknown): void {
  if (typeof fs?.writeFileSync !== 'function') return
  try {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2))
  } catch {
    /* non-node/browser safe fallback */
  }
}

function getVersion(): string {
  try {
    if (typeof fs?.existsSync === 'function' && fs.existsSync(PACKAGE_JSON_PATH)) {
      return JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8')).version || '1.0.0'
    }
  } catch {
    /* fallback */
  }
  return '1.0.0'
}

const AGENT_VERSION = getVersion()

function readUserConfig(): Record<string, unknown> {
  return readJson<Record<string, unknown>>(USER_CONFIG_PATH, {})
}

function _getUserConfigValue(
  userConfig: Record<string, unknown>,
  flatKey: string,
  category: string,
  nestedKey: string,
): unknown {
  if (userConfig[flatKey] !== undefined && userConfig[flatKey] !== null && userConfig[flatKey] !== '') {
    return userConfig[flatKey]
  }
  const nested = userConfig[category]
  if (nested && typeof nested === 'object' && nestedKey in (nested as Record<string, unknown>)) {
    const val = (nested as Record<string, unknown>)[nestedKey]
    if (val !== undefined && val !== null && val !== '') return val
  }
  return null
}

function writeUserConfig(nextConfig: Record<string, unknown>): void {
  writeJson(USER_CONFIG_PATH, nextConfig)
}

function readCache(): HiveMindCache {
  return readJson<HiveMindCache>(CACHE_PATH, {
    sharedLessons: [],
    presets: [],
    pulledAt: null,
  })
}

function writeCache(nextCache: HiveMindCache): void {
  writeJson(CACHE_PATH, nextCache)
}

function getBaseUrl(): string {
  return sanitizeStoredText(config.hiveMind?.url || '', 500) || ''
}

function getApiKey(): string {
  return sanitizeStoredText(config.hiveMind?.apiKey || '', 300) || ''
}

function getPullMode(): string {
  const mode = sanitizeStoredText(config.hiveMind?.pullMode || 'auto', 20) || 'auto'
  return mode === 'manual' ? 'manual' : 'auto'
}

export function getHiveMindPullMode(): string {
  return getPullMode()
}

export function isHiveMindEnabled(): boolean {
  return !!(config.hiveMind?.enabled && getBaseUrl() && getApiKey())
}

export function ensureAgentId(): string {
  const userConfig = readUserConfig()
  const existingId = (userConfig.hiveMind as Record<string, unknown> | undefined)?.agentId as string | null
  if (existingId) {
    config.hiveMind.agentId = existingId
    return existingId
  }

  const agentId = `agt_${safeRandomBytesHex(12)}`
  if (!userConfig.hiveMind || typeof userConfig.hiveMind !== 'object') {
    userConfig.hiveMind = {}
  }
  ;(userConfig.hiveMind as Record<string, unknown>).agentId = agentId
  writeUserConfig(userConfig)
  config.hiveMind.agentId = agentId
  log('hivemind', `Generated agentId ${agentId}`)
  return agentId
}

function getAgentId(): string {
  return config.hiveMind?.agentId || ensureAgentId()
}

function buildUrl(pathname: string, query: Record<string, unknown> = {}): string {
  const url = new URL(pathname, getBaseUrl())
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

async function requestJson(
  pathname: string,
  {
    method = 'GET',
    body = null,
    query = {},
  }: {
    method?: string
    body?: unknown
    query?: Record<string, unknown>
  } = {},
): Promise<Record<string, unknown> | null> {
  if (!isHiveMindEnabled()) return null
  const response = await fetch(buildUrl(pathname, query), {
    method,
    headers: {
      accept: 'application/json',
      'x-api-key': getApiKey(),
      ...(body != null ? { 'content-type': 'application/json' } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(((payload as Record<string, unknown>)?.error as string) || `HiveMind ${response.status}`)
  }
  return payload as Record<string, unknown>
}

interface NormalizedSharedLesson {
  id: string
  rule: string
  tags: string[]
  role: string | null
  outcome: string
  sourceType: string
  score: number | null
  created_at: string
}

function normalizeSharedLesson(input: Record<string, unknown> | HiveMindSharedLesson): NormalizedSharedLesson | null {
  const lesson = input as Record<string, unknown>
  const rule = sanitizeStoredText(lesson?.rule, 400)
  if (!rule) return null
  return {
    id: (lesson.id as string) || (lesson.lessonId as string) || `shared_${Date.now()}`,
    rule,
    tags: Array.isArray(lesson.tags)
      ? ((lesson.tags as unknown[]).map((tag) => sanitizeStoredText(tag, 48)).filter(Boolean) as string[])
      : [],
    role: sanitizeStoredText(lesson.role || '', 20) || null,
    outcome: sanitizeStoredText(lesson.outcome || 'shared', 20) || 'shared',
    sourceType: sanitizeStoredText(lesson.sourceType || lesson.source || 'shared', 24) || 'shared',
    score: Number.isFinite(Number(lesson.score)) ? Number(lesson.score) : null,
    created_at: (lesson.created_at as string) || (lesson.createdAt as string) || new Date().toISOString(),
  }
}

export function getSharedLessonsForPrompt({
  agentType = 'GENERAL',
  maxLessons = 6,
}: {
  agentType?: AgentRole | string
  maxLessons?: number
} = {}): string | null {
  const role = String(agentType || 'GENERAL').toUpperCase()
  const shared = (readCache().sharedLessons || [])
    .map(normalizeSharedLesson)
    .filter(Boolean)
    .filter((lesson) => !lesson?.role || lesson?.role === role || role === 'GENERAL')
    .sort((a, b) => (Number(b?.score) || 0) - (Number(a?.score) || 0))
    .slice(0, maxLessons)

  if (!shared.length) return null
  return shared
    .map((lesson) => `[HIVEMIND${lesson?.score != null ? ` score=${lesson?.score}` : ''}] ${lesson?.rule}`)
    .join('\n')
}

// ─── Push / Pull ───────────────────────────────────────────────

export async function registerHiveMindAgent({
  reason = 'heartbeat',
}: {
  reason?: string
} = {}): Promise<Record<string, unknown> | null> {
  if (!isHiveMindEnabled()) return null
  try {
    return await requestJson('/api/hivemind/agents/register', {
      method: 'POST',
      body: {
        agentId: getAgentId(),
        version: AGENT_VERSION,
        timestamp: new Date().toISOString(),
        reason,
        capabilities: {
          telegram: !!process.env.TELEGRAM_BOT_TOKEN,
          lpagent: !!process.env.LPAGENT_API_KEY,
          dryRun: process.env.DRY_RUN === 'true',
        },
      },
    })
  } catch (error) {
    log('hivemind_warn', `Agent register failed: ${(error as Error).message}`)
    return null
  }
}

export async function pullHiveMindLessons(limit = 24): Promise<NormalizedSharedLesson[] | null> {
  if (!isHiveMindEnabled()) return null
  try {
    const payload = await requestJson('/api/hivemind/lessons/pull', {
      query: { agentId: getAgentId(), limit },
    })
    const cache = readCache()
    cache.sharedLessons = Array.isArray(payload?.lessons)
      ? ((payload.lessons as Record<string, unknown>[])
          .map(normalizeSharedLesson)
          .filter(Boolean) as unknown as HiveMindSharedLesson[])
      : []
    cache.pulledAt = new Date().toISOString()
    writeCache(cache)
    return cache.sharedLessons as unknown as NormalizedSharedLesson[]
  } catch (error) {
    log('hivemind_warn', `Lesson pull failed: ${(error as Error).message}`)
    return null
  }
}

export async function pullHiveMindPresets(): Promise<unknown[] | null> {
  if (!isHiveMindEnabled()) return null
  try {
    const payload = await requestJson('/api/hivemind/presets/pull', {
      query: { agentId: getAgentId() },
    })
    const cache = readCache()
    cache.presets = Array.isArray(payload?.presets) ? payload.presets : []
    cache.pulledAt = new Date().toISOString()
    writeCache(cache)
    return cache.presets
  } catch (error) {
    log('hivemind_warn', `Preset pull failed: ${(error as Error).message}`)
    return null
  }
}

export async function bootstrapHiveMind(): Promise<{
  enabled: boolean
  agentId: string
  pullMode: string
} | null> {
  if (!isHiveMindEnabled()) return null
  ensureAgentId()
  const tasks: Promise<unknown>[] = [registerHiveMindAgent({ reason: 'startup' })]
  if (getPullMode() === 'auto') {
    tasks.push(
      pullHiveMindLessons(),
      pullHiveMindPresets().then((presets) => {
        if (presets) mergePresets(presets)
      }),
    )
  }
  await Promise.allSettled(tasks)
  return { enabled: true, agentId: getAgentId(), pullMode: getPullMode() }
}

export function startHiveMindBackgroundSync(): ReturnType<typeof setInterval> | null {
  if (!isHiveMindEnabled() || _heartbeatTimer) return null
  _heartbeatTimer = setInterval(() => {
    const tasks: Promise<unknown>[] = [registerHiveMindAgent({ reason: 'heartbeat' })]
    if (getPullMode() === 'auto') {
      tasks.push(
        pullHiveMindLessons(),
        pullHiveMindPresets().then((presets) => {
          if (presets) mergePresets(presets)
        }),
      )
    }
    Promise.allSettled(tasks).catch(() => null)
  }, HEARTBEAT_INTERVAL_MS)
  return _heartbeatTimer
}

// ─── Push helpers ──────────────────────────────────────────────

function numberOrNull(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

interface MarketFields {
  entryMcap: number | null
  entryTvl: number | null
  entryVolume: number | null
  exitMcap: number | null
  exitTvl: number | null
  exitVolume: number | null
}

function buildMarketFields(source: Record<string, unknown> | null | undefined): MarketFields | null {
  if (!source) return null
  const market: MarketFields = {
    entryMcap: numberOrNull(source?.entry_mcap),
    entryTvl: numberOrNull(source?.entry_tvl),
    entryVolume: numberOrNull(source?.entry_volume),
    exitMcap: numberOrNull(source?.exit_mcap),
    exitTvl: numberOrNull(source?.exit_tvl),
    exitVolume: numberOrNull(source?.exit_volume),
  }
  return Object.values(market).some((value) => value != null) ? market : null
}

function inferLessonSourceType(lesson: Record<string, unknown>): string {
  const tags = Array.isArray(lesson?.tags) ? (lesson.tags as unknown[]).map((tag) => String(tag).toLowerCase()) : []
  const rule = String(lesson?.rule || '').toLowerCase()
  if (tags.includes('self_tune') || tags.includes('config_change') || rule.startsWith('[self-tuned]')) {
    return 'config_change'
  }
  if (lesson?.outcome === 'manual') {
    return 'manual'
  }
  return 'performance'
}

interface LessonEvent {
  eventId: string
  agentId: string
  version: string
  timestamp: string
  lesson: {
    id: string | null
    rule: string
    tags: string[]
    role: string | null
    outcome: string
    sourceType: string
    confidence: number | null
    pool: string | null
    pinned: boolean
    context: string | null
    market: MarketFields | null
    metrics: {
      pnlPct: number | null
      feesUsd: number | null
      initialValueUsd: number | null
      rangeEfficiency: number | null
      closeReason: string | null
    }
  }
}

function buildLessonEvent(lesson: Record<string, unknown>): LessonEvent | null {
  const rule = sanitizeStoredText(lesson?.rule, 400)
  if (!rule) return null
  const sourceType = sanitizeStoredText(lesson.sourceType || inferLessonSourceType(lesson), 24) || 'manual'
  const market = buildMarketFields(lesson as Record<string, unknown>)
  const context = sanitizeStoredText(lesson?.context, 600)
  return {
    eventId: `lesson:${getAgentId()}:${lesson.id || safeRandomUUID()}`,
    agentId: getAgentId(),
    version: AGENT_VERSION,
    timestamp: (lesson.created_at as string) || new Date().toISOString(),
    lesson: {
      id: (lesson.id as string) || null,
      rule,
      tags: Array.isArray(lesson.tags)
        ? ((lesson.tags as unknown[]).map((tag) => sanitizeStoredText(tag, 48)).filter(Boolean) as string[])
        : [],
      role: sanitizeStoredText(lesson.role || '', 20) || null,
      outcome: sanitizeStoredText(lesson.outcome || 'manual', 20) || 'manual',
      sourceType,
      confidence: Number.isFinite(Number(lesson.confidence)) ? Number(lesson.confidence) : null,
      pool: sanitizeStoredText(lesson.pool || '', 64) || null,
      pinned: !!lesson.pinned,
      context: context || null,
      market,
      metrics: {
        pnlPct: Number.isFinite(Number(lesson.pnl_pct)) ? Number(lesson.pnl_pct) : null,
        feesUsd: Number.isFinite(Number(lesson.fees_earned_usd)) ? Number(lesson.fees_earned_usd) : null,
        initialValueUsd: Number.isFinite(Number(lesson.initial_value_usd)) ? Number(lesson.initial_value_usd) : null,
        rangeEfficiency: Number.isFinite(Number(lesson.range_efficiency)) ? Number(lesson.range_efficiency) : null,
        closeReason: sanitizeStoredText(lesson.close_reason || '', 160) || null,
      },
    },
  }
}

export async function pushHiveLesson(lesson: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  if (!isHiveMindEnabled()) return null
  const body = buildLessonEvent(lesson)
  if (!body) return null
  try {
    return await requestJson('/api/hivemind/lessons/push', {
      method: 'POST',
      body,
    })
  } catch (error) {
    log('hivemind_warn', `Lesson push failed: ${(error as Error).message}`)
    return null
  }
}

function shouldCountInAdjustedWinRate(closeReason: unknown): boolean {
  const text = String(closeReason || '').toLowerCase()
  return !(
    text.includes('out of range') ||
    text.includes('pumped far above range') ||
    text === 'oor' ||
    text.includes('oor')
  )
}

export async function pushHivePerformanceEvent(perf: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  if (!isHiveMindEnabled()) return null
  try {
    return await requestJson('/api/hivemind/performance/push', {
      method: 'POST',
      body: {
        eventId:
          sanitizeStoredText(perf.eventId, 200) ||
          `close:${getAgentId()}:${perf.position || perf.pool}:${perf.recorded_at || Date.now()}`,
        agentId: getAgentId(),
        version: AGENT_VERSION,
        timestamp: (perf.recorded_at as string) || new Date().toISOString(),
        event: {
          pool: sanitizeStoredText(perf.pool, 64) || null,
          poolName: sanitizeStoredText(perf.pool_name, 80) || null,
          baseMint: sanitizeStoredText(perf.base_mint, 64) || null,
          strategy: sanitizeStoredText(perf.strategy, 32) || null,
          closeReason: sanitizeStoredText(perf.close_reason, 200) || 'unknown',
          // pnlUsd & netPnlUsd: Net return = price change + fees earned
          pnlUsd: Number(perf.net_pnl_usd ?? perf.pnl_usd ?? 0),
          netPnlUsd: Number(perf.net_pnl_usd ?? perf.pnl_usd ?? 0),
          // pricePnlUsd: Capital gain/loss strictly from token price movement (final_value - initial_value), excluding fees
          pricePnlUsd: Number(perf.price_pnl_usd ?? Number(perf.pnl_usd ?? 0) - Number(perf.fees_earned_usd ?? 0)),
          pricePnlPct: Number(perf.price_pnl_pct ?? 0),
          pnlPct: Number(perf.pnl_pct || 0),
          feesUsd: Number(perf.fees_earned_usd || 0),
          feesSol: Number(perf.fees_earned_sol || 0),
          minutesHeld: Number(perf.minutes_held || 0),
          countInAdjustedWinRate: shouldCountInAdjustedWinRate(perf.close_reason),
          market: buildMarketFields(perf as Record<string, unknown>),
        },
      },
    })
  } catch (error) {
    log('hivemind_warn', `Performance push failed: ${(error as Error).message}`)
    return null
  }
}
