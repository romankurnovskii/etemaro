import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../shared/logger.js', () => ({
  log: vi.fn(),
  logStructured: vi.fn(),
}))

import { fetchDlmmPnlForPool } from './PnLAdapter.js'

describe('PnLAdapter — Meteora Datapi request shape', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('requests the open-position PnL page with page_size, not pageSize', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ positions: [] }) } as any)

    await fetchDlmmPnlForPool('Pool1', 'Wallet1')

    const url = String(fetchSpy.mock.calls[0]?.[0])
    expect(url).toContain('status=open')
    expect(url).toContain('page_size=100')
    expect(url).not.toContain('pageSize')
  })
})
