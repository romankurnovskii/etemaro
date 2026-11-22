import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAgent,
  fetchAgents,
  fetchConfig,
  fetchStrategies,
  saveConfig,
  setAgentRunning,
  setAgentStrategy,
} from './api'

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

const AGENT = {
  id: 'a1',
  name: 'a1',
  strategyId: 'spot',
  running: false,
  pid: null,
  configPath: '/tmp/a1.json',
  dataDir: '/tmp/a1',
}

describe('daemon API fetchers', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('fetchAgents returns the agents array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ agents: [AGENT] })),
    )
    await expect(fetchAgents('tok')).resolves.toEqual([AGENT])
  })

  it('fetchAgents tolerates a missing agents field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({})),
    )
    await expect(fetchAgents('tok')).resolves.toEqual([])
  })

  it('fetchConfig encodes the path and returns the config', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ config: { a: 1 } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchConfig('/tmp/a b.json', 'tok')).resolves.toEqual({ a: 1 })
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(url).toContain('/api/config?path=%2Ftmp%2Fa%20b.json')
  })

  it('fetchConfig surfaces the daemon error message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { message: 'MISSING_PATH' } }, false)),
    )
    await expect(fetchConfig('/x', 'tok')).rejects.toThrow('MISSING_PATH')
  })

  it('saveConfig PUTs the config body', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    await saveConfig('/tmp/a.json', { a: 1 }, 'tok')
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.method).toBe('PUT')
    expect(JSON.parse(String(init.body))).toEqual({ config: { a: 1 } })
  })

  it('fetchStrategies unwraps the tool result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ result: { strategies: [{ id: 'spot' }] } })),
    )
    await expect(fetchStrategies('tok')).resolves.toEqual([{ id: 'spot' }])
  })

  it('setAgentRunning maps running to start/stop', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)
    await setAgentRunning('a1', true, 'tok')
    await setAgentRunning('a1', false, 'tok')
    const urls = fetchMock.mock.calls.map((c) => String((c as unknown as [string])[0]))
    expect(urls[0]).toContain('/api/agents/a1/start')
    expect(urls[1]).toContain('/api/agents/a1/stop')
  })

  it('createAgent posts the name', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)
    await createAgent('new-agent', 'tok')
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ name: 'new-agent' })
  })

  it('setAgentStrategy posts the strategy id', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)
    await setAgentStrategy('a1', 'bid_ask', 'tok')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/api/agents/a1/strategy')
    expect(JSON.parse(String(init.body))).toEqual({ strategyId: 'bid_ask' })
  })
})
