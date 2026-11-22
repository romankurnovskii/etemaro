import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentsStore } from './agentsStore'

const AGENT = {
  id: 'agent-1',
  name: 'agent-1',
  strategyId: 'spot',
  running: false,
  pid: null,
  configPath: '/tmp/agent-1.json',
  dataDir: '/tmp/agent-1',
}

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('agentsStore', () => {
  beforeEach(() => {
    useAgentsStore.setState({ agents: [], loaded: false, loadError: null, busy: {}, errors: {} })
    vi.restoreAllMocks()
  })

  it('load populates agents and marks loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ agents: [AGENT] })),
    )
    await useAgentsStore.getState().load('tok')
    const s = useAgentsStore.getState()
    expect(s.agents).toHaveLength(1)
    expect(s.loaded).toBe(true)
    expect(s.loadError).toBeNull()
  })

  it('load records an error without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { message: 'boom' } }, false)),
    )
    await useAgentsStore.getState().load('tok')
    const s = useAgentsStore.getState()
    expect(s.loadError).toBe('boom')
    expect(s.loaded).toBe(true)
  })

  it('start clears busy and records a per-agent error on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/start')) return jsonResponse({ error: { message: 'nope' } }, false)
        return jsonResponse({ agents: [AGENT] })
      }),
    )
    await useAgentsStore.getState().start('tok', 'agent-1')
    const s = useAgentsStore.getState()
    expect(s.busy['agent-1']).toBeUndefined()
    expect(s.errors['agent-1']).toBe('start failed: nope')
  })

  it('start clears a previous error on success', async () => {
    useAgentsStore.setState({ errors: { 'agent-1': 'old' } })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ agents: [AGENT] })),
    )
    await useAgentsStore.getState().start('tok', 'agent-1')
    expect(useAgentsStore.getState().errors['agent-1']).toBeUndefined()
  })

  it('setStrategy posts the strategy id and reloads', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ agents: [AGENT] }))
    vi.stubGlobal('fetch', fetchMock)
    await useAgentsStore.getState().setStrategy('tok', 'agent-1', 'bid_ask')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/api/agents/agent-1/strategy')
    expect(JSON.parse(String(init.body))).toEqual({ strategyId: 'bid_ask' })
  })
})
