import type { ConnectionStatus } from '../hooks/useAgentConnection'
import { useNow } from '../hooks/useNow'

export function ConnectionBadge({ status, retryAt }: { status: ConnectionStatus; retryAt: number | null }) {
  const now = useNow(1000)
  const wait = retryAt ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : null
  return (
    <span className={`conn-badge conn-${status}`} role="status" aria-live="polite">
      <span className={`status-dot status-${status}`} />
      {status}
      {status === 'disconnected' && wait !== null ? <span className="muted small"> · retry in {wait}s</span> : null}
    </span>
  )
}
