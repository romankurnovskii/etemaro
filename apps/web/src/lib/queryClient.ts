import { QueryClient } from '@tanstack/react-query'

/**
 * Server-state cache. Zustand keeps UI and socket state; anything that comes
 * from the daemon's HTTP API lives here so it is deduped, cached and refetched
 * on a schedule instead of being re-implemented per store.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
})
