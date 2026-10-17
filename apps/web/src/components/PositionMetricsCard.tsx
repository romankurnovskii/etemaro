import { shortenAddress } from '../lib/agentViz'
import type { PositionSummary } from '../lib/ipc'

interface Props {
  positions: PositionSummary[]
}

function fmtUsd(value: number | undefined): string {
  const v = Number(value ?? 0)
  return (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2)
}

/**
 * Renders Meteora DLMM LP position metrics:
 * - Price range bins (minBinId ↔ maxBinId)
 * - In-range status indicator
 * - Asset split visualization
 */
export function PositionMetricsCard({ positions }: Props) {
  if (positions.length === 0) {
    return (
      <section className="card">
        <div className="section-head">
          <h2>Active LP Positions</h2>
          <span className="muted small">0 deployed</span>
        </div>
        <p className="muted small">No active DLMM liquidity positions currently deployed by this agent.</p>
      </section>
    )
  }

  return (
    <section className="card">
      <div className="section-head">
        <h2>Active LP Positions & Bins</h2>
        <span className="muted small">{positions.length} position(s)</span>
      </div>

      <div className="positions-grid mt">
        {positions.map((pos) => {
          const inRange = pos.inRange ?? true
          const binMin = pos.binRange ? (Array.isArray(pos.binRange) ? pos.binRange[0] : pos.binRange.minBinId) : null
          const binMax = pos.binRange ? (Array.isArray(pos.binRange) ? pos.binRange[1] : pos.binRange.maxBinId) : null

          const ratioX = pos.assetSplit?.ratioX ?? 50
          const ratioY = 100 - ratioX
          const tokenXSym = pos.assetSplit?.tokenXSymbol ?? 'SOL'
          const tokenYSym = pos.assetSplit?.tokenYSymbol ?? pos.tokenSymbol ?? 'TOKEN'

          return (
            <div key={pos.positionAddress || pos.poolAddress} className="position-item-card">
              <div className="position-header">
                <div>
                  <strong className="position-pair">{pos.tokenSymbol ?? 'DLMM Pool'}</strong>
                  <span className="muted small mono ml-2">{shortenAddress(pos.poolAddress, 4, 4)}</span>
                </div>
                <span className={`status-pill ${inRange ? 'status-pill-in-range' : 'status-pill-out-of-range'}`}>
                  <span className="status-pill-dot" />
                  {inRange ? 'In Range' : 'Out of Range'}
                </span>
              </div>

              {/* Price Range Bins */}
              <div className="metric-row mt">
                <span className="muted small">Price Range Bins:</span>
                <span className="mono small">
                  {binMin !== null && binMax !== null ? `Bin [${binMin} ↔ ${binMax}]` : 'Active Curve'}
                </span>
              </div>

              {/* Range Bin Visual Bar */}
              <div
                className="bin-visual-bar"
                title={inRange ? 'Current price within active bins' : 'Price out of active bins'}
              >
                <div className="bin-track">
                  <div
                    className={`bin-indicator ${inRange ? 'bin-indicator-active' : 'bin-indicator-out'}`}
                    style={{ left: inRange ? '45%' : '90%' }}
                  />
                </div>
                <div className="bin-labels">
                  <span className="muted tiny mono">{binMin ?? 'Lower'}</span>
                  <span className="muted tiny mono">{inRange ? 'Active Bin' : 'Out of Range'}</span>
                  <span className="muted tiny mono">{binMax ?? 'Upper'}</span>
                </div>
              </div>

              {/* Asset Split Visualization */}
              <div className="metric-row mt">
                <span className="muted small">Asset Split:</span>
                <span className="mono small">
                  {ratioX}% {tokenXSym} / {ratioY}% {tokenYSym}
                </span>
              </div>
              <div className="split-progress-bar" title={`${ratioX}% ${tokenXSym} / ${ratioY}% ${tokenYSym}`}>
                <div className="split-progress-x" style={{ width: `${ratioX}%` }} />
                <div className="split-progress-y" style={{ width: `${ratioY}%` }} />
              </div>

              {/* Financial Snapshot */}
              <div className="position-footer-metrics mt">
                <div>
                  <div className="muted tiny">Value</div>
                  <div className="mono small">{fmtUsd(pos.valueUsd)}</div>
                </div>
                <div>
                  <div className="muted tiny">Unrealized PnL</div>
                  <div className={`mono small ${Number(pos.pnlUsd ?? 0) >= 0 ? 'pos' : 'neg'}`}>
                    {fmtUsd(pos.pnlUsd)} ({pos.pnlPct == null ? '0%' : `${Number(pos.pnlPct).toFixed(1)}%`})
                  </div>
                </div>
                {pos.unclaimedFeesUsd !== undefined ? (
                  <div>
                    <div className="muted tiny">Unclaimed Fees</div>
                    <div className="mono small pos">{fmtUsd(pos.unclaimedFeesUsd)}</div>
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
