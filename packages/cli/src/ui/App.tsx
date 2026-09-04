import { type IpcLogEntry, type IpcMessage, IpcMessageType, type IpcStateSnapshot } from '@etemaro/core'
import { Box, useApp, useInput, useStdout } from 'ink'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import WebSocket from 'ws'
import { ChatInputPane } from './ChatInputPane.js'
import { LogStreamPane } from './LogStreamPane.js'
import { StatusPane } from './StatusPane.js'

export interface AppProps {
  socketPath?: string
  port?: number
  token?: string
  agentId?: string
}

const MAX_RECONNECT_ATTEMPTS = 30
const INITIAL_RECONNECT_DELAY_MS = 100
const MAX_RECONNECT_DELAY_MS = 10000

export const App: React.FC<AppProps> = ({ socketPath, port = 8765, token, agentId = 'default' }) => {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [terminalRows, setTerminalRows] = useState(stdout?.rows || 24)
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(true)
  const [reconnectAttempts, setReconnectAttempts] = useState(0)
  const [logs, setLogs] = useState<IpcLogEntry[]>([])
  const [scrollOffset, setScrollOffset] = useState(0)
  const [state, setState] = useState<IpcStateSnapshot | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptsRef = useRef(0)
  const isUnmountedRef = useRef(false)

  // Track terminal window resize
  useEffect(() => {
    if (!stdout) return
    const onResize = () => setTerminalRows(stdout.rows)
    stdout.on('resize', onResize)
    return () => {
      stdout.off('resize', onResize)
    }
  }, [stdout])

  // Calculate visible log rows based on terminal height
  const maxVisible = Math.max(6, terminalRows - 11)

  // Keyboard navigation & controls
  useInput((input, key) => {
    // Clean exit
    if (key.ctrl && input === 'c') {
      if (wsRef.current) {
        try {
          wsRef.current.close(1000, 'User exit')
        } catch {
          /* ignore */
        }
      }
      exit()
      return
    }

    // Scroll up (Page Up, Ctrl+U, Shift+Up)
    if (key.pageUp || (key.ctrl && input === 'u') || (key.shift && key.upArrow)) {
      setScrollOffset((prev) => {
        const pageSize = Math.max(3, Math.floor(maxVisible / 2))
        const maxScroll = Math.max(0, logs.length - maxVisible)
        return Math.min(maxScroll, prev + pageSize)
      })
      return
    }

    // Scroll down (Page Down, Ctrl+D, Shift+Down)
    if (key.pageDown || (key.ctrl && input === 'd') || (key.shift && key.downArrow)) {
      setScrollOffset((prev) => {
        const pageSize = Math.max(3, Math.floor(maxVisible / 2))
        return Math.max(0, prev - pageSize)
      })
      return
    }

    // Jump to top / oldest logs (Home)
    if (key.home) {
      setScrollOffset(Math.max(0, logs.length - maxVisible))
      return
    }

    // Jump to bottom / live stream (End)
    if (key.end) {
      setScrollOffset(0)
      return
    }
  })

  useEffect(() => {
    isUnmountedRef.current = false

    function connect() {
      if (isUnmountedRef.current) return
      setConnecting(true)

      const wsUrl = socketPath ? `ws+unix://${socketPath}` : `ws://127.0.0.1:${port}`

      try {
        const ws = new WebSocket(wsUrl)
        wsRef.current = ws

        ws.on('open', () => {
          if (isUnmountedRef.current) return
          setConnected(true)
          setConnecting(false)
          attemptsRef.current = 0
          setReconnectAttempts(0)

          // 1. Send auth if token configured
          if (token) {
            const authMsg: IpcMessage = {
              id: `auth-${Date.now()}`,
              type: IpcMessageType.AUTH,
              payload: { token },
              timestamp: Date.now(),
            }
            ws.send(JSON.stringify(authMsg))
          }

          // 2. Subscribe to logs
          const subLogs: IpcMessage = {
            id: `sub-logs-${Date.now()}`,
            type: IpcMessageType.SUBSCRIBE_LOGS,
            payload: {},
            timestamp: Date.now(),
          }
          ws.send(JSON.stringify(subLogs))

          // 3. Subscribe to state
          const subState: IpcMessage = {
            id: `sub-state-${Date.now()}`,
            type: IpcMessageType.SUBSCRIBE_STATE,
            payload: {},
            timestamp: Date.now(),
          }
          ws.send(JSON.stringify(subState))
        })

        ws.on('message', (data) => {
          if (isUnmountedRef.current) return
          try {
            const msg = JSON.parse(String(data)) as IpcMessage
            if (msg.type === IpcMessageType.LOG_ENTRY) {
              const entry = msg.payload as IpcLogEntry
              setLogs((prev) => [...prev.slice(-999), entry])
            } else if (msg.type === IpcMessageType.STATE_SNAPSHOT) {
              setState(msg.payload as IpcStateSnapshot)
            } else if (msg.type === IpcMessageType.ACK) {
              const reply = (msg.payload as any)?.reply
              if (reply) {
                const replyEntry: IpcLogEntry = {
                  ts: new Date().toISOString(),
                  category: 'agent_reply',
                  message: `🤖 ${reply}`,
                  agentId,
                }
                setLogs((prev) => {
                  const last = prev[prev.length - 1]
                  if (last && last.category === 'agent_reply' && last.message === replyEntry.message) {
                    return prev
                  }
                  return [...prev.slice(-999), replyEntry]
                })
              }
            }
          } catch {
            /* ignore malformed messages */
          }
        })

        ws.on('close', () => {
          if (isUnmountedRef.current) return
          setConnected(false)
          scheduleReconnect()
        })

        ws.on('error', () => {
          if (isUnmountedRef.current) return
          setConnected(false)
        })
      } catch {
        scheduleReconnect()
      }
    }

    function scheduleReconnect() {
      if (isUnmountedRef.current) return
      if (attemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setConnecting(false)
        return
      }

      attemptsRef.current += 1
      setReconnectAttempts(attemptsRef.current)
      setConnecting(true)

      const delay = Math.min(INITIAL_RECONNECT_DELAY_MS * 2 ** (attemptsRef.current - 1), MAX_RECONNECT_DELAY_MS)
      const jitter = Math.random() * 50

      reconnectTimerRef.current = setTimeout(() => {
        connect()
      }, delay + jitter)
    }

    connect()

    return () => {
      isUnmountedRef.current = true
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      if (wsRef.current) {
        try {
          wsRef.current.close(1000, 'App unmount')
        } catch {
          /* ignore */
        }
      }
    }
  }, [socketPath, port, token, agentId])

  const handleChatSubmit = (prompt: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    const userLog: IpcLogEntry = {
      ts: new Date().toISOString(),
      category: 'user_prompt',
      message: `💬 ${prompt}`,
      agentId,
    }
    setLogs((prev) => [...prev.slice(-999), userLog])

    const msg: IpcMessage = {
      id: `chat-${Date.now()}`,
      type: IpcMessageType.COMMAND_CHAT,
      payload: { prompt },
      timestamp: Date.now(),
    }
    wsRef.current.send(JSON.stringify(msg))
  }

  const endpoint = socketPath || `127.0.0.1:${port}`

  return (
    <Box flexDirection="column" height="100%">
      <StatusPane
        connected={connected}
        connecting={connecting}
        reconnectAttempts={reconnectAttempts}
        state={state}
        agentId={agentId}
        endpoint={endpoint}
      />
      <LogStreamPane
        logs={logs}
        maxVisible={maxVisible}
        scrollOffset={scrollOffset}
        connected={connected}
        endpoint={endpoint}
      />
      <ChatInputPane onSubmit={handleChatSubmit} disabled={!connected} />
    </Box>
  )
}
