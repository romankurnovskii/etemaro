import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../../config/Config.js'
import { blockDev } from '../../domain/dev-blocklist.js'
import type { StateStorePort } from '../../ports/state-store.js'
import { resetStateStore, setStateStore } from '../../shared/stateStore.js'
import {
  candidateScanTotals,
  discoverPools,
  getPoolDetail,
  getRawPoolScreeningRejectReason,
  type RawPool,
  scoreCandidate,
  windowedFeeTvlRejectReason,
} from './ScreeningAdapter.js'

/** In-memory state store so blocklist/blacklist reads never touch real data files. */
function useMemoryStore(): void {
  const files = new Map<string, unknown>()
  const store: StateStorePort = {
    read<T>(filePath: string, fallback: T): T {
      return (files.has(filePath) ? files.get(filePath) : fallback) as T
    },
    write(filePath: string, data: unknown): void {
      files.set(filePath, JSON.parse(JSON.stringify(data)))
    },
  }
  setStateStore(store)
}

const SCREENING_SNAPSHOT = JSON.parse(JSON.stringify(config.screening)) as typeof config.screening

/** Permissive thresholds so a fixture pool passes every gate except the one under test. */
function usePermissiveScreening(): void {
  Object.assign(config.screening, {
    minMcap: 0,
    // NOTE: must be a huge number, not null — `getRawPoolScreeningRejectReason`
    // compares `mcap > s.maxMcap` without a null guard, so null coerces to 0
    // and rejects everything.
    maxMcap: 1_000_000_000_000,
    minHolders: 0,
    minVolume: 0,
    minTvl: 0,
    maxTvl: null,
    minBinStep: 1,
    maxBinStep: 1_000_000,
    minFeeActiveTvlRatio: 0,
    minOrganic: 0,
    minQuoteOrganic: 0,
    timeframe: '5m',
    blockedLaunchpads: [],
    excludeHighSupplyConcentration: false,
    minTokenAgeHours: null,
    maxTokenAgeHours: null,
  })
}

describe('candidateScanTotals', () => {
  it('counts filtered discovery pools as scanned even when none are shortlisted', () => {
    expect(candidateScanTotals({ pools: [], filtered_examples: [{}, {}, {}, {}, {}] }, 0)).toEqual({
      total_screened: 5,
      total_eligible: 0,
    })
  })

  it('adds surviving discovery pools to filtered examples (issue #168: 6 scanned / 1 shortlisted)', () => {
    expect(candidateScanTotals({ pools: [{}], filtered_examples: [{}, {}, {}, {}, {}] }, 1)).toEqual({
      total_screened: 6,
      total_eligible: 1,
    })
  })
})

describe('windowedFeeTvlRejectReason', () => {
  it('labels the screening-time metric as windowed fee/TVL with the timeframe', () => {
    expect(windowedFeeTvlRejectReason(0.0129, 0.05, '24h')).toBe('windowed fee/TVL (24h) 0.0129 < min 0.05')
  })

  it('uses unknown when the ratio is missing', () => {
    expect(windowedFeeTvlRejectReason(Number.NaN, 0.05, '5m')).toBe('windowed fee/TVL (5m) unknown < min 0.05')
  })
})

// ─── Behaviour coverage: ranking, threshold gates, discovery filtering ───────

/** Permissive thresholds so a fixture pool is rejected only by the rule under test. */
function thresholdConfig(overrides: Record<string, unknown> = {}) {
  return {
    excludeHighSupplyConcentration: true,
    minMcap: 100_000,
    maxMcap: 10_000_000,
    minHolders: 500,
    minVolume: 500,
    minTvl: 10_000,
    maxTvl: null,
    minBinStep: 50,
    maxBinStep: 201,
    minFeeActiveTvlRatio: 0.05,
    timeframe: '5m',
    minOrganic: 60,
    minQuoteOrganic: 60,
    blockedLaunchpads: [],
    minTokenAgeHours: null,
    maxTokenAgeHours: null,
    ...overrides,
  } as unknown as Parameters<typeof getRawPoolScreeningRejectReason>[1]
}

/** Raw pool that clears every threshold in `thresholdConfig()`. */
function validRawPool(overrides: Record<string, unknown> = {}) {
  return {
    pool_address: 'POOL_VALID',
    name: 'VALID-SOL',
    pool_type: 'dlmm',
    tvl: 50_000,
    active_tvl: 50_000,
    volume: 5_000,
    fee_active_tvl_ratio: 0.12,
    volatility: 1.1,
    base_token_holders: 5_000,
    dlmm_params: { bin_step: 100 },
    token_x: { address: 'MINTX', symbol: 'VALID', holders: 5_000, market_cap: 500_000, organic_score: 70 },
    token_y: { address: 'SOLMINT', symbol: 'SOL', organic_score: 70 },
    ...overrides,
  } as unknown as RawPool
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, statusText: 'OK', json: async () => body } as unknown as Response
}

