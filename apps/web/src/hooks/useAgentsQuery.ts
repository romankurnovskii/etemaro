import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createAgent, fetchAgents, setAgentRunning, setAgentStrategy } from '../lib/api'

export const AGENTS_KEY = ['agents'] as const
const POLL_MS = 15_000

/** `/api/agents`, polled every 15 s and paused while the tab is hidden. */
export function useAgentsQuery(token: string) {
  return useQuery({
    queryKey: [...AGENTS_KEY, token],
    queryFn: () => fetchAgents(token),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
  })
}

/** Mutations that change the agent list; each invalidates the list on settle. */
export function useAgentMutations(token: string) {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: AGENTS_KEY })

  const create = useMutation({
    mutationFn: (name: string) => createAgent(name, token),
    onSettled: invalidate,
  })
  const setRunning = useMutation({
    mutationFn: ({ id, running }: { id: string; running: boolean }) => setAgentRunning(id, running, token),
    onSettled: invalidate,
  })
  const setStrategy = useMutation({
    mutationFn: ({ id, strategyId }: { id: string; strategyId: string }) => setAgentStrategy(id, strategyId, token),
    onSettled: invalidate,
  })

  return { create, setRunning, setStrategy }
}

export type AgentsQuery = ReturnType<typeof useAgentsQuery>
export type AgentMutations = ReturnType<typeof useAgentMutations>
