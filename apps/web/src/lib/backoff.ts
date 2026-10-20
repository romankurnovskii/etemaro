/** Reconnect delay policy for daemon WebSockets. */
export interface BackoffPolicy {
  /** Delay ceiling for the first retry, in ms. */
  baseMs: number
  /** Upper bound for any single delay, in ms. */
  maxMs: number
}

export const DEFAULT_BACKOFF: BackoffPolicy = { baseMs: 500, maxMs: 15_000 }

/**
 * Exponential backoff with "equal jitter": half of the exponential ceiling is
 * fixed, the other half is random. Spreads reconnects from many tabs/agents
 * while never collapsing to a 0 ms hot loop.
 */
export function backoffDelay(attempt: number, policy: BackoffPolicy = DEFAULT_BACKOFF, random = Math.random): number {
  const exp = Math.max(0, Math.floor(attempt))
  const ceiling = Math.min(policy.maxMs, policy.baseMs * 2 ** exp)
  const half = ceiling / 2
  return Math.round(half + random() * half)
}
