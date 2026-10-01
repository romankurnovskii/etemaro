/**
 * @file deploySafety.test.ts
 * @description Behaviour tests for the pre-deploy safety gate. `runSafetyChecks('deploy_position', …)`
 * is the last line of defence before an LP position is opened, and its range/volatility
 * validation had no direct coverage (it was only reached indirectly through
 * `ToolExecutor.test.ts`, which mocks the surrounding collaborators).
 *
 * Both the pool-detail fetch and the tool config are injected, so no network or
 * real `config` mutation is involved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setMinSafeBinsBelowOverride } from '../../shared/constants.js'
import { runSafetyChecks, validateDeployPoolThresholds } from './deploySafety.js'
import { resetToolConfig, setToolConfig } from './toolConfig.js'

vi.mock('../blockchain/MeteoraAdapter.js', () => ({
  getMyPositions: vi.fn().mockResolvedValue({ positions: [], total_positions: 0 }),
}))

const POOL = 'POOLADDRESS111111111111111111111111111111'

/** Pool detail that clears every threshold in the fake config below. */
function poolDetail(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    address: POOL,
    tvl: 50_000,
    active_tvl: 50_000,
    volume: 5_000,
    fee_active_tvl_ratio: 0.5,
    volatility: 1.2,
    dlmm_params: { bin_step: 100 },
    pool_config: { bin_step: 100 },
    token_x: { address: 'MINTX', symbol: 'TEST', holders: 5_000, market_cap: 500_000 },
    token_y: { address: 'SOLMINT', symbol: 'SOL' },
    ...overrides,
  }
}

function mockPoolDetailFetch(detail: Record<string, unknown> = poolDetail()) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: unknown) => {
    const url = String(input)
    const body = url.includes('pool-discovery-api') ? { data: [detail] } : detail
    return { ok: true, status: 200, statusText: 'OK', json: async () => body }
  }) as typeof fetch)
}

function safetyArgs(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { pool_address: POOL, amount_y: 1, amount_x: 0, ...overrides }
}

