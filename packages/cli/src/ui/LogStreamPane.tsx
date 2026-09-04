import type { IpcLogEntry } from '@etemaro/core'
import { Box, Text } from 'ink'
import type React from 'react'

export interface LogStreamPaneProps {
  logs: IpcLogEntry[]
  maxVisible?: number
  scrollOffset?: number
  connected?: boolean
  endpoint?: string
}

function getCategoryColor(category?: string): 'red' | 'yellow' | 'green' | 'magenta' | 'cyan' | 'blue' | 'white' {
  const cat = (category || '').toLowerCase()
  if (cat.includes('err') || cat.includes('fail')) return 'red'
  if (cat.includes('warn')) return 'yellow'
  if (cat.startsWith('agent_reply') || cat.startsWith('agent')) return 'green'
  if (cat.startsWith('user_prompt') || cat.startsWith('user')) return 'yellow'
  if (cat.startsWith('swap') || cat.startsWith('deploy')) return 'green'
  if (cat.startsWith('close')) return 'magenta'
  if (cat.startsWith('cron') || cat.startsWith('state')) return 'cyan'
  if (cat.startsWith('ipc') || cat.startsWith('chat')) return 'blue'
  return 'white'
}

export const LogStreamPane: React.FC<LogStreamPaneProps> = ({
  logs,
  maxVisible = 15,
  scrollOffset = 0,
  connected = false,
  endpoint = '127.0.0.1:8765',
}) => {
  const totalLogs = logs.length
  const clampedOffset = Math.min(Math.max(0, scrollOffset), Math.max(0, totalLogs - maxVisible))
  const endIndex = totalLogs - clampedOffset
  const startIndex = Math.max(0, endIndex - maxVisible)
  const visibleLogs = logs.slice(startIndex, endIndex)
  const isScrolled = clampedOffset > 0

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={isScrolled ? 'yellow' : 'gray'}
      paddingX={1}
      flexGrow={1}
    >
      <Box marginBottom={0} justifyContent="space-between">
        <Box>
          <Text bold color={isScrolled ? 'yellow' : 'gray'}>
            {isScrolled ? `Logs [PAUSED HISTORY - ${clampedOffset} LINES UP]` : 'Logs (Live Stream)'}
          </Text>
        </Box>
        <Box>
          {isScrolled ? (
            <Text color="cyan">
              Viewing {startIndex + 1}-{endIndex} of {totalLogs} | [End] or [PgDn] to return to live
            </Text>
          ) : (
            <Text dimColor>
              {totalLogs > maxVisible ? `${totalLogs} logs | [PgUp/PgDn] to scroll` : `${totalLogs} logs`}
            </Text>
          )}
        </Box>
      </Box>
      {visibleLogs.length === 0 ? (
        <Box>
          <Text dimColor>
            {connected
              ? 'Connected to daemon. Waiting for events...'
              : `Waiting for daemon on ${endpoint}... (Start daemon with: pnpm start)`}
          </Text>
        </Box>
      ) : (
        visibleLogs.map((entry) => {
          const rawTs = entry.ts || ''
          const time = rawTs ? rawTs.slice(11, 19) : ''
          const catColor = getCategoryColor(entry.category)
          const logKey = entry.correlationId
            ? `${entry.correlationId}_${rawTs}`
            : `${rawTs}_${entry.category}_${entry.message}`
          return (
            <Box key={logKey} flexDirection="row">
              <Text dimColor>[{time}] </Text>
              <Text color={catColor}>[{entry.category}] </Text>
              <Text>{entry.message}</Text>
            </Box>
          )
        })
      )}
    </Box>
  )
}
