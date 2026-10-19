import type { Decision } from './ipc'

/**
 * Thin REST client for the daemon's tool endpoint (`POST /api/tool`).
 *
 * The daemon answers `{ ok, agentId, result }` on success and
 * `{ error: { code, message } }` on failure.
 */

export interface ToolResponse<T> {
  ok: true
  agentId: string
  result: T
}

export interface ToolErrorResponse {
  error: { code: string; message: string }
}

export class ToolError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ToolError'
    this.code = code
  }
}

export async function callTool<T>(
  path: string,
  token: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify({ name, args }) })
  const text = await res.text()

  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    throw new ToolError('INVALID_JSON', `Tool ${name} returned non-JSON response`)
  }

  const envelope = body as ToolResponse<T> | ToolErrorResponse | null
  if (envelope && 'error' in envelope && envelope.error) {
    throw new ToolError(envelope.error.code ?? 'TOOL_ERROR', envelope.error.message ?? `Tool ${name} failed`)
  }
  if (envelope && 'result' in envelope) {
    return envelope.result
  }
  throw new ToolError('UNEXPECTED_SHAPE', `Tool ${name} returned an unexpected response shape`)
}

/** Fetch the most recent structured decisions from the daemon's decision log. */
export async function fetchRecentDecisions(endpoint: string, token: string, limit = 8): Promise<Decision[]> {
  const result = await callTool<{ decisions?: Decision[] }>(endpoint, token, 'get_recent_decisions', {
    limit,
  })
  const decisions = Array.isArray(result?.decisions) ? result.decisions : []
  return decisions.filter((d): d is Decision => Boolean(d && typeof d === 'object'))
}
