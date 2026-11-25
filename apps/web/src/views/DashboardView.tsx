import { useEffect, useState } from 'react'
import { useHealthQuery } from '../hooks/useHealthQuery'
import { DAEMON_URL } from '../lib/api'
import { fmtClock, fmtCountdown } from '../lib/format'
import type { StateSnapshot } from '../lib/ipc'
import { useClockStore, zoneLabel } from '../stores/clockStore'

const TICK_MS = 1000

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

function fmtUsd(value: number | undefined): string {
  const v = Number(value ?? 0)
  return (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2)
}

/** Optional snapshot fields: '—' when the daemon did not send them. */
function fmtOptUsd(value: number | undefined): string {
  return value === undefined || value === null ? '—' : fmtUsd(value)
}

export function DashboardView({ snapshot }: { snapshot: StateSnapshot | null }) {
  const now = useNow(TICK_MS)
  const timeZone = useClockStore((s) => s.timeZone)
  const utcOffsetMinutes = useClockStore((s) => s.utcOffsetMinutes)
  const health = useHealthQuery().data

  // A host-only console runs no agent of its own, so there is no snapshot to wait for.
  if (health?.hostOnly) {
    return (
      <section className="card">
        <div className="section-head">
          <div>
            <h2>Console host</h2>
            <p className="muted">
              This process serves the console and supervises agents. It runs no cycles, no Telegram and no transactions
              of its own — every trade happens in an agent you start from the Agents tab.
            </p>
          </div>
          <span className="status-pill pill-success">
            <span className="dot" aria-hidden="true" />
            Host only
          </span>
        </div>
        <div className="metrics">
          <div className="metric">
            <div className="label">Listening</div>
            <div className="value small mono">{DAEMON_URL}</div>
          </div>
          <div className="metric">
            <div className="label">Agent id</div>
            <div className="value small mono">{health.agentId}</div>
          </div>
          <div className="metric">
            <div className="label">Tools</div>
            <div className="value">{health.tools}</div>
          </div>
          <div className="metric">
            <div className="label">Timezone</div>
            <div className="value small">{zoneLabel(timeZone, utcOffsetMinutes)}</div>
          </div>
        </div>
      </section>
    )
  }

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
  const zone = zoneLabel(timeZone, utcOffsetMinutes)

  return (
    <>
      <div className="section-head">
        <div>
          <h2>Console daemon</h2>
          <p className="muted">
            State of the daemon serving this console. Managed agents report their own state on the Agents tab.
          </p>
        </div>
        <div className="row">
          <span className="muted small" title="Timestamps are rendered in the daemon's timezone">
            Times in {zone}
          </span>
          {snapshot.dryRun === undefined ? null : (
            <span className={`status-pill ${snapshot.dryRun ? 'pill-idle' : 'pill-running'}`}>
              <span className="dot" aria-hidden="true" />
              {snapshot.dryRun ? 'Dry-run' : 'Live'}
            </span>
          )}
        </div>
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
          <div className="value small" title={fmtClock(snapshot.nextScreenAt, timeZone)}>
            {fmtCountdown(snapshot.nextScreenAt, now)}
          </div>
        </div>
        <div className="metric">
          <div className="label">Next management</div>
          <div className="value small" title={fmtClock(snapshot.nextManageAt, timeZone)}>
            {fmtCountdown(snapshot.nextManageAt, now)}
          </div>
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
