import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../config/Config.js'
import { getPendingLiquidation } from '../domain/liquidation-queue.js'
import { __setStateFilePath, getConsecutiveSwapFailures, resetConsecutiveSwapFailures } from '../domain/state.js'
import * as MeteoraAdapter from './blockchain/MeteoraAdapter.js'
import * as WalletAdapter from './blockchain/WalletAdapter.js'
import { tools } from './ToolDefinitions.js'
import {
  closeAllPositions,
  executeTool,
  getPortfolioSummary,
  swapAllTokensToSol,
  swapBaseToSolWithRetry,
  sweepUnsoldTokens,
  toolRegistry,
  WRITE_TOOLS,
  writeToolsMutex,
} from './ToolExecutor.js'

const TMP_STATE = path.join(os.tmpdir(), `etemaro-toolexecutor-test-${process.pid}.json`)

beforeAll(() => {
  __setStateFilePath(TMP_STATE)
})

afterAll(() => {
  if (fs.existsSync(TMP_STATE)) fs.unlinkSync(TMP_STATE)
})

// Mock the WalletAdapter functions
vi.mock('./blockchain/WalletAdapter.js', () => ({
  getWalletBalances: vi.fn(),
  swapToken: vi.fn(),
}))

vi.mock('./blockchain/MeteoraAdapter.js', () => ({
  getActiveBin: vi.fn(),
  deployPosition: vi.fn(),
  getMyPositions: vi.fn(),
  getWalletPositions: vi.fn(),
  getPositionPnl: vi.fn(),
  claimFees: vi.fn(),
  closePosition: vi.fn(),
  searchPools: vi.fn(),
  swapDirectDlmm: vi.fn(),
}))

vi.mock('./notifications/TelegramAdapter.js', () => ({
  notifyClose: vi.fn().mockResolvedValue(undefined),
  notifyDeploy: vi.fn().mockResolvedValue(undefined),
  notifySwap: vi.fn().mockResolvedValue(undefined),
  notifySwapError: vi.fn().mockResolvedValue(undefined),
  notifyTransactionError: vi.fn().mockResolvedValue(undefined),
  notifyLiquidationAlert: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./blockchain/ScreeningAdapter.js', () => ({
  discoverPools: vi.fn(),
  getPoolDetail: vi.fn(),
  getTopCandidates: vi.fn(),
}))

// Mock logger to avoid noisy output during tests
vi.mock('../shared/logger.js', () => ({
  log: vi.fn(),
  logAction: vi.fn(),
  logStructured: vi.fn(),
}))

describe('ToolExecutor - swapAllTokensToSol', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should swap all non-SOL, non-USDC tokens with value >= $0.10', async () => {
    // Arrange
    const mockBalances = {
      tokens: [
        { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', balance: 10, usd: 1500 },
        { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', balance: 100, usd: 100 },
        { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', balance: 1000000, usd: 25.5 },
        { mint: 'DUST1111111111111111111111111111111111111111', symbol: 'DUST', balance: 100, usd: 0.01 },
      ],
    }

    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValue(mockBalances as any)
    vi.mocked(WalletAdapter.swapToken).mockResolvedValue({ success: true, tx: 'test-tx' } as any)

    // Act
    const result = await swapAllTokensToSol(['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'])

    // Assert
    expect(result.total).toBe(4) // All tokens considered
    expect(result.skipped).toBe(3) // SOL, USDC, DUST
    expect(result.successful).toBe(1)
    expect(result.failed).toBe(0)

    // Check that swapToken was called correctly for BONK
    expect(WalletAdapter.swapToken).toHaveBeenCalledTimes(1)
    expect(WalletAdapter.swapToken).toHaveBeenCalledWith({
      input_mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
      output_mint: 'SOL',
      amount: 1000000,
    })
  })

  it('should swap unpriced tokens (usd: null) when balance > 0', async () => {
    const mockBalances = {
      tokens: [
        { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', balance: 10, usd: 1500 },
        { mint: 'UNPRICED11111111111111111111111111111111111', symbol: 'UNP', balance: 500, usd: null },
        { mint: 'ZERO1111111111111111111111111111111111111111', symbol: 'ZERO', balance: 0, usd: null },
      ],
    }

    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValue(mockBalances as any)
    vi.mocked(WalletAdapter.swapToken).mockResolvedValue({ success: true, tx: 'test-tx-unpriced' } as any)

    const result = await swapAllTokensToSol([])

    expect(result.total).toBe(3)
    expect(result.skipped).toBe(2) // SOL, ZERO balance
    expect(result.successful).toBe(1) // UNP swapped
    expect(WalletAdapter.swapToken).toHaveBeenCalledWith({
      input_mint: 'UNPRICED11111111111111111111111111111111111',
      output_mint: 'SOL',
      amount: 500,
    })
  })

  it('should swap unpriced tokens (usd: undefined) when balance > 0', async () => {
    const mockBalances = {
      tokens: [{ mint: 'UNDEF111111111111111111111111111111111111111', symbol: 'UNDEF', balance: 250, usd: undefined }],
    }

    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValue(mockBalances as any)
    vi.mocked(WalletAdapter.swapToken).mockResolvedValue({ success: true, tx: 'test-tx-undef' } as any)

    const result = await swapAllTokensToSol([])

    expect(result.total).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.successful).toBe(1)
    expect(WalletAdapter.swapToken).toHaveBeenCalledWith({
      input_mint: 'UNDEF111111111111111111111111111111111111111',
      output_mint: 'SOL',
      amount: 250,
    })
  })

  it('should correctly handle dust threshold boundaries ($0.019 skipped vs $0.02 swapped)', async () => {
    const mockBalances = {
      tokens: [
        { mint: 'DUST_BELOW111111111111111111111111111111111', symbol: 'DUST1', balance: 100, usd: 0.019 },
        { mint: 'DUST_EXACT111111111111111111111111111111111', symbol: 'EXACT', balance: 200, usd: 0.02 },
      ],
    }

    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValue(mockBalances as any)
    vi.mocked(WalletAdapter.swapToken).mockResolvedValue({ success: true, tx: 'test-tx-boundary' } as any)

    const result = await swapAllTokensToSol([])

    expect(result.total).toBe(2)
    expect(result.skipped).toBe(1) // usd: 0.019 is skipped as dust (< 0.02)
    expect(result.successful).toBe(1) // usd: 0.02 is NOT skipped and successfully swapped
    expect(WalletAdapter.swapToken).toHaveBeenCalledTimes(1)
    expect(WalletAdapter.swapToken).toHaveBeenCalledWith({
      input_mint: 'DUST_EXACT111111111111111111111111111111111',
      output_mint: 'SOL',
      amount: 200,
    })
  })

  it('should accept object input { skipMints: [] } without throwing error', async () => {
    const mockBalances = { tokens: [] }
    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValue(mockBalances as any)

    const result = await swapAllTokensToSol({ skipMints: [] } as any)
    expect(result.total).toBe(0)
  })
})

