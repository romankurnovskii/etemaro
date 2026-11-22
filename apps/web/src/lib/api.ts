import type { ManagedAgent, StrategySummary } from './ipc'

export const DAEMON_URL =
  import.meta.env.VITE_DAEMON_URL || (import.meta.env.DEV ? 'http://127.0.0.1:8765' : location.origin)

export const WS_URL = DAEMON_URL.replace(/^http/, 'ws')

export function authHeaders(token: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function fetchJson<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(DAEMON_URL + path, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...authHeaders(token) },
  })
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text }
  }
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error?: { message?: string } }).error?.message ?? res.status)
        : `HTTP ${res.status}`
    throw new Error(message)
  }
  return body as T
}

/** Invoke an agent tool on the console daemon (POST /api/tool) and return its `result`. */
export async function callTool<T = Record<string, unknown>>(
  name: string,
  args: Record<string, unknown>,
  token: string,
): Promise<T> {
  const res = await fetchJson<{ result?: T }>('/api/tool', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, args }),
  })
  return (res?.result ?? {}) as T
}

/* ─── Typed daemon endpoints (used as TanStack Query fetchers) ─────────── */

export async function fetchAgents(token: string): Promise<ManagedAgent[]> {
  const res = await fetchJson<{ agents?: ManagedAgent[] }>('/api/agents', token)
  return res?.agents ?? []
}

export async function fetchConfig(path: string, token: string): Promise<Record<string, unknown>> {
  const res = await fetchJson<{ config?: Record<string, unknown> }>(
    `/api/config?path=${encodeURIComponent(path)}`,
    token,
  )
  return res?.config ?? {}
}

export async function saveConfig(path: string, config: Record<string, unknown>, token: string): Promise<void> {
  await fetchJson(`/api/config?path=${encodeURIComponent(path)}`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
  })
}

export async function fetchStrategies(token: string): Promise<StrategySummary[]> {
  const res = await callTool<{ strategies?: StrategySummary[] }>('list_strategies', {}, token)
  return res?.strategies ?? []
}

export async function createAgent(name: string, token: string): Promise<void> {
  await fetchJson('/api/agents', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export async function setAgentRunning(id: string, running: boolean, token: string): Promise<void> {
  await fetchJson(`/api/agents/${encodeURIComponent(id)}/${running ? 'start' : 'stop'}`, token, { method: 'POST' })
}

export async function setAgentStrategy(id: string, strategyId: string, token: string): Promise<void> {
  await fetchJson(`/api/agents/${encodeURIComponent(id)}/strategy`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ strategyId }),
  })
}
