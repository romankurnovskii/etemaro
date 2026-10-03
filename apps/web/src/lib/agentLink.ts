/**
 * Where to reach a managed agent's own IPC server.
 *
 * AgentSupervisor spawns each agent as a separate `etemaro start` process; that
 * process runs its own IpcServer on `connection.ipcPort` from the instance
 * config. Its logs and state never reach the console daemon's WebSocket, so
 * the browser connects to each running agent directly.
 */
export type AgentEndpoint = { ok: true; url: string; token: string } | { ok: false; reason: string }

interface ConnectionConfig {
  ipcPort?: unknown
  ipcToken?: unknown
  ipcSocketPath?: unknown
}

export function resolveAgentEndpoint(config: unknown, daemonUrl: string, fallbackToken: string): AgentEndpoint {
  const connection = (
    config && typeof config === 'object' ? (config as { connection?: ConnectionConfig }).connection : undefined
  ) as ConnectionConfig | undefined
  if (typeof connection?.ipcSocketPath === 'string' && connection.ipcSocketPath) {
    return { ok: false, reason: 'agent IPC uses a Unix socket (not reachable from the browser)' }
  }
  const port = Number(connection?.ipcPort)
  if (!Number.isInteger(port) || port <= 0) {
    return { ok: false, reason: 'no connection.ipcPort in agent config' }
  }
  let base: URL
  try {
    base = new URL(daemonUrl)
  } catch {
    return { ok: false, reason: 'invalid daemon URL' }
  }
  const protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  // Agents inherit ETEMARO_IPC_TOKEN from the console daemon unless their config sets one.
  const token = typeof connection?.ipcToken === 'string' && connection.ipcToken ? connection.ipcToken : fallbackToken
  return { ok: true, url: `${protocol}//${base.hostname}:${port}`, token }
}
