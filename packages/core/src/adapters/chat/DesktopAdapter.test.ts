import http from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearChatHistory,
  createLiveMessage,
  getChatHistory,
  getServerPort,
  isEnabled,
  sendMessage,
  startServer,
  stopServer,
} from './DesktopAdapter.js'

const TEST_PORT = 31419

function request(method: string, path: string, body?: Record<string, unknown>): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : ''
    const req = http.request(
      `http://127.0.0.1:${TEST_PORT}${path}`,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Connection: 'close',
        },
      },
      (res) => {
        let resBody = ''
        res.on('data', (chunk) => (resBody += chunk))
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 500, data: JSON.parse(resBody) })
          } catch {
            resolve({ status: res.statusCode || 500, data: resBody })
          }
        })
      },
    )
    req.on('error', reject)
    req.end(payload)
  })
}

describe('DesktopAdapter', () => {
  beforeEach(() => {
    clearChatHistory()
    stopServer()
  })

  afterEach(() => {
    stopServer()
    clearChatHistory()
  })

  it('starts and stops server properly', async () => {
    expect(isEnabled()).toBe(false)
    await startServer(async () => 'ok', TEST_PORT)
    expect(isEnabled()).toBe(true)
    expect(getServerPort()).toBe(TEST_PORT)

    stopServer()
    expect(isEnabled()).toBe(false)
    expect(getServerPort()).toBe(null)
  })

  it('responds to GET /api/health', async () => {
    await startServer(async () => 'ok', TEST_PORT)
    const res = await request('GET', '/api/health')
    expect(res.status).toBe(200)
    expect(res.data).toEqual({ status: 'ok', adapter: 'desktop-chat', port: TEST_PORT })
  })

  it('handles POST /api/chat messages and returns response', async () => {
    const mockHandler = async (msg: { text: string }) => {
      if (msg.text === '/ping') return 'pong'
      return `Echo: ${msg.text}`
    }

    await startServer(mockHandler, TEST_PORT)

    const res = await request('POST', '/api/chat', { text: '/ping' })
    expect(res.status).toBe(200)
    expect(res.data).toEqual({ status: 'ok', text: 'pong' })

    const history = getChatHistory()
    expect(history.length).toBe(2)
    expect(history[0]?.text).toBe('/ping')
    expect(history[1]?.text).toBe('pong')
  })

  it('validates missing text in POST /api/chat', async () => {
    await startServer(async () => 'ok', TEST_PORT)
    const res = await request('POST', '/api/chat', {})
    expect(res.status).toBe(400)
    expect(res.data.status).toBe('error')
  })

  it('supports unprompted sendMessage and liveMessage flow', async () => {
    await sendMessage('Hello from daemon')
    const history = getChatHistory()
    expect(history.length).toBe(1)
    expect(history[0]?.text).toBe('Hello from daemon')

    const live = await createLiveMessage('Tool Execution', 'Running candidate screening')
    await live.toolStart('get_candidates')
    await live.toolFinish('get_candidates', { count: 5 }, true)
    await live.finalize('Found 5 candidates')

    const updatedHistory = getChatHistory()
    expect(updatedHistory.length).toBe(2)
    expect(updatedHistory[1]?.text).toBe('Found 5 candidates')
  })
})
