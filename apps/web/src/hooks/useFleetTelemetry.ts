/**
 * Maintains one WebSocket per running agent on that agent's own ipcPort.
 *
 * Design:
 * - Always opens the console-daemon socket (for Dashboard, Tools, Chat, global logs)
 * - Also opens ws://<host>:<agent.ipcPort> for each agent.running && agent.ipcPort
 * - Adds sockets when an agent starts, disposes when it stops or goes offline
 * - No ipcPort → shows 'no-port' telemetry rather than fabricating data
 *
 * Returns an object consumed by AgentsView to render per-agent cards.
 */

import { useCallback, useEffect, useRef } from 'react'
import type { ManagedAgent } from '../lib/ipc'
import { DaemonSocket } from '../lib/socket'
import { telemetryStore } from '../lib/telemetryStore'

export interface FleetTelemetry {
  /** Check if we have an active socket for an agent. */
  hasSocket: (agentId: string) => boolean
}

export function useFleetTelemetry(agents: ManagedAgent[], token: string, consoleUrl: string): FleetTelemetry {
  // Map of agentId → DaemonSocket (only per-agent sockets, not console socket)
  const agentSockets = useRef<Map<string, DaemonSocket>>(new Map())
  const liveAgentIds = useRef<Set<string>>(new Set())

  // Derive the host from the console URL for constructing child WS URLs
  const agentWsUrl = useCallback(
    (ipcPort: number): string => {
      try {
        const base = new URL(consoleUrl)
        return `ws://${base.hostname}:${ipcPort}`
      } catch {
        return `ws://127.0.0.1:${ipcPort}`
      }
    },
    [consoleUrl],
  )

  useEffect(() => {
    const currentIds = new Set(agents.filter((a) => a.running && a.ipcPort).map((a) => a.id))

    // Dispose sockets for agents that stopped
    for (const [id, sock] of agentSockets.current) {
      if (!currentIds.has(id)) {
        sock.dispose()
        agentSockets.current.delete(id)
        telemetryStore.remove(id)
      }
    }

    // Open sockets for newly running agents
    for (const agent of agents) {
      if (!agent.running) {
        // Mark stopped agents with no-port telemetry (process state only)
        telemetryStore.init(agent.id, 'no-port')
        continue
      }

      if (!agent.ipcPort) {
        // Running but no ipcPort — older daemon or unix-socket setup
        telemetryStore.init(agent.id, 'no-port')
        continue
      }

      if (agentSockets.current.has(agent.id)) continue // already connected

      const agentId = agent.id
      const wsUrl = agentWsUrl(agent.ipcPort)

      telemetryStore.init(agentId, 'connecting')

      const sock = new DaemonSocket(wsUrl, token)
        .on('status', (status, _retryIn) => {
          telemetryStore.setStatus(
            agentId,
            status === 'connected'
              ? 'connected'
              : status === 'auth-failed'
                ? 'auth-failed'
                : status === 'connecting'
                  ? 'connecting'
                  : 'disconnected',
          )
        })
        .on('snapshot', (snap) => {
          telemetryStore.setSnapshot(agentId, snap)
        })
        .on('log', (entry) => {
          // Strict per-agent: only attribute logs that carry this agent's id
          if (!entry.agentId || entry.agentId === agentId) {
            telemetryStore.pushLog(agentId, entry)
          }
        })
        .on('auth-failed', () => {
          telemetryStore.setStatus(agentId, 'auth-failed')
        })

      sock.installWindowHandlers()
      sock.connect()
      agentSockets.current.set(agentId, sock)
    }

    liveAgentIds.current = currentIds

    return () => {
      // Cleanup on unmount only — we don't dispose on every agent list update
      // (that's handled above by diffing currentIds)
    }
  }, [agents, token, agentWsUrl])

  // Full cleanup on unmount
  useEffect(() => {
    return () => {
      for (const sock of agentSockets.current.values()) {
        sock.dispose()
      }
      agentSockets.current.clear()
    }
  }, [])

  return {
    hasSocket: (agentId: string) => agentSockets.current.has(agentId),
  }
}
