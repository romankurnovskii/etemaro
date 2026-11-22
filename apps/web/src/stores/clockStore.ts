import { create } from 'zustand'

interface ClockState {
  /** IANA zone reported by the daemon (`/api/health`), e.g. "Europe/Berlin". */
  timeZone: string | null
  /** Daemon UTC offset in minutes, used for the label when the zone is unknown. */
  utcOffsetMinutes: number | null
  setZone: (timeZone: string | null, utcOffsetMinutes: number | null) => void
}

/**
 * Timestamps are rendered in the *daemon's* zone so a browser on another
 * machine shows the same clock as the host running the agent.
 */
export const useClockStore = create<ClockState>((set) => ({
  timeZone: null,
  utcOffsetMinutes: null,
  setZone: (timeZone, utcOffsetMinutes) => set({ timeZone, utcOffsetMinutes }),
}))

/** Short label for the active zone, e.g. "UTC" or "GMT+2". */
export function zoneLabel(timeZone: string | null, utcOffsetMinutes: number | null): string {
  if (timeZone) return timeZone
  if (utcOffsetMinutes === null) return 'local'
  const sign = utcOffsetMinutes < 0 ? '-' : '+'
  const abs = Math.abs(utcOffsetMinutes)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`
}
