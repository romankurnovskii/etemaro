import { create } from 'zustand'
import { readInitialToken, storeToken } from '../lib/token'

export const TABS = ['agents', 'dashboard', 'tools', 'config', 'logs', 'chat'] as const
export type Tab = (typeof TABS)[number]

export const TAB_LABEL: Record<Tab, string> = {
  agents: 'Agents',
  dashboard: 'Dashboard',
  tools: 'Tools',
  config: 'Config',
  logs: 'Logs',
  chat: 'Chat',
}

function isTab(value: string): value is Tab {
  return (TABS as readonly string[]).includes(value)
}

/** Tab from the URL hash (`#/logs`), so views are linkable and survive reload. */
export function readTabFromHash(): Tab {
  if (typeof location === 'undefined') return 'agents'
  const raw = location.hash.replace(/^#\/?/, '').trim()
  return isTab(raw) ? raw : 'agents'
}

interface UiState {
  tab: Tab
  /** Console daemon bearer token. Persisted to localStorage; per-agent tokens never are. */
  token: string
  /** Tool to preselect when the Tools tab opens (e.g. from "New strategy"). */
  openTool: string | null
  /** Connection/token popover in the header. */
  connectionOpen: boolean
  setTab: (tab: Tab) => void
  setToken: (token: string) => void
  setOpenTool: (name: string | null) => void
  setConnectionOpen: (open: boolean) => void
}

export const useUiStore = create<UiState>((set) => ({
  tab: readTabFromHash(),
  token: readInitialToken(),
  openTool: null,
  connectionOpen: false,
  setTab: (tab) => {
    set({ tab })
    if (typeof location !== 'undefined' && location.hash !== `#/${tab}`) {
      history.replaceState(null, '', `#/${tab}`)
    }
  },
  setToken: (token) => {
    storeToken(token)
    set({ token })
  },
  setOpenTool: (openTool) => set({ openTool }),
  setConnectionOpen: (connectionOpen) => set({ connectionOpen }),
}))