describe('ToolExecutor - swapBaseToSolWithRetry', () => {
  const originalDelay = config.management.autoSwapRetryDelayMs
  const originalAttempts = config.management.autoSwapRetryAttempts

  beforeEach(() => {
    vi.clearAllMocks()
    config.management.autoSwapRetryDelayMs = 0
    config.management.autoSwapRetryAttempts = 3
  })

  afterEach(() => {
    config.management.autoSwapRetryDelayMs = originalDelay
    config.management.autoSwapRetryAttempts = originalAttempts
  })

  it('swaps unpriced tokens (usd: null) when balance > 0', async () => {
    const baseMint = 'UNPRICED_TOKEN_MINT_11111111111111111111'
    const mockBalances = {
      tokens: [{ mint: baseMint, symbol: 'UNP', balance: 1200, usd: null }],
    }
    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValue(mockBalances as any)
    vi.mocked(WalletAdapter.swapToken).mockResolvedValue({
      success: true,
      tx: 'tx-unp-123',
      amount_out: '0.08',
    } as any)

    const res = await swapBaseToSolWithRetry(baseMint, 'test unpriced')

    expect(res.swapped).toBe(true)
    expect(res.result).toMatchObject({ success: true, tx: 'tx-unp-123' })
    expect(WalletAdapter.swapToken).toHaveBeenCalledTimes(1)
    expect(WalletAdapter.swapToken).toHaveBeenCalledWith({
      input_mint: baseMint,
      output_mint: 'SOL',
      amount: 1200,
    })
  })

  it('swaps unpriced tokens (usd: undefined) when balance > 0', async () => {
    const baseMint = 'UNDEF_TOKEN_MINT_1111111111111111111111'
    const mockBalances = {
      tokens: [{ mint: baseMint, symbol: 'UND', balance: 850, usd: undefined }],
    }
    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValue(mockBalances as any)
    vi.mocked(WalletAdapter.swapToken).mockResolvedValue({
      success: true,
      tx: 'tx-und-123',
      amount_out: '0.05',
    } as any)

    const res = await swapBaseToSolWithRetry(baseMint, 'test undefined usd')

    expect(res.swapped).toBe(true)
    expect(res.result).toMatchObject({ success: true, tx: 'tx-und-123' })
    expect(WalletAdapter.swapToken).toHaveBeenCalledWith({
      input_mint: baseMint,
      output_mint: 'SOL',
      amount: 850,
    })
  })

  it('skips swap when token balance <= 0', async () => {
    const baseMint = 'ZERO_TOKEN_MINT_1111111111111111111111'
    const mockBalances = {
      tokens: [{ mint: baseMint, symbol: 'ZERO', balance: 0, usd: null }],
    }
    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValue(mockBalances as any)

    const res = await swapBaseToSolWithRetry(baseMint, 'test zero balance')

    expect(res.swapped).toBe(false)
    expect(res.result).toBeNull()
    expect(WalletAdapter.swapToken).not.toHaveBeenCalled()
  })

  it('correctly handles $0.05 dust threshold boundary ($0.049 skipped vs $0.05 swapped)', async () => {
    const dustMint = 'DUST_MINT_1111111111111111111111111111'
    const validMint = 'VALID_MINT_111111111111111111111111111'

    // 1. Below threshold: usd = 0.049 (should skip)
    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValueOnce({
      tokens: [{ mint: dustMint, symbol: 'DUST', balance: 100, usd: 0.049 }],
    } as any)

    const dustRes = await swapBaseToSolWithRetry(dustMint, 'test dust')
    expect(dustRes.swapped).toBe(false)
    expect(WalletAdapter.swapToken).not.toHaveBeenCalled()

    // 2. Exactly at threshold: usd = 0.05 (should NOT skip, should swap)
    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValueOnce({
      tokens: [{ mint: validMint, symbol: 'VALID', balance: 200, usd: 0.05 }],
    } as any)
    vi.mocked(WalletAdapter.swapToken).mockResolvedValueOnce({
      success: true,
      tx: 'tx-valid-50',
      amount_out: '0.0003',
    } as any)

    const validRes = await swapBaseToSolWithRetry(validMint, 'test boundary')
    expect(validRes.swapped).toBe(true)
    expect(WalletAdapter.swapToken).toHaveBeenCalledTimes(1)
    expect(WalletAdapter.swapToken).toHaveBeenCalledWith({
      input_mint: validMint,
      output_mint: 'SOL',
      amount: 200,
    })
  })

  it('retries unpriced token (usd: null) on transient failure and succeeds on attempt 2', async () => {
    const baseMint = 'RETRY_TOKEN_MINT_111111111111111111111'
    const mockBalances = {
      tokens: [{ mint: baseMint, symbol: 'RETRY', balance: 500, usd: null }],
    }
    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValue(mockBalances as any)

    // Attempt 1 fails, Attempt 2 succeeds
    vi.mocked(WalletAdapter.swapToken)
      .mockResolvedValueOnce({ success: false, error: 'Slippage exceeded' } as any)
      .mockResolvedValueOnce({ success: true, tx: 'tx-retry-success', amount_out: '0.04' } as any)

    const res = await swapBaseToSolWithRetry(baseMint, 'test retry')

    expect(res.swapped).toBe(true)
    expect(res.result).toMatchObject({ success: true, tx: 'tx-retry-success' })
    expect(WalletAdapter.swapToken).toHaveBeenCalledTimes(2)
  })

  it('records failure and gracefully handles when all retry attempts fail for unpriced token', async () => {
    const baseMint = 'FAIL_TOKEN_MINT_1111111111111111111111'
    const mockBalances = {
      tokens: [{ mint: baseMint, symbol: 'FAIL', balance: 500, usd: null }],
    }
    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValue(mockBalances as any)
    vi.mocked(WalletAdapter.swapToken).mockResolvedValue({ success: false, error: 'No route found' } as any)

    const res = await swapBaseToSolWithRetry(baseMint, 'test all fail')

    expect(res.swapped).toBe(false)
    expect(res.result).toBeNull()
    expect(WalletAdapter.swapToken).toHaveBeenCalledTimes(3)
  })

  it('does not trip the deploy circuit for best-effort cleanup swaps (affectsCircuit:false)', async () => {
    resetConsecutiveSwapFailures()
    const baseMint = 'SWEEPER_DEAD_MINT_111111111111111111'
    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValue({
      tokens: [{ mint: baseMint, symbol: 'DEAD', balance: 500, usd: 1.5 }],
    } as any)
    vi.mocked(WalletAdapter.swapToken).mockResolvedValue({ success: false, error: 'No route found' } as any)

    await swapBaseToSolWithRetry(baseMint, 'sweeper', 0.05, null, null, { affectsCircuit: false })
    expect(getConsecutiveSwapFailures()).toBe(0)

    await swapBaseToSolWithRetry(baseMint, 'after close', 0.05, null, null)
    expect(getConsecutiveSwapFailures()).toBe(1)
  })

  it('abandons immediately without further retries when swapToken returns liquidity.unavailable (TOKEN_NOT_TRADABLE)', async () => {
    const baseMint = 'DEAD_TOKEN_MINT_1111111111111111111111'
    const mockBalances = {
      tokens: [{ mint: baseMint, symbol: 'DEAD', balance: 500, usd: 1.5 }],
    }
    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValue(mockBalances as any)
    vi.mocked(WalletAdapter.swapToken).mockResolvedValue({
      success: false,
      error: 'Token is not tradable',
      error_code: 'TOKEN_NOT_TRADABLE',
      error_category: 'liquidity.unavailable',
      request_id: 'req-dead-1',
    } as any)

    const res = await swapBaseToSolWithRetry(baseMint, 'test dead token')

    expect(res.swapped).toBe(false)
    expect(res.abandonImmediately).toBe(true)
    expect(res.errorCode).toBe('TOKEN_NOT_TRADABLE')
    expect(res.errorCategory).toBe('liquidity.unavailable')
    // Crucial: abandons on attempt 1, does NOT waste 3 attempts!
    expect(WalletAdapter.swapToken).toHaveBeenCalledTimes(1)

    const queued = getPendingLiquidation(baseMint)
    expect(queued).not.toBeNull()
    expect(queued?.status).toBe('abandoned')
    expect(queued?.last_error_code).toBe('TOKEN_NOT_TRADABLE')
  })

  it('retries with reduced amount (50%) when swapToken returns liquidity.partial', async () => {
    const baseMint = 'PARTIAL_MINT_1111111111111111111111111'
    const mockBalances = {
      tokens: [{ mint: baseMint, symbol: 'PARTIAL', balance: 500, usd: 2.0 }],
    }
    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValue(mockBalances as any)
    vi.mocked(WalletAdapter.swapToken)
      .mockResolvedValueOnce({
        success: false,
        error: 'Route plan does not consume all amount',
        error_code: 'ROUTE_PLAN_DOES_NOT_CONSUME_ALL_THE_AMOUNT',
        error_category: 'liquidity.partial',
      } as any)
      .mockResolvedValueOnce({
        success: true,
        tx: 'tx-partial-success',
        amount_out: '0.01',
      } as any)

    const res = await swapBaseToSolWithRetry(baseMint, 'test partial retry')

    expect(res.swapped).toBe(true)
    expect(WalletAdapter.swapToken).toHaveBeenCalledTimes(2)
    // 1st attempt: full balance (500)
    expect(WalletAdapter.swapToken).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        amount: 500,
      }),
    )
    // 2nd attempt: reduced balance by 50% (250)
    expect(WalletAdapter.swapToken).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        amount: 250,
      }),
    )
  })

  it('retries with increased slippage when swapToken returns slippage.exceeded', async () => {
    const baseMint = 'SLIPPAGE_MINT_111111111111111111111111'
    const mockBalances = {
      tokens: [{ mint: baseMint, symbol: 'SLIPPAGE', balance: 300, usd: 1.0 }],
    }
    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValue(mockBalances as any)
    vi.mocked(WalletAdapter.swapToken)
      .mockResolvedValueOnce({
        success: false,
        error: 'SlippageToleranceExceeded',
        error_code: 'SlippageToleranceExceeded',
        error_category: 'slippage.exceeded',
      } as any)
      .mockResolvedValueOnce({
        success: true,
        tx: 'tx-slippage-success',
        amount_out: '0.008',
      } as any)

    const res = await swapBaseToSolWithRetry(baseMint, 'test slippage retry')

    expect(res.swapped).toBe(true)
    expect(WalletAdapter.swapToken).toHaveBeenCalledTimes(2)
    // 2nd attempt: increased slippage (200 bps)
    expect(WalletAdapter.swapToken).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        slippageBps: 200,
      }),
    )
  })

  it('sweepUnsoldTokens immediately abandons token on liquidity.unavailable failure', async () => {
    const deadMint = 'DEAD_SWEEPER_MINT_11111111111111111111'
    const mockBalances = {
      tokens: [{ mint: deadMint, symbol: 'DEADSWEEP', balance: 1000, usd: 5.0 }],
    }
    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValue(mockBalances as any)
    vi.mocked(WalletAdapter.swapToken).mockResolvedValue({
      success: false,
      error: 'Failed to get quotes',
      error_code: 'Failed to get quotes',
      error_category: 'liquidity.unavailable',
    } as any)

    const sweepResult = await sweepUnsoldTokens()

    expect(sweepResult.abandoned).toBe(1)
    expect(sweepResult.failed).toBe(0)
    const item = getPendingLiquidation(deadMint)
    expect(item?.status).toBe('abandoned')
    expect(item?.last_error_code).toBe('Failed to get quotes')
  })
})

