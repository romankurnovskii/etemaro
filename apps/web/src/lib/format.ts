export const DASH = '—'

/** Local time (HH:MM:SS) for an ISO string or epoch ms; '—' when invalid. */
export function fmtClock(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return DASH
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? DASH : d.toLocaleTimeString()
}

/** Coarse relative age ("12s ago", "3m ago", "2h ago"). */
export function fmtAgo(thenMs: number | null | undefined, nowMs: number): string {
  if (thenMs === null || thenMs === undefined || !Number.isFinite(thenMs)) return DASH
  const s = Math.max(0, Math.round((nowMs - thenMs) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

/** First/last characters of a base58 address. */
export function shortAddr(addr: string | null | undefined, head = 4, tail = 4): string {
  if (!addr) return DASH
  return addr.length <= head + tail + 1 ? addr : `${addr.slice(0, head)}…${addr.slice(-tail)}`
}
