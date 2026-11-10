import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../shared/logger.js', () => ({
  log: vi.fn(),
  logStructured: vi.fn(),
}))

import { computeXSharePct, fetchDlmmPnlForPool } from './PnLAdapter.js'

describe('computeXSharePct', () => {
  it('returns the token-X share of balance value, one decimal', () => {
    expect(computeXSharePct(62.5, 100, false)).toBe(62.5)
    expect(computeXSharePct(1, 3, false)).toBe(33.3)
  })

  it('returns 0 for a single-side SOL position', () => {
    expect(computeXSharePct(0, 250, false)).toBe(0)
  })

  it('returns null when a price is missing or the position holds no value', () => {
    expect(computeXSharePct(10, 100, true)).toBeNull()
    expect(computeXSharePct(0, 0, false)).toBeNull()
    expect(computeXSharePct(Number.NaN, 100, false)).toBeNull()
  })

  it('clamps rounding drift into 0–100', () => {
    expect(computeXSharePct(100.0001, 100, false)).toBe(100)
  })
})

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
