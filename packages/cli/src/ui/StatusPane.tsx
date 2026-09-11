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

function formatUsd(val?: number | null, withSign = true): { text: string; color: 'green' | 'red' } {
  const n = Number(val ?? 0)
  const isPositive = n >= 0
  const color = isPositive ? 'green' : 'red'
  const prefix = withSign ? (isPositive ? '+$' : '-$') : '$'
  return {
    text: `${prefix}${Math.abs(n).toFixed(2)}`,
    color,
  }
}

export const StatusPane: React.FC<StatusPaneProps> = ({
  connected,
  connecting,
  reconnectAttempts,
  state,
  agentId = 'default',
  endpoint = '127.0.0.1:8765',
}) => {
  const totalRealizedPnl = state?.totalRealizedPnlUsd ?? 0
  const totalRealizedFormatted = formatUsd(totalRealizedPnl)

  const sessionPnl = state?.sessionPnlUsd ?? 0
  const sessionFormatted = formatUsd(sessionPnl)

  const openPnl = state?.totalPnlUsd ?? 0
  const openFormatted = formatUsd(openPnl)

  const unclaimedFees = state?.unclaimedFeesUsd ?? 0

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
  const isDryRun = Boolean(state?.dryRun)
  const shortWallet = state?.walletAddress ? `${state.walletAddress.slice(0, 4)}…${state.walletAddress.slice(-4)}` : '—'
  const strategy = state?.activeStrategyId || '—'
  const rawConfigPath = state?.configPath || '—'
  let displayConfigPath = rawConfigPath
  if (rawConfigPath !== '—' && rawConfigPath.length > 20) {
    const parts = rawConfigPath.split(/[/\\]/)
    const fileName = parts.pop() || rawConfigPath
    displayConfigPath = `…/${fileName}`
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="blue" paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row">
          <Text bold color="blue">
            Etemaro Agent: {agentId}{' '}
          </Text>
          {isDryRun ? (
            <Text bold color="yellow">
              [DRY-RUN MODE]{' '}
            </Text>
          ) : (
            <Text bold color="green">
              [LIVE MODE]{' '}
            </Text>
          )}
          <Text dimColor>[{isBusy}]</Text>
        </Box>
        <Box>{connStatus}</Box>
      </Box>

      <Box flexDirection="row" gap={2} marginTop={0}>
        <Box>
          <Text dimColor>Wallet: </Text>
          <Text>{shortWallet}</Text>
        </Box>
        <Box>
          <Text dimColor>Strategy: </Text>
          <Text>{strategy}</Text>
        </Box>
        <Box>
          <Text dimColor>Config: </Text>
          <Text>{displayConfigPath}</Text>
        </Box>
      </Box>

      <Box flexDirection="row" gap={2} marginTop={0}>
        <Text>
          <Text dimColor>Positions: </Text>
          <Text bold>{positionsCount}</Text>
        </Text>
        <Text>
          <Text dimColor>Total PnL: </Text>
          <Text bold color={totalRealizedFormatted.color}>
            {totalRealizedFormatted.text}
          </Text>
        </Text>
        <Text>
          <Text dimColor>Session: </Text>
          <Text bold color={sessionFormatted.color}>
            {sessionFormatted.text}
          </Text>
        </Text>
        {positionsCount > 0 && (
          <>
            <Text>
              <Text dimColor>Open PnL: </Text>
              <Text color={openFormatted.color}>{openFormatted.text}</Text>
            </Text>
            {unclaimedFees > 0 && (
              <Text>
                <Text dimColor>Unclaimed: </Text>
                <Text color="green">+${unclaimedFees.toFixed(2)}</Text>
              </Text>
            )}
          </>
        )}
        <Text>
          <Text dimColor>Next Manage: </Text>
          <Text>{formatCountdown(state?.nextManageAt)}</Text>
        </Text>
        <Text>
          <Text dimColor>Next Screen: </Text>
          <Text>{formatCountdown(state?.nextScreenAt)}</Text>
        </Text>
      </Box>

      {positionsCount > 0 ? (
        <Box flexDirection="column" marginTop={0}>
          <Text dimColor>Active Pools:</Text>
          {state?.positions.slice(0, 3).map((pos, i) => {
            const sym = pos.tokenSymbol || (pos.positionAddress ? pos.positionAddress.slice(0, 8) : 'Unknown')
            const posPnl = Number(pos.pnlUsd ?? 0)
            const col = posPnl >= 0 ? 'green' : 'red'
            const val = pos.valueUsd != null && pos.valueUsd > 0 ? `$${pos.valueUsd.toFixed(2)}` : null
            const fees =
              pos.unclaimedFeesUsd != null && pos.unclaimedFeesUsd > 0
                ? `+fees $${pos.unclaimedFeesUsd.toFixed(2)}`
                : null
            return (
              <Box key={pos.positionAddress || i} flexDirection="row" gap={1}>
                <Text>
                  {i + 1}. {sym}
                </Text>
                {val && <Text color="cyan">[{val}]</Text>}
                <Text color={col}>
                  ({posPnl >= 0 ? '+' : ''}${posPnl.toFixed(2)} / {pos.pnlPct ?? 0}%)
                </Text>
                {fees && <Text color="green">[{fees}]</Text>}
              </Box>
            )
          })}
          {positionsCount > 3 && <Text dimColor> ... and {positionsCount - 3} more</Text>}
        </Box>
      ) : null}
    </Box>
  )
}