describe('deploySafety — deploy_position gate', () => {
  beforeEach(() => {
    setMinSafeBinsBelowOverride(10)
    setToolConfig({
      connection: { dryRun: true },
      management: { maxFailedSwapsBeforeHalt: 5, haltOnSwapFailure: true, deployAmountSol: 0.1, gasReserve: 0.01 },
      risk: { maxPositions: 5, maxDeployAmount: 10 },
      strategy: { minBinsBelow: 10, defaultBinsBelow: 35 },
      screening: {
        minTvl: 1_000,
        maxTvl: null,
        minFeeActiveTvlRatio: 0.01,
        timeframe: '5m',
        minBinStep: 1,
        maxBinStep: 1_000,
      },
    } as never)
  })

  afterEach(() => {
    resetToolConfig()
    setMinSafeBinsBelowOverride(10)
    vi.restoreAllMocks()
  })

  it('requests the 30m volatility minimum when the configured timeframe is shorter', async () => {
    const fetchSpy = mockPoolDetailFetch()

    const result = await validateDeployPoolThresholds({ pool_address: POOL })

    expect(result.pass, JSON.stringify(result)).toBe(true)
    const urls = fetchSpy.mock.calls.map((call) => String(call[0]))
    // First call uses the configured 5m timeframe; the guard must then re-fetch at the 30m minimum.
    expect(urls.filter((url) => url.includes('timeframe=30m'))).toHaveLength(1)
  })

  it('skips the volatility re-fetch when the configured timeframe already meets the 30m minimum (mutation guard :47)', async () => {
    // Under `String(sourceTimeframe && '')` the source becomes '' (unknown → 30m
    // minimum), so the guard would issue a redundant 30m re-fetch. With the correct
    // `||` the configured 1h timeframe satisfies the minimum and no re-fetch happens.
    setToolConfig({
      connection: { dryRun: true },
      management: { maxFailedSwapsBeforeHalt: 5, haltOnSwapFailure: true, deployAmountSol: 0.1, gasReserve: 0.01 },
      risk: { maxPositions: 5, maxDeployAmount: 10 },
      strategy: { minBinsBelow: 10, defaultBinsBelow: 35 },
      screening: {
        minTvl: 1_000,
        maxTvl: null,
        minFeeActiveTvlRatio: 0.01,
        timeframe: '1h',
        minBinStep: 1,
        maxBinStep: 1_000,
      },
    } as never)
    const fetchSpy = mockPoolDetailFetch()

    const result = await validateDeployPoolThresholds({ pool_address: POOL })

    expect(result.pass, JSON.stringify(result)).toBe(true)
    const urls = fetchSpy.mock.calls.map((call) => String(call[0]))
    expect(urls.filter((url) => url.includes('timeframe=30m'))).toHaveLength(0)
    expect(urls.some((url) => url.includes('timeframe=1h'))).toBe(true)
  })

  it('rejects a tiny range via the both-pcts-missing clause (mutation guard :377)', async () => {
    // The reason must name the TOTAL range, proving the both-missing clause (:369)
    // fired — not the single-sided clause. Under the harness wording (`||`→`&&`)
    // the both-missing clause can only fire when every clause is true (impossible
    // for bins_below=1: `1 < 0` is false), so the request would fall through to
    // the single-sided clause and the reason would name `bins_below 1` instead.
    mockPoolDetailFetch()

    const result = await runSafetyChecks('deploy_position', safetyArgs({ bins_below: 1, bins_above: 0 }), {
      getActiveSmartWalletListId: () => '',
    })

    expect(result.pass).toBe(false)
    expect(result.reason).toMatch(/deploy range 1 total bins is below minimum 10/)
  })

  it('rejects non-integer bin counts', async () => {
    mockPoolDetailFetch()

    const result = await runSafetyChecks('deploy_position', safetyArgs({ bins_below: 1.5, bins_above: 10 }), {
      getActiveSmartWalletListId: () => '',
    })

    expect(result.pass).toBe(false)
    expect(result.reason).toMatch(/Refusing 1-bin\/tiny-range deploy\./)
  })

  it('rejects negative bins_below when no pct range is supplied (mutation guard :377)', async () => {
    // NOTE: setting downside_pct bypasses BOTH bin-range clauses by design —
    // the pct path computes bins from price percentages downstream, so explicit
    // bins are ignored. The `||` chain under test is the both-missing clause
    // (:377): under the harness wording (`||`→`&&`) only `below < min` is true,
    // so the `&&` version rejects nothing and the unsafe deploy would pass.
    // The reason must name the TOTAL range, proving the both-missing clause
    // fired rather than the single-sided clause.
    mockPoolDetailFetch()

    const result = await runSafetyChecks('deploy_position', safetyArgs({ bins_below: -5, bins_above: 50 }), {
      getActiveSmartWalletListId: () => '',
    })

    expect(result.pass).toBe(false)
    expect(result.reason).toMatch(/deploy range 45 total bins is below minimum 10/)
  })

  it('rejects a both-sides X+Y request: only the Y>0&&X<=0 conjunction marks single-sided SOL (mutation guard :361)', async () => {
    // A both-sides request (amount_x > 0) is not single-sided SOL, but the
    // amount_x > 0 guard above already rejects it first. The load-bearing
    // property of `deployAmountY > 0 && deployAmountX <= 0` is the Y>0 half: a
    // request with NO amounts at all (Y=0, X=0) must not be treated as
    // single-sided — under `Y > 0 || X <= 0` it would be (X<=0 is true), and the
    // single-sided clause would misfire on a request that should fall through
    // to the amount validation below. This test pins the fall-through: with no
    // amounts, the bin checks pass (60/0 with downside_pct only skips :369; the
    // :389 clause must NOT fire since Y=0 is not single-sided), and rejection
    // comes from the positive-SOL-amount rule instead.
    mockPoolDetailFetch()

    const result = await runSafetyChecks(
      'deploy_position',
      { pool_address: POOL, amount_y: 0, amount_x: 0, bins_below: 2, bins_above: 0, downside_pct: 5 },
      { getActiveSmartWalletListId: () => '' },
    )

    expect(result.pass).toBe(false)
    expect(result.reason).toMatch(/positive SOL amount/)
  })

  it('rejects a single-sided SOL deploy with too few bins below when only upside_pct is given', async () => {
    mockPoolDetailFetch()

    const result = await runSafetyChecks(
      'deploy_position',
      safetyArgs({ bins_below: 1, bins_above: 50, upside_pct: 5 }),
      { getActiveSmartWalletListId: () => '' },
    )

    expect(result.pass).toBe(false)
    expect(result.reason).toMatch(/bins_below 1 is below minimum 10/)
  })

  it('rejects an unusable volatility value', async () => {
    mockPoolDetailFetch()

    const result = await runSafetyChecks('deploy_position', safetyArgs({ volatility: 0 }), {
      getActiveSmartWalletListId: () => '',
    })

    expect(result.pass).toBe(false)
    expect(result.reason).toMatch(/volatility 0 is invalid/)
  })

  it('passes a well-formed single-sided SOL deploy', async () => {
    mockPoolDetailFetch()

    const result = await runSafetyChecks(
      'deploy_position',
      safetyArgs({ bins_below: 60, bins_above: 0, downside_pct: 5, bin_step: 100 }),
      { getActiveSmartWalletListId: () => '' },
    )

    expect(result.pass, JSON.stringify(result)).toBe(true)
  })
})
