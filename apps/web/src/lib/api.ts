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
