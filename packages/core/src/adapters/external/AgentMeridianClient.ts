/**
 * @file AgentMeridianClient.ts
 * @description HTTP client for Agent Meridian API with retry budget, exponential backoff, and timeout handling.
 *
 * @features
 * - Encapsulates API requests with JSON parsing and header injection
 * - Implements attempt timeouts and retry budgeting for transient failures
 * - Provides helper functions for base URL and request headers
 *
 * @dependencies fetch, AbortController, Config
 * @sideEffects HTTP requests to Agent Meridian API
 */

import { config } from '../../config/Config.js'
import { DEFAULT_AGENT_ID } from '../../shared/constants.js'
import { createTimer, logStructured } from '../../shared/logger.js'
import { sleep } from '../../utils/time.js'

// ─── Types ─────────────────────────────────────────────────────

interface RetryOptions {
  maxElapsedMs?: number
  maxAttempts?: number
  perAttemptTimeoutMs?: number
}

interface AgentEtemaroRequestOptions extends Omit<RequestInit, 'signal'> {
  retry?: RetryOptions
}

interface AgentEtemaroError extends Error {
  status?: number
  payload?: Record<string, unknown>
  retryAfter?: string | null
}

// ─── Helpers ───────────────────────────────────────────────────

export function getAgentMeridianBase(): string {
  return String(config.api.meridian.url || 'https://api.agentmeridian.xyz/api').replace(/\/+$/, '')
}

export function getAgentMeridianHeaders({ json = false } = {}): Record<string, string> {
  const headers: Record<string, string> = {}
  if (json) headers['Content-Type'] = 'application/json'
  if (config.api.meridian.publicApiKey) headers['x-api-key'] = config.api.meridian.publicApiKey
  return headers
}

export function getAgentIdForRequests(): string {
  // ponytail: local agentId only — no fallback to hiveMind.agentId (separate identity)
  return config.agentId || DEFAULT_AGENT_ID
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
}

function retryDelayMs(error: AgentEtemaroError, attempt: number): number {
  const retryAfter = Number(error?.retryAfter)
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 10_000)
  }
  return Math.min(500 * 2 ** attempt, 5_000)
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number | null): Promise<Response> {
  if (!Number.isFinite(timeoutMs!) || timeoutMs! <= 0) {
    return fetch(url, options)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? undefined)
  const signal = options.signal
  const abortFromParent = (): void => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', abortFromParent, { once: true })
  }

  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', abortFromParent)
  }
}

async function agentMeridianJsonOnce(
  pathname: string,
  options: RequestInit = {},
  timeoutMs: number | null = null,
): Promise<Record<string, unknown>> {
  if (!config.api.meridian.enabled) {
    throw new Error('Agent Meridian API is disabled in configuration')
  }
  const timer = createTimer()
  const res = await fetchWithTimeout(`${getAgentMeridianBase()}${pathname}`, options, timeoutMs)
  const durationMs = timer.stop()
  const text = await res.text().catch(() => '')
  let payload: Record<string, unknown>
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    payload = { raw: text }
  }
  if (!res.ok) {
    const error: AgentEtemaroError = new Error((payload?.error as string) || `${pathname} ${res.status}`)
    error.status = res.status
    error.payload = payload
    error.retryAfter = res.headers.get('retry-after')
    logStructured({
      category: 'api_error',
      message: `AgentMeridian ${pathname} failed: HTTP ${res.status} (${durationMs}ms)`,
      metadata: {
        pathname,
        status: res.status,
        duration_ms: durationMs,
        retryAfter: res.headers.get('retry-after'),
        bodySnippet: text.slice(0, 200),
      },
    })
    throw error
  }
  return payload
}

// ─── Public API ────────────────────────────────────────────────

export async function agentMeridianJson(
  pathname: string,
  options: AgentEtemaroRequestOptions = {},
): Promise<Record<string, unknown>> {
  const { retry, ...fetchOptions } = options
  if (!retry) {
    return agentMeridianJsonOnce(pathname, fetchOptions)
  }

  const maxElapsedMs = Number(retry.maxElapsedMs || 30_000)
  const maxAttempts = Number(retry.maxAttempts || 10)
  const startedAt = Date.now()
  let attempt = 0
  let lastError: AgentEtemaroError | null = null

  while (Date.now() - startedAt < maxElapsedMs && attempt < maxAttempts) {
    const elapsedMs = Date.now() - startedAt
    const remainingMs = Math.max(1, maxElapsedMs - elapsedMs)
    try {
      return await agentMeridianJsonOnce(
        pathname,
        fetchOptions,
        Math.min(Number(retry.perAttemptTimeoutMs || 10_000), remainingMs),
      )
    } catch (error) {
      lastError = error as AgentEtemaroError
      const status = Number(lastError?.status || 0)
      if (!isRetryableStatus(status) || attempt >= maxAttempts - 1) {
        throw error
      }
      const waitMs = Math.min(retryDelayMs(lastError, attempt), Math.max(0, remainingMs - 1))
      if (waitMs <= 0) break
      logStructured({
        category: 'api_retry',
        message: `AgentMeridian ${pathname} retry ${attempt + 1}/${maxAttempts} after ${waitMs}ms (status ${status})`,
        metadata: {
          pathname,
          attempt: attempt + 1,
          maxAttempts,
          wait_ms: waitMs,
          status,
          elapsed_ms: Date.now() - startedAt,
        },
      })
      await sleep(waitMs)
      attempt += 1
    }
  }

  throw lastError || new Error(`${pathname} retry budget exhausted`)
}
