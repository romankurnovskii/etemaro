/**
 * BinRange — visual bin-bar for a Meteora LP position.
 * Renders null when data is unavailable rather than faking anything.
 */
import { buildBinSegments } from '../lib/agentViz'
import type { PositionSummary } from '../lib/ipc'

export function BinRange({ pos }: { pos: PositionSummary }) {
  const segments = buildBinSegments(pos)
  if (!segments) return null

  const { minutesOutOfRange, inRange } = pos
  const label =
    inRange === false ? `out of range${minutesOutOfRange != null ? ` (${minutesOutOfRange}m)` : ''}` : 'in range'

  return (
    <div className="bin-bar-wrap" title={`Bins ${pos.lowerBin}–${pos.upperBin}, active ${pos.activeBin}`}>
      <div className="bin-bar" role="img" aria-label="Bin range bar">
        {segments.map((seg) => (
          <div key={seg.idx} className={`bin-seg ${seg.kind}`} style={{ flex: 1 }} />
        ))}
      </div>
      <span className="bin-bar-label" style={{ color: inRange === false ? 'var(--warn)' : 'var(--muted)' }}>
        {label}
      </span>
    </div>
  )
}
