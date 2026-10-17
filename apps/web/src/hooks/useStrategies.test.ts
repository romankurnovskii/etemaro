import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchJson } from '../lib/api'
import { useStrategies } from './useStrategies'

vi.mock('../lib/api', () => ({ fetchJson: vi.fn() }))
let value: ReturnType<typeof useStrategies>
let renderer: ReactTestRenderer
function Harness({ token }: { token: string }) {
  value = useStrategies(token)
  return null
}
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount())
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
describe('strategy catalogue identity', () => {
  it('does not restore a stale catalogue from the previous token', async () => {
    const resolve: Array<(v: unknown) => void> = []
    vi.mocked(fetchJson).mockImplementation(() => new Promise((r) => resolve.push(r)) as never)
    await act(async () => {
      renderer = create(React.createElement(Harness, { token: 'a' }))
    })
    await act(async () => renderer.update(React.createElement(Harness, { token: 'b' })))
    await act(async () => resolve[1]!({ result: { strategies: [{ id: 'b' }] } }))
    await act(async () => resolve[0]!({ result: { strategies: [{ id: 'a' }] } }))
    expect(value.strategies).toEqual([{ id: 'b' }])
  })
  it('clears the previous catalogue when the new identity cannot fetch it', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce({ result: { strategies: [{ id: 'a' }] } })
    await act(async () => {
      renderer = create(React.createElement(Harness, { token: 'a' }))
    })
    expect(value.strategies).toHaveLength(1)
    vi.mocked(fetchJson).mockRejectedValueOnce(new Error('HTTP401'))
    await act(async () => renderer.update(React.createElement(Harness, { token: 'b' })))
    expect(value.strategies).toEqual([])
  })
})