describe('scoreCandidate', () => {
  it('returns a finite score when optional fields are absent', () => {
    // Guards the `field || 0` fallbacks: a missing field must count as 0, not poison the score.
    expect(scoreCandidate({} as RawPool)).toBe(0)
  })

  it('weights fee/TVL, organic score, volume and holders', () => {
    const score = scoreCandidate({
      fee_active_tvl_ratio: 0.1,
      organic_score: 50,
      volume_window: 1_000,
      holders: 100,
    } as RawPool)

    // 0.1*1000 + 50*10 + 1000/100 + 100/100
    expect(score).toBe(611)
  })
})

describe('getRawPoolScreeningRejectReason', () => {
  it('accepts a pool that clears every threshold', () => {
    expect(getRawPoolScreeningRejectReason(validRawPool(), thresholdConfig())).toBeNull()
  })

  it('rejects a pool above maxTvl even when it is below every other ceiling', () => {
    const pool = validRawPool({ tvl: 500_000, active_tvl: 500_000 })

    expect(getRawPoolScreeningRejectReason(pool, thresholdConfig({ maxTvl: 150_000 }))).toBe(
      'TVL 500000 above maxTvl 150000',
    )
  })

  it.each([
    [
      'mcap below the minimum',
      { token_x: { address: 'MINTX', market_cap: 50_000, organic_score: 70 } },
      {},
      'mcap 50000 below minMcap 100000',
    ],
    [
      'mcap above the maximum',
      { token_x: { address: 'MINTX', market_cap: 20_000_000, organic_score: 70 } },
      {},
      'mcap 20000000 above maxMcap 10000000',
    ],
    ['holders below the minimum', { base_token_holders: 10 }, {}, 'holders 10 below minHolders 500'],
    ['holders unknown', { base_token_holders: undefined }, {}, 'holders unknown below minHolders 500'],
    ['volume below the minimum', { volume: 10 }, {}, 'volume 10 below minVolume 500'],
    ['TVL below the minimum', { tvl: 100, active_tvl: 100 }, {}, 'TVL 100 below minTvl 10000'],
    ['bin step below the minimum', { dlmm_params: { bin_step: 1 } }, {}, 'bin_step 1 below minBinStep 50'],
    ['bin step above the maximum', { dlmm_params: { bin_step: 1_000 } }, {}, 'bin_step 1000 above maxBinStep 201'],
    [
      'windowed fee/TVL below the minimum',
      { fee_active_tvl_ratio: 0.001 },
      {},
      'windowed fee/TVL (5m) 0.001 < min 0.05',
    ],
    ['fee/TVL missing', { fee_active_tvl_ratio: undefined }, {}, 'windowed fee/TVL (5m) unknown < min 0.05'],
    ['unusable volatility', { volatility: 0 }, {}, 'volatility 0 is unusable'],
    [
      'base organic below the minimum',
      { token_x: { address: 'MINTX', market_cap: 500_000, organic_score: 10 } },
      {},
      'base organic 10 below minOrganic 60',
    ],
    [
      'quote organic below the minimum',
      { token_y: { address: 'SOLMINT', organic_score: 10 } },
      {},
      'quote organic 10 below minQuoteOrganic 60',
    ],
    [
      'base token critical warnings',
      { base_token_has_critical_warnings: true },
      {},
      'base token has critical warnings',
    ],
    [
      'quote token critical warnings',
      { quote_token_has_critical_warnings: true },
      {},
      'quote token has critical warnings',
    ],
    [
      'high single ownership',
      { base_token_has_high_single_ownership: true },
      {},
      'base token has high single ownership',
    ],
    ['non-dlmm pool type', { pool_type: 'cpamm' }, {}, 'pool_type cpamm is not dlmm'],
  ])('rejects %s', (_label, poolOverrides, configOverrides, expectedReason) => {
    const pool = validRawPool(poolOverrides as Record<string, unknown>)

    expect(getRawPoolScreeningRejectReason(pool, thresholdConfig(configOverrides as Record<string, unknown>))).toBe(
      expectedReason,
    )
  })
})

