import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchJson } from '../lib/api'
import { type AgentsController, useAgents } from './useAgents'

vi.mock('../lib/api', () => ({ fetchJson: vi.fn() }))
let value: AgentsController
let renderer: ReactTestRenderer
function Harness({ token }: { token: string }) {
  value = useAgents(token)
  return null
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('window', { setInterval, clearInterval })
})
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount())
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
const alpha = {
  id: 'alpha',
  name: 'Alpha',
  strategyId: 'balanced',
  running: true,
  pid: 1,
  configPath: '/alpha',
  dataDir: '/alpha',
}
describe('agent loading and identity isolation', () => {
  it('shows a loading state, then the fetched fleet', async () => {
    let resolve!: (v: unknown) => void
    vi.mocked(fetchJson).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r
        }) as never,
    )
    await act(async () => {
      renderer = create(React.createElement(Harness, { token: 'a' }))
    })
    expect(value.loading).toBe(true)
    await act(async () => resolve({ agents: [alpha] }))
    expect(value.loading).toBe(false)
    expect(value.agents[0]?.id).toBe('alpha')
    expect(value.error).toBeNull()
  })
  it('exposes fetch errors instead of pretending the fleet is empty', async () => {
    vi.mocked(fetchJson).mockRejectedValue(new Error('HTTP401'))
    await act(async () => {
      renderer = create(React.createElement(Harness, { token: 'a' }))
    })
    expect(value.loading).toBe(false)
    expect(value.error).toBe('HTTP401')
  })
  it('discards a stale old-token response after a new identity loads', async () => {
    const resolve: Array<(v: unknown) => void> = []
    vi.mocked(fetchJson).mockImplementation(() => new Promise((r) => resolve.push(r)) as never)
    await act(async () => {
      renderer = create(React.createElement(Harness, { token: 'old' }))
    })
    await act(async () => renderer.update(React.createElement(Harness, { token: 'new' })))
    await act(async () => resolve[1]!({ agents: [{ ...alpha, id: 'new-owner' }] }))
    await act(async () => resolve[0]!({ agents: [alpha] }))
    expect(value.agents.map((a) => a.id)).toEqual(['new-owner'])
  })
  it('waits for a post-action reload and restores busy state after failure', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ agents: [alpha] })
    await act(async () => {
      renderer = create(React.createElement(Harness, { token: 'a' }))
    })
    vi.mocked(fetchJson).mockRejectedValueOnce(new Error('Cannot stop'))
    await act(async () => {
      await expect(value.stop('alpha')).rejects.toThrow('Cannot stop')
    })
    expect(value.busy.alpha).toBeUndefined()
    vi.mocked(fetchJson)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ agents: [{ ...alpha, running: false }] })
    await act(async () => value.stop('alpha'))
    expect(value.agents[0]?.running).toBe(false)
    expect(value.busy.alpha).toBeUndefined()
  })
})
