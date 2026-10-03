import type { StateSnapshot } from '../lib/ipc'

function fmtUsd(value: number | undefined): string {
  const v = Number(value ?? 0)
  return (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2)
}

/** Optional snapshot fields: '—' when the daemon did not send them. */
function fmtOptUsd(value: number | undefined): string {
  return value === undefined || value === null ? '—' : fmtUsd(value)
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
      <div className="section-head">
        <div>
          <h2>Console daemon</h2>
          <p className="muted">
            State of the daemon serving this console. Managed agents report their own state on the Agents tab.
          </p>
        </div>
        {snapshot.dryRun === undefined ? null : (
          <span className={`status-pill ${snapshot.dryRun ? 'pill-idle' : 'pill-running'}`}>
            <span className="dot" aria-hidden="true" />
            {snapshot.dryRun ? 'Dry-run' : 'Live'}
          </span>
        )}
      </div>
      <div className="metrics">
        <div className="metric">
          <div className="label">Wallet</div>
          <div className="value small mono">{shortWallet}</div>
        </div>
        <div className="metric">
          <div className="label">Strategy</div>
          <div className="value small mono">{snapshot.activeStrategyId ?? '—'}</div>
        </div>
        <div className="metric">
          <div className="label">Config</div>
          <div className="value small mono">{snapshot.configPath ?? '—'}</div>
        </div>
      </div>
      <div className="metrics mt">
        <div className="metric">
          <div className="label">Total PnL</div>
          <div className={`value ${Number(snapshot.totalPnlUsd) >= 0 ? 'pos' : 'neg'}`}>
            {fmtUsd(snapshot.totalPnlUsd)}
          </div>
        </div>
        <div className="metric">
          <div className="label">Realized PnL</div>
          <div className="value">{fmtOptUsd(snapshot.totalRealizedPnlUsd)}</div>
        </div>
        <div className="metric">
          <div className="label">Session PnL</div>
          <div className="value">{fmtOptUsd(snapshot.sessionPnlUsd)}</div>
        </div>
        <div className="metric">
          <div className="label">Unclaimed fees</div>
          <div className="value">{fmtOptUsd(snapshot.unclaimedFeesUsd)}</div>
        </div>
        <div className="metric">
          <div className="label">Open positions</div>
          <div className="value">{positions.length}</div>
        </div>
        <div className="metric">
          <div className="label">Busy</div>
          <div className="value">{snapshot.busy ? 'yes' : 'no'}</div>
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
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Pair</th>
                  <th>Position</th>
                  <th className="num">PnL</th>
                  <th className="num">PnL %</th>
                  <th className="num">Value</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.positionAddress || p.poolAddress}>
                    <td>{p.tokenSymbol ?? '—'}</td>
                    <td className="small muted mono">{(p.positionAddress || '').slice(0, 10)}</td>
                    <td className={`num ${Number(p.pnlUsd ?? 0) >= 0 ? 'pos' : 'neg'}`}>{fmtUsd(p.pnlUsd)}</td>
                    <td className="num">{p.pnlPct == null ? '—' : `${Number(p.pnlPct).toFixed(2)}%`}</td>
                    <td className="num">{fmtUsd(p.valueUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