describe('discoverPools — blocklist and request shape', () => {
  beforeEach(() => {
    useMemoryStore()
    usePermissiveScreening()
  })

  afterEach(() => {
    Object.assign(config.screening, SCREENING_SNAPSHOT)
    resetStateStore()
    vi.restoreAllMocks()
  })

  /** Fixture pool that passes every threshold gate under `usePermissiveScreening()`. */
  function discoveryPool(overrides: Record<string, unknown> = {}) {
    return {
      pool_address: 'POOL_DISC',
      name: 'DISC-SOL',
      pool_type: 'dlmm',
      tvl: 50_000,
      active_tvl: 50_000,
      volume: 5_000,
      fee_active_tvl_ratio: 0.12,
      volatility: 1.1,
      base_token_holders: 5_000,
      dlmm_params: { bin_step: 100 },
      token_x: { address: 'MINT_DISC', symbol: 'DISC', holders: 5_000, market_cap: 500_000, organic_score: 70 },
      token_y: { address: 'SOLMINT', symbol: 'SOL', organic_score: 70 },
      ...overrides,
    }
  }

  /**
   * fetch router: pool-discovery `/pools` → fixture pools; the per-pool detail re-fetch
   * (volatility minimum upgrade) → echo the same pool; Jupiter assets/search → dev lookups.
   */
  function mockDiscoveryFetch(pools: Record<string, unknown>[], jupDevByMint: Record<string, string> = {}) {
    const seen: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: unknown) => {
      const url = String(input)
      seen.push(url)
      if (url.includes('pool-discovery-api.datapi.meteora.ag/pools')) {
        if (url.includes('pool_address=')) {
          const match = /pool_address=([^&]*)/.exec(url)
          const addr = match ? decodeURIComponent(match[1] ?? '') : ''
          const pool = pools.find((p) => (p as Record<string, unknown>).pool_address === addr) ?? pools[0]
          return jsonResponse({ data: pool ? [pool] : [] })
        }
        return jsonResponse({ data: pools, total: pools.length })
      }
      if (url.includes('datapi.jup.ag/v1/assets/search')) {
        const match = /query=([^&]*)/.exec(url)
        const mint = match ? decodeURIComponent(match[1] ?? '') : ''
        const dev = jupDevByMint[mint]
        return jsonResponse(dev ? [{ dev }] : [])
      }
      return jsonResponse({})
    }) as typeof fetch)
    return seen
  }

  it('drops a pool whose payload dev is on the blocklist (call site :719)', async () => {
    blockDev({ wallet: 'DEV_RUG', reason: 'serial rugger' })
    mockDiscoveryFetch([
      discoveryPool({ token_x: { address: 'MINT_DISC', dev: 'DEV_RUG', market_cap: 500_000, organic_score: 70 } }),
    ])

    const result = await discoverPools({ page_size: 50 })

    expect(result.pools).toHaveLength(0)
  })

  it('keeps a pool whose deployer is not blocked', async () => {
    blockDev({ wallet: 'SOMEONE_ELSE', reason: 'unrelated' })
    mockDiscoveryFetch([discoveryPool()])

    const result = await discoverPools({ page_size: 50 })

    expect(result.pools.map((p) => p.pool)).toContain('POOL_DISC')
  })

  it('drops a pool whose deployer resolves via Jupiter assets/search to a blocked wallet (call site :751)', async () => {
    blockDev({ wallet: 'DEV_RUG_JUP', reason: 'serial rugger' })
    // No `dev` on the payload → forces the `missingDev` Jupiter lookup path.
    mockDiscoveryFetch([discoveryPool()], { MINT_DISC: 'DEV_RUG_JUP' })

    const result = await discoverPools({ page_size: 50 })

    expect(result.pools).toHaveLength(0)
  })

  it('keeps a pool whose deployer resolves via Jupiter to a non-blocked wallet (mutation guard :751)', async () => {
    // Under `dev || isDevBlocked(dev)` this pool would be dropped: any truthy dev
    // filters the pool. The correct `&&` keeps it because the dev is not blocked.
    blockDev({ wallet: 'SOMEONE_ELSE_ENTIRELY', reason: 'unrelated' })
    mockDiscoveryFetch([discoveryPool()], { MINT_DISC: 'INNOCENT_DEV' })

    const result = await discoverPools({ page_size: 50 })

    expect(result.pools.map((p) => p.pool)).toContain('POOL_DISC')
  })

  it('requests snake_case page_size and forwards the filter chain (issue #359 guard)', async () => {
    const seen = mockDiscoveryFetch([discoveryPool()])

    await discoverPools({ page_size: 50 })

    const listUrl = seen.find((url) => url.includes('/pools?') && !url.includes('pool_address='))
    expect(listUrl).toBeDefined()
    expect(listUrl).toContain('page_size=50')
    expect(listUrl).not.toContain('pageSize')
    for (const fragment of [
      'pool_type%3Ddlmm',
      'base_token_holders%3E%3D',
      'tvl%3E%3D',
      'fee_active_tvl_ratio%3E%3D',
      'base_token_market_cap%3E%3D',
    ]) {
      expect(listUrl).toContain(fragment)
    }
  })
})

describe('getPoolDetail — DLMM fallback bucket extraction', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads the last volume and fee/TVL bucket from keyed objects (call site :450)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: unknown) => {
      const url = String(input)
      if (url.includes('pool-discovery-api.datapi.meteora.ag/pools')) {
        // Discovery has nothing indexed → forces the DLMM fallback.
        return jsonResponse({ data: [] })
      }
      return jsonResponse({
        address: 'POOL_BUCKETS',
        name: 'BUCK-SOL',
        tvl: 40_000,
        active_tvl: 40_000,
        pool_config: { bin_step: 100 },
        volume: { '5m-ago': 111, latest: 222 },
        fee_tvl_ratio: { '5m-ago': 0.01, latest: 0.02 },
        token_x: { address: 'MINTB', symbol: 'BUCK', holders: 1_000, market_cap: 200_000 },
        token_y: { address: 'SOLMINT', symbol: 'SOL' },
      })
    }) as typeof fetch)

    const detail = await getPoolDetail({ pool_address: 'POOL_BUCKETS' })

    expect(detail.volume).toBe(222)
    expect(detail.fee_active_tvl_ratio).toBe(0.02)
  })
})
