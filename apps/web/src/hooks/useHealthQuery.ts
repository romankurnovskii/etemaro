import { useQuery } from '@tanstack/react-query'
import { fetchJson } from '../lib/api'

export interface HealthInfo {
  status: string
  agentId: string
  webUi: boolean
  /** True when the process hosts the console only and runs no agent runtime. */
  hostOnly?: boolean
  tools: number
  timezone?: string
  utcOffsetMinutes?: number
}

/** `/api/health` is public (no token) and carries the daemon's timezone. */
export function useHealthQuery() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => fetchJson<HealthInfo>('/api/health', ''),
    staleTime: 5 * 60_000,
    retry: 1,
  })
}
