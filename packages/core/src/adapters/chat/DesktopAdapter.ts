/**
 * @file DesktopAdapter.ts
 * @description Desktop Chat Adapter — HTTP/IPC bridge allowing desktop apps
 * (such as etemaro-desktop) to communicate directly with the Etemaro LLM agent.
 *
 * Supports multi-agent scaling: auto-retries on EADDRINUSE to support hundreds of
 * parallel agent daemons without port conflicts, persisting the assigned port
 * to data/chat_port.json and conversation history to data/chat_history.json.
 */

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { dataPath } from '../../shared/constants.js'
import { log } from '../../shared/logger.js'

export interface ChatMessageRequest {
  text: string
  sender?: string
}

export interface ChatMessageResponse {
  status: 'ok' | 'error'
  text?: string
  error?: string
}

export interface LiveMessageControl {
  toolStart: (name: string) => Promise<void>
  toolFinish: (name: string, result: any, success: boolean) => Promise<void>
  finalize: (text: string) => Promise<void>
  fail: (reason: string) => Promise<void>
}

let _server: http.Server | null = null
let _port: number | null = null
let _handler: ((msg: ChatMessageRequest) => Promise<string | { text: string }>) | null = null
const _chatHistory: Array<{ id: string; sender: 'user' | 'agent'; text: string; ts: string }> = []

const MAX_CHAT_HISTORY_FILE_ENTRIES = 100

function loadChatHistoryFromDisk(): void {
  try {
    const file = dataPath('chat_history.json')
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (Array.isArray(data)) {
        _chatHistory.length = 0
        _chatHistory.push(...data.slice(-MAX_CHAT_HISTORY_FILE_ENTRIES))
      }
    }
  } catch (e: any) {
    log('desktop_chat_warn', `Failed to load chat_history.json: ${e.message}`)
  }
}

function persistChatHistoryToDisk(): void {
  try {
    const file = dataPath('chat_history.json')
    const dir = path.dirname(file)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    if (_chatHistory.length > MAX_CHAT_HISTORY_FILE_ENTRIES) {
      _chatHistory.splice(0, _chatHistory.length - MAX_CHAT_HISTORY_FILE_ENTRIES)
    }
    fs.writeFileSync(file, JSON.stringify(_chatHistory, null, 2))
  } catch (e: any) {
    log('desktop_chat_warn', `Failed to save chat_history.json: ${e.message}`)
  }
}

export function isEnabled(): boolean {
  return _server !== null
}

export function getServerPort(): number | null {
  return _port
}

export function getChatHistory(): Array<{ id: string; sender: 'user' | 'agent'; text: string; ts: string }> {
  return [..._chatHistory]
}

export function clearChatHistory(): void {
  _chatHistory.length = 0
  try {
    const file = dataPath('chat_history.json')
    if (fs.existsSync(file)) {
      fs.unlinkSync(file)
    }
  } catch {
    // Ignore deletion errors
  }
}

function writePortFile(port: number): void {
  try {
    const file = dataPath('chat_port.json')
    const dir = path.dirname(file)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(file, JSON.stringify({ port, ts: new Date().toISOString() }))
  } catch (e: any) {
    log('desktop_chat_warn', `Failed to save chat_port.json: ${e.message}`)
  }
}

/**
 * Start the Desktop Chat HTTP server.
 */
