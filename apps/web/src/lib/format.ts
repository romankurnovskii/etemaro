export const DASH = '—'

/**
 * Local time (HH:MM:SS) for an ISO string or epoch ms; '—' when invalid.
 * Pass the daemon's `timeZone` so a remote browser shows the host clock.
 */
export function fmtClock(value: string | number | null | undefined, timeZone?: string | null): string {
  if (value === null || value === undefined || value === '') return DASH
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return DASH
  return d.toLocaleTimeString(undefined, timeZone ? { timeZone } : undefined)
}

/** Coarse relative age ("12s ago", "3m ago", "2h ago"). */
export function fmtAgo(thenMs: number | null | undefined, nowMs: number): string {
  if (thenMs === null || thenMs === undefined || !Number.isFinite(thenMs)) return DASH
  const s = Math.max(0, Math.round((nowMs - thenMs) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

/**
 * Time until `target`, e.g. "in 4m 35s". Timezone-independent, which is what
 * a "next cycle" readout actually needs. Returns '—' for a missing target.
 */
export function fmtCountdown(target: string | number | null | undefined, nowMs: number): string {
  if (target === null || target === undefined || target === '') return DASH
  const at = new Date(target).getTime()
  if (Number.isNaN(at)) return DASH
  const delta = Math.round((at - nowMs) / 1000)
  if (delta <= 0) return 'due now'
  if (delta < 60) return `in ${delta}s`
  if (delta < 3600) {
    const m = Math.floor(delta / 60)
    const s = delta % 60
    return s ? `in ${m}m ${s}s` : `in ${m}m`
  }
  const h = Math.floor(delta / 3600)
  const m = Math.floor((delta % 3600) / 60)
  return m ? `in ${h}h ${m}m` : `in ${h}h`
}

/** First/last characters of a base58 address. */
export function shortAddr(addr: string | null | undefined, head = 4, tail = 4): string {
  if (!addr) return DASH
  return addr.length <= head + tail + 1 ? addr : `${addr.slice(0, head)}…${addr.slice(-tail)}`
}
