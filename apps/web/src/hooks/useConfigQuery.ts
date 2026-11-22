import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchConfig, saveConfig } from '../lib/api'

export function configQueryKey(path: string, token: string) {
  return ['config', path, token] as const
}

/**
 * One cached entry per config path. Agent links and the Config view share it,
 * so N agents pointing at the same file cost one request, not N.
 */
export function useConfigQuery(path: string | null, token: string) {
  return useQuery({
    queryKey: configQueryKey(path ?? '', token),
    queryFn: () => fetchConfig(path as string, token),
    enabled: Boolean(path),
    staleTime: 30_000,
  })
}

export function useSaveConfig(token: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ path, config }: { path: string; config: Record<string, unknown> }) =>
      saveConfig(path, config, token),
    onSuccess: (_data, { path }) => qc.invalidateQueries({ queryKey: ['config', path] }),
  })
}