describe('ToolExecutor - deploy_position serialization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('DRY_RUN', 'false')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              address: 'pool-one',
              tvl: 100_000,
              fee_active_tvl_ratio: { '5m': 1 },
              volatility: 1,
              dlmm_params: { bin_step: 100 },
            },
          ],
        }),
      }),
    )
    vi.mocked(MeteoraAdapter.getMyPositions).mockResolvedValue({ positions: [], total_positions: 0 } as any)
    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValue({ sol: 10, tokens: [] } as any)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('does not run a second balance check until the first deploy has completed', async () => {
    let releaseFirstDeploy!: () => void
    const firstDeployFinished = new Promise<void>((resolve) => {
      releaseFirstDeploy = resolve
    })
    let inFlightDeploys = 0
    let maxInFlightDeploys = 0
    vi.mocked(MeteoraAdapter.deployPosition).mockImplementation(async () => {
      inFlightDeploys++
      maxInFlightDeploys = Math.max(maxInFlightDeploys, inFlightDeploys)
      if (inFlightDeploys === 1) await firstDeployFinished
      inFlightDeploys--
      return { success: true, position: `position-${Date.now()}` } as any
    })

    const args = {
      pool_address: 'pool-one',
      amount_y: 0.5,
      bins_below: 35,
      bins_above: 0,
    }
    const first = executeTool('deploy_position', { ...args })
    await vi.waitFor(() => expect(MeteoraAdapter.deployPosition).toHaveBeenCalledTimes(1))
    const second = executeTool('deploy_position', { ...args, pool_address: 'pool-two' })

    await Promise.resolve()
    expect(MeteoraAdapter.getMyPositions).toHaveBeenCalledTimes(1)
    expect(MeteoraAdapter.deployPosition).toHaveBeenCalledTimes(1)
    expect(maxInFlightDeploys).toBe(1)

    releaseFirstDeploy()
    await Promise.all([first, second])
    expect(MeteoraAdapter.getMyPositions).toHaveBeenCalledTimes(2)
    expect(MeteoraAdapter.deployPosition).toHaveBeenCalledTimes(2)
    expect(maxInFlightDeploys).toBe(1)
  })

  it('releases the lock when a safety check rejects', async () => {
    vi.mocked(MeteoraAdapter.getMyPositions)
      .mockRejectedValueOnce(new Error('safety check failed'))
      .mockResolvedValue({ positions: [], total_positions: 0 } as any)
    vi.mocked(MeteoraAdapter.deployPosition).mockResolvedValue({ success: true, position: 'position-two' } as any)

    const args = {
      pool_address: 'pool-one',
      amount_y: 0.5,
      bins_below: 35,
      bins_above: 0,
    }
    const first = executeTool('deploy_position', args)
    await expect(first).rejects.toThrow('safety check failed')

    await expect(executeTool('deploy_position', { ...args, pool_address: 'pool-two' })).resolves.toMatchObject({
      success: true,
    })
    expect(MeteoraAdapter.deployPosition).toHaveBeenCalledTimes(1)
  })

  it('defines WRITE_TOOLS containing all mutating tools and locks writeToolsMutex during execution', async () => {
    expect(WRITE_TOOLS).toEqual(
      new Set([
        'deploy_position',
        'claim_fees',
        'close_position',
        'close_all_positions',
        'swap_token',
        'swap_all_tokens_to_sol',
        'sweep_unsold_tokens',
      ]),
    )

    let lockObserved = false
    let releaseSwap!: () => void
    const swapFinished = new Promise<void>((resolve) => {
      releaseSwap = resolve
    })

    vi.mocked(WalletAdapter.swapToken).mockImplementation(async () => {
      lockObserved = writeToolsMutex.isLocked()
      await swapFinished
      return { success: true, tx: 'swap-tx' } as any
    })

    expect(writeToolsMutex.isLocked()).toBe(false)
    const pendingSwap = executeTool('swap_token', {
      input_mint: 'TOKEN_A',
      output_mint: 'SOL',
      amount: 100,
    })

    await vi.waitFor(() => expect(writeToolsMutex.isLocked()).toBe(true))
    releaseSwap()
    await pendingSwap

    expect(lockObserved).toBe(true)
    expect(writeToolsMutex.isLocked()).toBe(false)
  })

  it('serializes concurrent swap_token calls to prevent parallel execution', async () => {
    let inFlightSwaps = 0
    let maxInFlightSwaps = 0
    let releaseFirstSwap!: () => void
    const firstSwapFinished = new Promise<void>((resolve) => {
      releaseFirstSwap = resolve
    })

    vi.mocked(WalletAdapter.swapToken).mockImplementation(async () => {
      inFlightSwaps++
      maxInFlightSwaps = Math.max(maxInFlightSwaps, inFlightSwaps)
      if (inFlightSwaps === 1) await firstSwapFinished
      inFlightSwaps--
      return { success: true, tx: `tx-${Date.now()}` } as any
    })

    const swap1 = executeTool('swap_token', {
      input_mint: 'TOKEN_A',
      output_mint: 'SOL',
      amount: 100,
    })
    const swap2 = executeTool('swap_token', {
      input_mint: 'TOKEN_B',
      output_mint: 'SOL',
      amount: 200,
    })

    await vi.waitFor(() => expect(WalletAdapter.swapToken).toHaveBeenCalledTimes(1))
    expect(maxInFlightSwaps).toBe(1)

    releaseFirstSwap()
    await Promise.all([swap1, swap2])

    expect(WalletAdapter.swapToken).toHaveBeenCalledTimes(2)
    expect(maxInFlightSwaps).toBe(1)
  })

  it('serializes concurrent claim_fees calls', async () => {
    let inFlightClaims = 0
    let maxInFlightClaims = 0
    let releaseFirstClaim!: () => void
    const firstClaimFinished = new Promise<void>((resolve) => {
      releaseFirstClaim = resolve
    })

    vi.mocked(MeteoraAdapter.claimFees).mockImplementation(async () => {
      inFlightClaims++
      maxInFlightClaims = Math.max(maxInFlightClaims, inFlightClaims)
      if (inFlightClaims === 1) await firstClaimFinished
      inFlightClaims--
      return { success: true, tx: `tx-claim-${Date.now()}` } as any
    })

    const claim1 = executeTool('claim_fees', { position_address: 'pos-1' })
    const claim2 = executeTool('claim_fees', { position_address: 'pos-2' })

    await vi.waitFor(() => expect(MeteoraAdapter.claimFees).toHaveBeenCalledTimes(1))
    expect(maxInFlightClaims).toBe(1)

    releaseFirstClaim()
    await Promise.all([claim1, claim2])

    expect(MeteoraAdapter.claimFees).toHaveBeenCalledTimes(2)
    expect(maxInFlightClaims).toBe(1)
  })

  it('serializes concurrent close_position calls', async () => {
    let inFlightCloses = 0
    let maxInFlightCloses = 0
    let releaseFirstClose!: () => void
    const firstCloseFinished = new Promise<void>((resolve) => {
      releaseFirstClose = resolve
    })

    vi.mocked(MeteoraAdapter.closePosition).mockImplementation(async () => {
      inFlightCloses++
      maxInFlightCloses = Math.max(maxInFlightCloses, inFlightCloses)
      if (inFlightCloses === 1) await firstCloseFinished
      inFlightCloses--
      return { success: true, position: 'pos-closed' } as any
    })

    const close1 = executeTool('close_position', { position_address: 'pos-1', skip_swap: true })
    const close2 = executeTool('close_position', { position_address: 'pos-2', skip_swap: true })

    await vi.waitFor(() => expect(MeteoraAdapter.closePosition).toHaveBeenCalledTimes(1))
    expect(maxInFlightCloses).toBe(1)

    releaseFirstClose()
    await Promise.all([close1, close2])

    expect(MeteoraAdapter.closePosition).toHaveBeenCalledTimes(2)
    expect(maxInFlightCloses).toBe(1)
  })

  it('serializes close_all_positions without deadlocking on internal close_position calls', async () => {
    vi.mocked(MeteoraAdapter.getMyPositions).mockResolvedValue({
      positions: [
        { position: 'pos-1', base_mint: 'mint1', pool: 'pool1' },
        { position: 'pos-2', base_mint: 'mint2', pool: 'pool2' },
      ],
      total_positions: 2,
    } as any)

    vi.mocked(MeteoraAdapter.closePosition).mockResolvedValue({
      success: true,
      position: 'pos-closed',
      base_mint: 'mint1',
      pool_name: 'pool1',
    } as any)

    const result = (await executeTool('close_all_positions', { skip_swap: true })) as any

    expect(result).toBeDefined()
    expect(result.successful).toBe(2)
    expect(MeteoraAdapter.closePosition).toHaveBeenCalledTimes(2)

    // Also verify direct function invocation works
    const directResult = await closeAllPositions(true)
    expect(directResult.successful).toBe(2)
    expect(MeteoraAdapter.closePosition).toHaveBeenCalledTimes(4)
  })

  it('serializes swap_all_tokens_to_sol calls', async () => {
    let inFlightBatchSwaps = 0
    let maxInFlightBatchSwaps = 0
    let releaseFirstBatch!: () => void
    const firstBatchFinished = new Promise<void>((resolve) => {
      releaseFirstBatch = resolve
    })

    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValue({
      tokens: [{ mint: 'TOKEN_XYZ', symbol: 'XYZ', balance: 100, usd: 5 }],
    } as any)

    vi.mocked(WalletAdapter.swapToken).mockImplementation(async () => {
      inFlightBatchSwaps++
      maxInFlightBatchSwaps = Math.max(maxInFlightBatchSwaps, inFlightBatchSwaps)
      if (inFlightBatchSwaps === 1) await firstBatchFinished
      inFlightBatchSwaps--
      return { success: true, tx: 'batch-tx' } as any
    })

    const batch1 = executeTool('swap_all_tokens_to_sol', {})
    const batch2 = executeTool('swap_all_tokens_to_sol', {})

    await vi.waitFor(() => expect(WalletAdapter.swapToken).toHaveBeenCalledTimes(1))
    expect(maxInFlightBatchSwaps).toBe(1)

    releaseFirstBatch()
    await Promise.all([batch1, batch2])

    expect(WalletAdapter.swapToken).toHaveBeenCalledTimes(2)
    expect(maxInFlightBatchSwaps).toBe(1)
  })

  it('dispatches swap_all_tokens_to_sol via executeTool and respects skipMints / skip_mints', async () => {
    const skipMint = 'SKIP_THIS_MINT_111111111111111111111111'
    const swapMint = 'SWAP_THIS_MINT_111111111111111111111111'

    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValue({
      tokens: [
        { mint: skipMint, symbol: 'SKP', balance: 500, usd: 10 },
        { mint: swapMint, symbol: 'SWP', balance: 1000, usd: 20 },
      ],
    } as any)

    vi.mocked(WalletAdapter.swapToken).mockResolvedValue({
      success: true,
      tx: 'tx-batch-dispatched',
    } as any)

    // Test with camelCase skipMints
    const res1 = (await executeTool('swap_all_tokens_to_sol', {
      skipMints: [skipMint],
    })) as any

    expect(res1.successful).toBe(1)
    expect(res1.skipped).toBe(1)
    expect(WalletAdapter.swapToken).toHaveBeenCalledWith({
      input_mint: swapMint,
      output_mint: 'SOL',
      amount: 1000,
    })

    // Test with snake_case skip_mints
    vi.mocked(WalletAdapter.swapToken).mockClear()
    const res2 = (await executeTool('swap_all_tokens_to_sol', {
      skip_mints: [skipMint],
    })) as any

    expect(res2.successful).toBe(1)
    expect(res2.skipped).toBe(1)
    expect(WalletAdapter.swapToken).toHaveBeenCalledWith({
      input_mint: swapMint,
      output_mint: 'SOL',
      amount: 1000,
    })
  })

  it('registers swap_all_tokens_to_sol in ToolDefinitions.ts with correct schema', () => {
    const swapAllDef = tools.find((t) => t.function.name === 'swap_all_tokens_to_sol')
    expect(swapAllDef).toBeDefined()
    expect(swapAllDef?.function.description).toContain('Sweep and swap all non-SOL SPL tokens')
    expect(swapAllDef?.function.parameters?.properties).toHaveProperty('skip_mints')
  })

  it('serializes heterogeneous write tools (swap_token vs deploy_position vs claim_fees)', async () => {
    let inFlightWrites = 0
    let maxInFlightWrites = 0
    let releaseFirstWrite!: () => void
    const firstWriteFinished = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve
    })

    vi.mocked(WalletAdapter.swapToken).mockImplementation(async () => {
      inFlightWrites++
      maxInFlightWrites = Math.max(maxInFlightWrites, inFlightWrites)
      if (inFlightWrites === 1) await firstWriteFinished
      inFlightWrites--
      return { success: true, tx: 'swap-tx' } as any
    })

    vi.mocked(MeteoraAdapter.claimFees).mockImplementation(async () => {
      inFlightWrites++
      maxInFlightWrites = Math.max(maxInFlightWrites, inFlightWrites)
      inFlightWrites--
      return { success: true, tx: 'claim-tx' } as any
    })

    const write1 = executeTool('swap_token', {
      input_mint: 'TOKEN_A',
      output_mint: 'SOL',
      amount: 10,
    })
    const write2 = executeTool('claim_fees', {
      position_address: 'pos-1',
    })

    await vi.waitFor(() => expect(WalletAdapter.swapToken).toHaveBeenCalledTimes(1))
    expect(maxInFlightWrites).toBe(1)

    releaseFirstWrite()
    await Promise.all([write1, write2])

    expect(WalletAdapter.swapToken).toHaveBeenCalledTimes(1)
    expect(MeteoraAdapter.claimFees).toHaveBeenCalledTimes(1)
    expect(maxInFlightWrites).toBe(1)
  })

  it('allows concurrent read-only tools without lock contention', async () => {
    let inFlightReads = 0
    let maxInFlightReads = 0
    let releaseReads!: () => void
    const readsHoldPromise = new Promise<void>((resolve) => {
      releaseReads = resolve
    })

    vi.mocked(WalletAdapter.getWalletBalances).mockImplementation(async () => {
      inFlightReads++
      maxInFlightReads = Math.max(maxInFlightReads, inFlightReads)
      await readsHoldPromise
      inFlightReads--
      return { sol: 5, tokens: [] } as any
    })

    const read1 = executeTool('get_wallet_balance', {})
    const read2 = executeTool('get_wallet_balance', {})
    const read3 = executeTool('get_wallet_balance', {})

    await vi.waitFor(() => expect(inFlightReads).toBe(3))
    expect(maxInFlightReads).toBe(3)
    expect(writeToolsMutex.isLocked()).toBe(false)

    releaseReads()
    await Promise.all([read1, read2, read3])
  })

  it('allows read tools to execute concurrently while a write tool holds the mutex (mixed contention)', async () => {
    let releaseWrite!: () => void
    const writeHoldPromise = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })

    vi.mocked(WalletAdapter.swapToken).mockImplementation(async () => {
      await writeHoldPromise
      return { success: true, tx: 'swap-tx' } as any
    })

    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValue({
      sol: 10,
      tokens: [],
    } as any)

    const pendingWrite = executeTool('swap_token', {
      input_mint: 'TOKEN_A',
      output_mint: 'SOL',
      amount: 50,
    })

    await vi.waitFor(() => expect(writeToolsMutex.isLocked()).toBe(true))

    // Read tool executes and finishes while the write tool is STILL in-flight
    const readResult = await executeTool('get_wallet_balance', {})
    expect(readResult).toBeDefined()
    expect(writeToolsMutex.isLocked()).toBe(true)

    releaseWrite()
    await pendingWrite
    expect(writeToolsMutex.isLocked()).toBe(false)
  })
})