export function startServer(
  handler: (msg: ChatMessageRequest) => Promise<string | { text: string }>,
  port = Number(process.env.DESKTOP_CHAT_PORT) || 31415,
): Promise<void> {
  if (_server) {
    log('desktop_chat_warn', 'Desktop chat server is already running.')
    return Promise.resolve()
  }

  _handler = handler
  loadChatHistoryFromDisk()

  return new Promise((resolve, reject) => {
    const currentPort = port
    const maxPort = port + 100

    const createAndListen = (targetPort: number) => {
      const server = http.createServer(async (req, res) => {
        // CORS & Connection headers for local desktop app
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
        res.setHeader('Connection', 'close')

        if (req.method === 'OPTIONS') {
          res.writeHead(204)
          res.end()
          return
        }

        const url = req.url || '/'

        if (req.method === 'GET' && url === '/api/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'ok', adapter: 'desktop-chat', port: _port }))
          return
        }

        if (req.method === 'GET' && url === '/api/history') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'ok', history: _chatHistory }))
          return
        }

        if (req.method === 'POST' && (url === '/api/chat' || url === '/chat')) {
          let body = ''
          req.on('data', (chunk) => {
            body += chunk
          })

          req.on('end', async () => {
            try {
              const parsed = JSON.parse(body || '{}') as ChatMessageRequest
              if (!parsed.text || typeof parsed.text !== 'string') {
                res.writeHead(400, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ status: 'error', error: 'Field "text" is required.' }))
                return
              }

              _chatHistory.push({
                id: `msg_${Date.now()}_u`,
                sender: 'user',
                text: parsed.text,
                ts: new Date().toISOString(),
              })
              persistChatHistoryToDisk()

              if (!_handler) {
                res.writeHead(503, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ status: 'error', error: 'No message handler registered.' }))
                return
              }

              const response = await _handler(parsed)
              const responseText = typeof response === 'string' ? response : response.text

              _chatHistory.push({
                id: `msg_${Date.now()}_a`,
                sender: 'agent',
                text: responseText,
                ts: new Date().toISOString(),
              })
              persistChatHistoryToDisk()

              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ status: 'ok', text: responseText }))
            } catch (e: any) {
              log('desktop_chat_error', `Error processing chat request: ${e.message}`)
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ status: 'error', error: e.message }))
            }
          })
          return
        }

        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'error', error: 'Not found' }))
      })

      server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE' && targetPort < maxPort) {
          log('desktop_chat_warn', `Port ${targetPort} is in use; retrying on ${targetPort + 1}`)
          server.close()
          createAndListen(targetPort + 1)
        } else {
          log('desktop_chat_error', `Server error on port ${targetPort}: ${err.message}`)
          reject(err)
        }
      })

      server.listen(targetPort, '127.0.0.1', () => {
        _server = server
        _port = targetPort
        writePortFile(targetPort)
        log('desktop_chat', `Desktop chat adapter listening on http://127.0.0.1:${targetPort}`)
        resolve()
      })
    }

    createAndListen(currentPort)
  })
}

/**
 * Stop the Desktop Chat HTTP server.
 */
export function stopServer(): void {
  if (_server) {
    if (typeof _server.closeAllConnections === 'function') {
      _server.closeAllConnections()
    }
    _server.close()
    _server = null
    _handler = null
    _port = null
    log('desktop_chat', 'Desktop chat server stopped.')
  }
}

/**
 * Send an unprompted message to the desktop chat history.
 */
export async function sendMessage(text: string): Promise<void> {
  _chatHistory.push({
    id: `msg_${Date.now()}_a`,
    sender: 'agent',
    text,
    ts: new Date().toISOString(),
  })
  persistChatHistoryToDisk()
}

/**
 * Create a live message object for tool execution progress updates.
 * Mirrors TelegramAdapter.createLiveMessage.
 */
export async function createLiveMessage(title: string, body: string): Promise<LiveMessageControl> {
  const liveEntry = {
    id: `live_${Date.now()}`,
    title,
    body,
    steps: [] as string[],
  }

  log('desktop_chat', `[LiveMessage] ${title}: ${body}`)

  return {
    async toolStart(name: string) {
      liveEntry.steps.push(`▶ Tool start: ${name}`)
      log('desktop_chat', `[LiveMessage ${title}] Tool start: ${name}`)
    },
    async toolFinish(name: string, _result: any, success: boolean) {
      const status = success ? '✅' : '❌'
      liveEntry.steps.push(`${status} Tool finish: ${name}`)
      log('desktop_chat', `[LiveMessage ${title}] Tool finish: ${name} (${status})`)
    },
    async finalize(text: string) {
      log('desktop_chat', `[LiveMessage ${title}] Finalized`)
      await sendMessage(text)
    },
    async fail(reason: string) {
      log('desktop_chat_error', `[LiveMessage ${title}] Failed: ${reason}`)
      await sendMessage(`Error: ${reason}`)
    },
  }
}
