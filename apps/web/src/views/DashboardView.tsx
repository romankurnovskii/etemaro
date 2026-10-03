import type { StateSnapshot } from '../lib/ipc'

function fmtUsd(value: number | undefined): string {
  const v = Number(value ?? 0)
  return (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2)
}

function fmtTime(iso: string | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString()
}

export function DashboardView({ snapshot }: { snapshot: StateSnapshot | null }) {
  if (!snapshot) {
    return (
      <section className="card">
        <h2>Status</h2>
        <p className="muted">Waiting for the agent state snapshot. Is the daemon running?</p>
      </section>
    )
  }
  const positions = snapshot.positions ?? []
  const shortWallet = snapshot.walletAddress
    ? `${snapshot.walletAddress.slice(0, 4)}…${snapshot.walletAddress.slice(-4)}`
    : '—'
  return (
    <>
      <div className="metrics">
        <div className="metric">
          <div className="label">Wallet</div>
          <div className="value small">{shortWallet}</div>
        </div>
        <div className="metric">
          <div className="label">Strategy</div>
          <div className="value small">{snapshot.activeStrategyId ?? '—'}</div>
        </div>
        <div className="metric">
          <div className="label">Config</div>
          <div className="value small">{snapshot.configPath ?? '—'}</div>
        </div>
      </div>
      <div className="metrics mt">
        <div className="metric">
          <div className="label">Open PnL</div>
          <div className={`value ${Number(snapshot.totalPnlUsd) >= 0 ? 'pos' : 'neg'}`}>
            {fmtUsd(snapshot.totalPnlUsd)}
          </div>
        </div>
        {snapshot.totalRealizedPnlUsd != null && (
          <div className="metric">
            <div className="label">Realized PnL</div>
            <div className={`value ${Number(snapshot.totalRealizedPnlUsd) >= 0 ? 'pos' : 'neg'}`}>
              {fmtUsd(snapshot.totalRealizedPnlUsd)}
            </div>
          </div>
        )}
        {snapshot.sessionPnlUsd != null && (
          <div className="metric">
            <div className="label">Session PnL</div>
            <div className={`value ${Number(snapshot.sessionPnlUsd) >= 0 ? 'pos' : 'neg'}`}>
              {fmtUsd(snapshot.sessionPnlUsd)}
            </div>
          </div>
        )}
        {snapshot.unclaimedFeesUsd != null && (
          <div className="metric">
            <div className="label">Unclaimed Fees</div>
            <div className="value pos">{fmtUsd(snapshot.unclaimedFeesUsd)}</div>
          </div>
        )}
        <div className="metric">
          <div className="label">Positions</div>
          <div className="value">{positions.length}</div>
        </div>
        <div className="metric">
          <div className="label">Phase</div>
          <div className="value small">{snapshot.phase ?? (snapshot.busy ? 'busy' : 'idle')}</div>
        </div>
        <div className="metric">
          <div className="label">Mode</div>
          <div className="value small">
            {snapshot.dryRun === false ? (
              <span className="badge badge-live">LIVE</span>
            ) : (
              <span className="badge badge-dry">DRY-RUN</span>
            )}
          </div>
        </div>
        <div className="metric">
          <div className="label">Next screening</div>
          <div className="value small">{fmtTime(snapshot.nextScreenAt)}</div>
        </div>
        <div className="metric">
          <div className="label">Next management</div>
          <div className="value small">{fmtTime(snapshot.nextManageAt)}</div>
        </div>
      </div>
      <section className="card mt">
        <h2>Positions</h2>
        {positions.length === 0 ? (
          <p className="muted">No open positions.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Pair</th>
                <th>Position</th>
                <th className="num">PnL</th>
                <th className="num">PnL %</th>
                <th className="num">Value</th>
                <th className="num">Fees</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.positionAddress || p.poolAddress}>
                  <td>{p.tokenSymbol ?? '—'}</td>
                  <td className="small muted">{(p.positionAddress || '').slice(0, 10)}</td>
                  <td className={`num ${Number(p.pnlUsd ?? 0) >= 0 ? 'pos' : 'neg'}`}>{fmtUsd(p.pnlUsd)}</td>
                  <td className="num">{p.pnlPct == null ? '—' : `${Number(p.pnlPct).toFixed(2)}%`}</td>
                  <td className="num">{fmtUsd(p.valueUsd)}</td>
                  <td className="num">{p.unclaimedFeesUsd != null ? fmtUsd(p.unclaimedFeesUsd) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}