describe('ToolExecutor - close_position auto-swap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('DRY_RUN', 'false')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('auto-swaps unpriced base token (usd: null) back to SOL upon close', async () => {
    const baseMint = 'BASE_TOKEN_1111111111111111111111111111111'
    vi.mocked(MeteoraAdapter.closePosition).mockResolvedValue({
      success: true,
      position: 'pos-123',
      base_mint: baseMint,
    } as any)

    const mockBalances = {
      sol_price: 150,
      tokens: [{ mint: baseMint, symbol: 'BASE', balance: 2500, usd: null }],
    }
    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValue(mockBalances as any)
    vi.mocked(WalletAdapter.swapToken).mockResolvedValue({
      success: true,
      tx: 'swap-tx-hash',
      amount_out: '0.15',
    } as any)

    const result = (await executeTool('close_position', { position_address: 'pos-123' })) as any

    expect(result.success).toBe(true)
    expect(result.auto_swapped).toBe(true)
    expect(result.sol_received).toBe('0.15')
    expect(WalletAdapter.swapToken).toHaveBeenCalledWith({
      input_mint: baseMint,
      output_mint: 'SOL',
      amount: 2500,
    })
  })

  it('auto-swaps unpriced base token (usd: undefined) back to SOL upon close', async () => {
    const baseMint = 'BASE_UNDEF_TOKEN_1111111111111111111111'
    vi.mocked(MeteoraAdapter.closePosition).mockResolvedValue({
      success: true,
      position: 'pos-456',
      base_mint: baseMint,
    } as any)

    const mockBalances = {
      sol_price: 150,
      tokens: [{ mint: baseMint, symbol: 'UNDEF', balance: 1000, usd: undefined }],
    }
    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValue(mockBalances as any)
    vi.mocked(WalletAdapter.swapToken).mockResolvedValue({
      success: true,
      tx: 'swap-tx-undef',
      amount_out: '0.09',
    } as any)

    const result = (await executeTool('close_position', { position_address: 'pos-456' })) as any

    expect(result.success).toBe(true)
    expect(result.auto_swapped).toBe(true)
    expect(result.sol_received).toBe('0.09')
    expect(WalletAdapter.swapToken).toHaveBeenCalledWith({
      input_mint: baseMint,
      output_mint: 'SOL',
      amount: 1000,
    })
  })

  it('does not auto-swap when base token is dust (usd: 0.049)', async () => {
    const baseMint = 'BASE_DUST_TOKEN_1111111111111111111111'
    vi.mocked(MeteoraAdapter.closePosition).mockResolvedValue({
      success: true,
      position: 'pos-789',
      base_mint: baseMint,
    } as any)

    const mockBalances = {
      sol_price: 150,
      tokens: [{ mint: baseMint, symbol: 'DUST', balance: 50, usd: 0.049 }],
    }
    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValue(mockBalances as any)

    const result = (await executeTool('close_position', { position_address: 'pos-789' })) as any

    expect(result.success).toBe(true)
    expect(result.auto_swapped).toBeUndefined()
    expect(WalletAdapter.swapToken).not.toHaveBeenCalled()
  })
})

