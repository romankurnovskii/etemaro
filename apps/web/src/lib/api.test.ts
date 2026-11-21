import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let server: Server
let origin: string
const requests: { url: string | undefined; authorization: string | undefined }[] = []

beforeEach(async () => {
  vi.resetModules()
  requests.length = 0
  server = createServer((req, res) => {
    requests.push({ url: req.url, authorization: req.headers.authorization })
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/api/agents') {
      res.end(JSON.stringify({ agents: [] }))
    } else {
      res.writeHead(404)
      res.end(JSON.stringify({ error: { message: 'No API route' } }))
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected a TCP listener')
  origin = `http://127.0.0.1:${address.port}`
})

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
})

describe('daemon base URL', () => {
  it.each(['', '/', '///'])('uses a single API separator with suffix "%s"', async (suffix) => {
    vi.stubEnv('VITE_DAEMON_URL', origin + suffix)
    const { DAEMON_URL, WS_URL, fetchJson } = await import('./api')
    expect(await fetchJson('/api/agents', 'test-token')).toEqual({ agents: [] })
    expect(requests).toEqual([{ url: '/api/agents', authorization: 'Bearer test-token' }])
    expect(DAEMON_URL).toBe(origin)
    expect(WS_URL).toBe(origin.replace(/^http/, 'ws'))
  })

  it('preserves a reverse proxy base path', async () => {
    vi.stubEnv('VITE_DAEMON_URL', 'https://example.com/etemaro/')
    const { DAEMON_URL, WS_URL } = await import('./api')
    expect(DAEMON_URL).toBe('https://example.com/etemaro')
    expect(WS_URL).toBe('wss://example.com/etemaro')
  })

  it('keeps the same-origin production default', async () => {
    vi.stubEnv('VITE_DAEMON_URL', '')
    vi.stubEnv('DEV', false)
    vi.stubGlobal('location', { origin })
    const { DAEMON_URL, fetchJson } = await import('./api')
    expect(DAEMON_URL).toBe(origin)
    expect(await fetchJson('/api/agents', '')).toEqual({ agents: [] })
    expect(requests[0]?.authorization).toBeUndefined()
  })
})
