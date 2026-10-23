import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../shared/logger.js', () => ({
  log: vi.fn(),
  logStructured: vi.fn(),
}))

const { readPositions } = vi.hoisted(() => ({ readPositions: vi.fn() }))
vi.mock('@meteora-ag/dlmm', () => ({ default: { getAllLbPairPositionsByUser: readPositions } }))

import { buildAssetSplit, computePositions, fetchDlmmPnlForPool } from './PnLAdapter.js'

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

describe('live liquidity asset split', () => {
  it('uses USD values rather than token quantities for the share', () => {
    expect(buildAssetSplit(100, 2, 1, 100)).toEqual({ tokenXAmount: 100, tokenYAmount: 2, tokenXPercent: 33.33 })
  })
  it('preserves amounts without inventing a share when a held token lacks a price', () => {
    for (const price of [null, 0, NaN, Infinity, -1]) {
      expect(buildAssetSplit(100, 2, price, 100)).toEqual({ tokenXAmount: 100, tokenYAmount: 2 })
      expect(buildAssetSplit(100, 2, 1, price)).toEqual({ tokenXAmount: 100, tokenYAmount: 2 })
    }
  })
  it('supports single-sided and empty positions without a 50/50 fallback', () => {
    for (const missing of [null, NaN, Infinity, -1]) {
      expect(buildAssetSplit(0, 2, missing, 100)?.tokenXPercent).toBe(0)
      expect(buildAssetSplit(100, 0, 1, missing)?.tokenXPercent).toBe(100)
    }
    expect(buildAssetSplit(100, 0, 1, null)?.tokenXPercent).toBe(100)
    expect(buildAssetSplit(0, 0, 1, 100)).toEqual({ tokenXAmount: 0, tokenYAmount: 0 })
  })
  it('rejects invalid balances and does not publish overflowed valuations', () => {
    expect(buildAssetSplit(-1, 2, 1, 100)).toBeUndefined()
    expect(buildAssetSplit(NaN, 2, 1, 100)).toBeUndefined()
    expect(buildAssetSplit(Infinity, 2, 1, 100)).toBeUndefined()
    expect(buildAssetSplit(1e308, 2, 1e308, 100)?.tokenXPercent).toBeUndefined()
  })
})

describe('SDK position composition', () => {
  afterEach(() => vi.restoreAllMocks())

  it('normalizes independent token decimals and requests both mint prices', async () => {
    readPositions.mockResolvedValue(
      new Map([
        [
          'split-pool',
          {
            tokenX: { mint: { address: { toString: () => 'mint-x' }, decimals: 6 } },
            tokenY: { mint: { address: { toString: () => 'mint-y' }, decimals: 9 } },
            lbPair: { activeId: 5 },
            lbPairPositionsData: [
              {
                publicKey: { toString: () => 'split-position' },
                positionData: {
                  totalXAmount: '100000000',
                  totalYAmount: '2000000000',
                  feeX: '999000000',
                  feeY: '999000000000',
                  lowerBinId: 0,
                  upperBinId: 10,
                },
              },
            ],
          },
        ],
      ]),
    )
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input) =>
        ({
          ok: true,
          json: async () =>
            String(input).includes('assets/search')
              ? [
                  { id: 'mint-x', usdPrice: 1 },
                  { id: 'mint-y', usdPrice: 100 },
                ]
              : { positions: [] },
        }) as Response,
    )
    const result = await computePositions('So11111111111111111111111111111111111111112')
    expect(result.positions[0]?.assetSplit).toEqual({
      tokenXAmount: 100,
      tokenYAmount: 2,
      tokenXPercent: 33.33,
    })
    const query = fetchSpy.mock.calls.map(([url]) => String(url)).find((url) => url.includes('assets/search'))
    expect(query).toContain('mint-x')
    expect(query).toContain('mint-y')
  })
})