describe('ToolExecutor - Portfolio & Position Disambiguation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getPortfolioSummary computes unified net worth combining spot balances and LP positions', async () => {
    const mockBalances = {
      wallet: 'TestWallet111111111111111111111111111111111',
      sol: 2.5,
      sol_price: 150,
      sol_usd: 375,
      usdc: 50,
      tokens: [
        { mint: 'USDC_MINT', symbol: 'USDC', balance: 50, usd: 50, program: 'spl-token' },
        { mint: 'TOKEN2022_MINT', symbol: 'OTC', balance: 1000, usd: 25, program: 'token-2022' },
      ],
      total_usd: 450, // 375 + 50 + 25
    }

    const mockPositions = {
      wallet: 'TestWallet111111111111111111111111111111111',
      total_positions: 1,
      positions: [
        {
          position: 'PosAddress111111111111111111111111111111111',
          pool: 'PoolAddress111111111111111111111111111111111',
          in_range: true,
          pnl_pct: 3.5,
          unclaimed_fees_usd: 12.5,
          total_value_usd: 200,
        },
      ],
    }

    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValue(mockBalances as any)
    vi.mocked(MeteoraAdapter.getMyPositions).mockResolvedValue(mockPositions as any)

    const summary = await getPortfolioSummary()

    expect(summary.wallet).toBe('TestWallet111111111111111111111111111111111')
    expect(summary.sol).toBe(2.5)
    expect(summary.sol_usd).toBe(375)
    expect(summary.spot_tokens_usd).toBe(75) // 50 + 25
    expect(summary.spot_tokens).toHaveLength(2)
    expect(summary.lp_positions_count).toBe(1)
    expect(summary.lp_positions_usd).toBe(200)
    expect(summary.lp_unclaimed_fees_usd).toBe(12.5)
    // total net worth = 450 (spot) + 200 (LP capital) + 12.5 (fees) = 662.5
    expect(summary.total_net_worth_usd).toBe(662.5)
  })

  it('executes get_meteora_positions via executeTool and delegates to getMyPositions', async () => {
    vi.mocked(MeteoraAdapter.getMyPositions).mockResolvedValue({
      total_positions: 0,
      positions: [],
    } as any)

    const result = await executeTool('get_meteora_positions', {})

    expect(MeteoraAdapter.getMyPositions).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ total_positions: 0, positions: [] })
  })

  it('executes get_portfolio_summary via executeTool', async () => {
    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValue({
      wallet: 'W1',
      sol: 1,
      sol_price: 100,
      sol_usd: 100,
      usdc: 0,
      tokens: [],
      total_usd: 100,
    } as any)
    vi.mocked(MeteoraAdapter.getMyPositions).mockResolvedValue({
      total_positions: 0,
      positions: [],
    } as any)

    const result = (await executeTool('get_portfolio_summary', {})) as any

    expect(result.total_net_worth_usd).toBe(100)
    expect(result.lp_positions_count).toBe(0)
    expect(result.sol).toBe(1)
  })
})

