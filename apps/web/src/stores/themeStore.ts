import { create } from 'zustand'

export type ThemeMode = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'etemaro.theme'

function readStoredMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  } catch {
    /* storage unavailable (private mode) — fall back to system */
  }
  return 'system'
}

/**
 * Apply the mode to `<html>`. `system` removes the attribute so the
 * `prefers-color-scheme` media query wins; explicit modes pin `color-scheme`,
 * which is what `light-dark()` in styles.css reads.
 */
export function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (mode === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', mode)
}

interface ThemeState {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  /** Cycle system → light → dark → system. */
  cycle: () => void
}

const NEXT: Record<ThemeMode, ThemeMode> = { system: 'light', light: 'dark', dark: 'system' }

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: readStoredMode(),
  setMode: (mode) => {
    try {
      localStorage.setItem(STORAGE_KEY, mode)
    } catch {
      /* storage unavailable — the choice lasts for this session only */
    }
    applyTheme(mode)
    set({ mode })
  },
  cycle: () => get().setMode(NEXT[get().mode]),
}))
