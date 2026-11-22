import { useQuery } from '@tanstack/react-query'
import { fetchStrategies } from '../lib/api'

export const STRATEGIES_KEY = ['strategies'] as const

/** Strategy library for the switch dialog. Changes rarely; cached for a minute. */
export function useStrategiesQuery(token: string) {
  return useQuery({
    queryKey: [...STRATEGIES_KEY, token],
    queryFn: () => fetchStrategies(token),
    staleTime: 60_000,
  })
}
