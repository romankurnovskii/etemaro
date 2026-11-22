import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { configQueryKey } from '../hooks/useConfigQuery'
import { fetchConfig } from './api'

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) } as unknown as Response
}

describe('config query cache', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('dedupes concurrent reads of the same config path', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ config: { a: 1 } }))
    vi.stubGlobal('fetch', fetchMock)
    const qc = new QueryClient()

    const [a, b] = await Promise.all([
      qc.fetchQuery({
        queryKey: configQueryKey('/tmp/x.json', 'tok'),
        queryFn: () => fetchConfig('/tmp/x.json', 'tok'),
      }),
      qc.fetchQuery({
        queryKey: configQueryKey('/tmp/x.json', 'tok'),
        queryFn: () => fetchConfig('/tmp/x.json', 'tok'),
      }),
    ])

    expect(a).toEqual({ a: 1 })
    expect(b).toEqual({ a: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('serves a cached value without refetching inside staleTime', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ config: { a: 1 } }))
    vi.stubGlobal('fetch', fetchMock)
    const qc = new QueryClient()

    await qc.fetchQuery({
      queryKey: configQueryKey('/tmp/y.json', 'tok'),
      queryFn: () => fetchConfig('/tmp/y.json', 'tok'),
      staleTime: 30_000,
    })
    await qc.fetchQuery({
      queryKey: configQueryKey('/tmp/y.json', 'tok'),
      queryFn: () => fetchConfig('/tmp/y.json', 'tok'),
      staleTime: 30_000,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps separate entries per path', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      jsonResponse({ config: { path: String(url).includes('one') ? 'one' : 'two' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const qc = new QueryClient()

    const one = await qc.fetchQuery({
      queryKey: configQueryKey('/tmp/one.json', 'tok'),
      queryFn: () => fetchConfig('/tmp/one.json', 'tok'),
    })
    const two = await qc.fetchQuery({
      queryKey: configQueryKey('/tmp/two.json', 'tok'),
      queryFn: () => fetchConfig('/tmp/two.json', 'tok'),
    })

    expect(one).toEqual({ path: 'one' })
    expect(two).toEqual({ path: 'two' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
