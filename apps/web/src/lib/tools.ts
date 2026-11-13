import type { Decision } from './ipc'

export interface ToolResponse<T> {
  ok: boolean
  agentId?: string
  result?: T
  error?: { code?: string; message: string }
}

export class ToolError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ToolError'
    this.code = code
  }
}

/**
 * Call any registered CLI/daemon tool via POST /api/tool.
 */
export async function callTool<T>(
  endpoint: string,
  token: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name, args }),
  })

  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    throw new ToolError('INVALID_JSON', `Tool ${name} returned non-JSON response`)
  }

  const envelope = body as ToolResponse<T> | null
  if (envelope && 'error' in envelope && envelope.error) {
    throw new ToolError(envelope.error.code ?? 'TOOL_ERROR', envelope.error.message ?? `Tool ${name} failed`)
  }
  if (envelope && 'result' in envelope && envelope.result !== undefined) {
    return envelope.result
  }
  return envelope as unknown as T
}

/**
 * Fetch the most recent structured decisions from get_recent_decisions.
 */
export async function fetchRecentDecisions(endpoint: string, token: string, limit = 8): Promise<Decision[]> {
  try {
    const result = await callTool<{ decisions?: Decision[] }>(endpoint, token, 'get_recent_decisions', {
      limit,
    })
    const decisions = Array.isArray(result?.decisions) ? result.decisions : []
    return decisions.filter((d): d is Decision => Boolean(d && typeof d === 'object'))
  } catch {
    return []
  }
}

/**
 * Fetch detailed strategy configuration by id via get_strategy.
 */
export async function fetchStrategyDetails(
  endpoint: string,
  token: string,
  strategyId: string,
): Promise<Record<string, unknown> | null> {
  if (!strategyId) return null
  try {
    const result = await callTool<{ strategy?: Record<string, unknown>; config?: Record<string, unknown> }>(
      endpoint,
      token,
      'get_strategy',
      { id: strategyId },
    )
    return result?.strategy ?? result?.config ?? (result as Record<string, unknown>) ?? null
  } catch {
    return null
  }
}
