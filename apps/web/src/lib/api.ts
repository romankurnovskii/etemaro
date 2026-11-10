export const DAEMON_URL =
  import.meta.env.VITE_DAEMON_URL || (import.meta.env.DEV ? 'http://127.0.0.1:8765' : location.origin)

export const WS_URL = DAEMON_URL.replace(/^http/, 'ws')

export function authHeaders(token: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function fetchJson<T>(path: string, token: string, init?: RequestInit, baseUrl = DAEMON_URL): Promise<T> {
  const res = await fetch(baseUrl + path, {
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

/** Tool-level failures can arrive inside an otherwise successful HTTP response. */
export async function readTool<T>(
  name: string,
  args: Record<string, unknown>,
  token: string,
  baseUrl = DAEMON_URL,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetchJson<{ ok?: boolean; error?: string; result?: T & { error?: string } }>(
    '/api/tool',
    token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, args }),
      signal,
    },
    baseUrl,
  )
  if (response.ok === false || response.error || response.result?.error) {
    throw new Error(response.error || response.result?.error || 'Tool request failed')
  }
  if (response.result === undefined) throw new Error('Daemon returned no tool result')
  return response.result
}
