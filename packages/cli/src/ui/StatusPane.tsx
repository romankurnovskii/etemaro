import type { IpcStateSnapshot } from '@etemaro/core'
import { Box, Text } from 'ink'
import type React from 'react'

export interface StatusPaneProps {
  connected: boolean
  connecting: boolean
  reconnectAttempts: number
  state: IpcStateSnapshot | null
  agentId?: string
  endpoint?: string
}

function formatCountdown(targetIso?: string): string {
  if (!targetIso) return '–'
  const ms = new Date(targetIso).getTime() - Date.now()
  if (ms <= 0) return 'now'
  const sec = Math.floor(ms / 1000)
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export const StatusPane: React.FC<StatusPaneProps> = ({
  connected,
  connecting,
  reconnectAttempts,
  state,
  agentId = 'default',
  endpoint = '127.0.0.1:8765',
}) => {
  const pnl = state?.totalPnlUsd ?? 0
  const pnlColor = pnl >= 0 ? 'green' : 'red'
  const pnlFormatted = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`

  let connStatus = <Text color="green">● Connected ({endpoint})</Text>
  if (!connected) {
    connStatus = connecting ? (
      <Box flexDirection="row">
        <Text color="yellow">
          ○ Connecting to {endpoint} (attempt {reconnectAttempts}/30)...
        </Text>
        {reconnectAttempts >= 2 && (
          <Text dimColor> (Ensure daemon is running via 'etemaro start' or 'pnpm run pm2:start')</Text>
        )}
      </Box>
    ) : (
      <Box flexDirection="row">
        <Text color="red">✕ Disconnected ({endpoint})</Text>
        <Text dimColor> (Start daemon via 'etemaro start' or 'pnpm run pm2:start')</Text>
      </Box>
    )
  }

  const positionsCount = state?.positions?.length ?? 0
  const isBusy = state?.busy ? 'Busy (executing cycle)' : 'Idle'

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="blue" paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Box>
          <Text bold color="blue">
            Etemaro Agent: {agentId}{' '}
          </Text>
          <Text dimColor>[{isBusy}]</Text>
        </Box>
        <Box>{connStatus}</Box>
      </Box>

      <Box flexDirection="row" gap={2} marginTop={0}>
        <Box>
          <Text dimColor>Positions: </Text>
          <Text bold>{positionsCount}</Text>
        </Box>
        <Box>
          <Text dimColor>Total PnL: </Text>
          <Text bold color={pnlColor}>
            {pnlFormatted}
          </Text>
        </Box>
        <Box>
          <Text dimColor>Next Manage: </Text>
          <Text>{formatCountdown(state?.nextManageAt)}</Text>
        </Box>
        <Box>
          <Text dimColor>Next Screen: </Text>
          <Text>{formatCountdown(state?.nextScreenAt)}</Text>
        </Box>
      </Box>

      {positionsCount > 0 ? (
        <Box flexDirection="column" marginTop={0}>
          <Text dimColor>Active Pools:</Text>
          {state?.positions.slice(0, 3).map((pos, i) => {
            const sym = pos.tokenSymbol || (pos.positionAddress ? pos.positionAddress.slice(0, 8) : 'Unknown')
            const posPnl = Number(pos.pnlUsd ?? 0)
            const col = posPnl >= 0 ? 'green' : 'red'
            const val = pos.valueUsd != null && pos.valueUsd > 0 ? `$${pos.valueUsd.toFixed(2)}` : null
            return (
              <Box key={pos.positionAddress || i} flexDirection="row" gap={1}>
                <Text>
                  {i + 1}. {sym}
                </Text>
                {val && <Text color="cyan">[{val}]</Text>}
                <Text color={col}>
                  ({posPnl >= 0 ? '+' : ''}${posPnl.toFixed(2)} / {pos.pnlPct ?? 0}%)
                </Text>
              </Box>
            )
          })}
          {positionsCount > 3 && <Text dimColor> ... and {positionsCount - 3} more</Text>}
        </Box>
      ) : null}
    </Box>
  )
}