describe('ToolExecutor - Unsold Token Lifecycle & Sweeper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('falls back to swapDirectDlmm when Jupiter aggregator fails and poolAddress is provided', async () => {
    const baseMint = 'DLMM_FALLBACK_MINT_111111111111111111111'
    const poolAddress = 'DLMM_POOL_111111111111111111111111111111111'

    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValue({
      sol_price: 150,
      tokens: [{ mint: baseMint, symbol: 'FALLBACK', balance: 500, usd: 2.5 }],
    } as any)

    // Jupiter fails with no route
    vi.mocked(WalletAdapter.swapToken).mockResolvedValue({
      success: false,
      error: 'Jupiter 400: No route found',
    } as any)

    // Direct DLMM pool swap succeeds
    vi.mocked(MeteoraAdapter.swapDirectDlmm).mockResolvedValue({
      success: true,
      tx: 'direct-dlmm-tx-hash',
      amount_out: 0.016,
    })

    const res = await swapBaseToSolWithRetry(baseMint, 'test dlmm fallback', 0.05, poolAddress)

    expect(res.swapped).toBe(true)
    expect(res.result).toMatchObject({ success: true, tx: 'direct-dlmm-tx-hash' })
    expect(WalletAdapter.swapToken).toHaveBeenCalledTimes(1)
    expect(MeteoraAdapter.swapDirectDlmm).toHaveBeenCalledWith({
      pool_address: poolAddress,
      input_mint: baseMint,
      amount: 500,
    })
  })

  it('enqueues into persistent liquidation queue and triggers notifyLiquidationAlert for high-value tokens', async () => {
    const baseMint = 'HIGH_VAL_FAIL_MINT_111111111111111111111'
    const TelegramAdapter = await import('./notifications/TelegramAdapter.js')

    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValue({
      sol_price: 150,
      tokens: [{ mint: baseMint, symbol: 'HIGHVAL', balance: 1000, usd: 5.0 }],
    } as any)

    vi.mocked(WalletAdapter.swapToken).mockResolvedValue({
      success: false,
      error: 'HTTP 400 Bad Request',
    } as any)

    const res = await swapBaseToSolWithRetry(baseMint, 'test high value alert', 0.05)

    expect(res.swapped).toBe(false)
    const { getPendingLiquidation } = await import('../domain/liquidation-queue.js')
    const queued = getPendingLiquidation(baseMint)
    expect(queued).not.toBeNull()
    expect(queued?.symbol).toBe('HIGHVAL')
    expect(queued?.usd).toBe(5.0)

    expect(TelegramAdapter.notifyLiquidationAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'HIGHVAL',
        mint: baseMint,
        usd: 5.0,
      }),
    )
  })

  it('sweep_unsold_tokens tool skips micro-dust (< $0.02) and executes swaps on actionable balances', async () => {
    const dustMint = 'DUST_TOKEN_MINT_11111111111111111111111111'
    const actionMint = 'ACTION_TOKEN_MINT_111111111111111111111111'

    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValue({
      sol_price: 150,
      tokens: [
        { mint: dustMint, symbol: 'DUST', balance: 10, usd: 0.005 },
        { mint: actionMint, symbol: 'ACTION', balance: 200, usd: 1.5 },
      ],
    } as any)

    vi.mocked(WalletAdapter.swapToken).mockResolvedValue({
      success: true,
      tx: 'action-swap-tx',
      amount_out: '0.01',
    } as any)

    const result = (await executeTool('sweep_unsold_tokens', {})) as any

    expect(result.successful).toBe(1)
    expect(result.skipped).toBeGreaterThanOrEqual(1)
    expect(WalletAdapter.swapToken).toHaveBeenCalledWith(
      expect.objectContaining({
        input_mint: actionMint,
      }),
    )
    expect(WalletAdapter.swapToken).not.toHaveBeenCalledWith(
      expect.objectContaining({
        input_mint: dustMint,
      }),
    )
  })

  it('get_pending_liquidations tool inspects queue via executeTool', async () => {
    const res = (await executeTool('get_pending_liquidations', {})) as any
    expect(res).toHaveProperty('liquidations')
    expect(Array.isArray(res.liquidations)).toBe(true)
  })
})

describe('ToolExecutor tool registry', () => {
  it('registers a handler for every LLM-facing tool definition', () => {
    expect(
      toolRegistry
        .getDefinitions()
        .map((d) => d.function.name)
        .sort(),
    ).toEqual(tools.map((t) => t.function.name).sort())
    for (const t of tools) {
      expect(typeof toolRegistry.getHandler(t.function.name)).toBe('function')
    }
  })

  it('derives the permission sets and keeps close_all_positions internal-only', () => {
    expect([...toolRegistry.writeTools].sort()).toEqual([...WRITE_TOOLS].sort())
    expect(toolRegistry.isProtected('self_update')).toBe(true)
    expect(toolRegistry.isWrite('self_update')).toBe(false)
    expect(toolRegistry.internalNames()).toContain('close_all_positions')
    expect(toolRegistry.exposedNames()).not.toContain('close_all_positions')
  })
})
