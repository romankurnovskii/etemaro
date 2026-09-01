import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../config/Config.js'
import * as MeteoraAdapter from './blockchain/MeteoraAdapter.js'
import * as WalletAdapter from './blockchain/WalletAdapter.js'
import { executeTool, swapAllTokensToSol, swapBaseToSolWithRetry } from './ToolExecutor.js'

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
