import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeTool, swapAllTokensToSol } from './ToolExecutor.js';
import * as WalletAdapter from './blockchain/WalletAdapter.js';
import * as MeteoraAdapter from './blockchain/MeteoraAdapter.js';

// Mock the WalletAdapter functions
vi.mock('./blockchain/WalletAdapter.js', () => ({
  getWalletBalances: vi.fn(),
  swapToken: vi.fn(),
}));

vi.mock('./blockchain/MeteoraAdapter.js', () => ({
  getActiveBin: vi.fn(),
  deployPosition: vi.fn(),
  getMyPositions: vi.fn(),
  getWalletPositions: vi.fn(),
  getPositionPnl: vi.fn(),
  claimFees: vi.fn(),
  closePosition: vi.fn(),
  searchPools: vi.fn(),
}));

vi.mock('./blockchain/ScreeningAdapter.js', () => ({
  discoverPools: vi.fn(),
  getPoolDetail: vi.fn(),
  getTopCandidates: vi.fn(),
}));

// Mock logger to avoid noisy output during tests
vi.mock('../shared/logger.js', () => ({
  log: vi.fn(),
  logAction: vi.fn(),
  logStructured: vi.fn(),
}));

describe('ToolExecutor - swapAllTokensToSol', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should swap all non-SOL, non-USDC tokens with value >= $0.10', async () => {
    // Arrange
    const mockBalances = {
      tokens: [
        { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', balance: 10, usd: 1500 },
        { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', balance: 100, usd: 100 },
        { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', balance: 1000000, usd: 25.5 },
        { mint: 'DUST1111111111111111111111111111111111111111', symbol: 'DUST', balance: 100, usd: 0.01 },
      ],
    };

    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValue(mockBalances as any);
    vi.mocked(WalletAdapter.swapToken).mockResolvedValue({ success: true, tx: 'test-tx' } as any);

    // Act
    const result = await swapAllTokensToSol(['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v']);

    // Assert
    expect(result.total).toBe(4); // All tokens considered
    expect(result.skipped).toBe(3); // SOL, USDC, DUST
    expect(result.successful).toBe(1);
    expect(result.failed).toBe(0);

    // Check that swapToken was called correctly for BONK
    expect(WalletAdapter.swapToken).toHaveBeenCalledTimes(1);
    expect(WalletAdapter.swapToken).toHaveBeenCalledWith({
      input_mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
      output_mint: 'SOL',
      amount: 1000000,
    });
  });

  it('should accept object input { skipMints: [] } without throwing error', async () => {
    const mockBalances = { tokens: [] };
    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValue(mockBalances as any);

    const result = await swapAllTokensToSol({ skipMints: [] } as any);
    expect(result.total).toBe(0);
  });
});

describe('ToolExecutor - deploy_position serialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('DRY_RUN', 'false');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ address: 'pool-one', tvl: 100_000, fee_active_tvl_ratio: { '5m': 1 }, volatility: 1, dlmm_params: { bin_step: 100 } }],
        }),
      }),
    );
    vi.mocked(MeteoraAdapter.getMyPositions).mockResolvedValue({ positions: [], total_positions: 0 } as any);
    vi.mocked(WalletAdapter.getWalletBalances).mockResolvedValue({ sol: 10, tokens: [] } as any);
  });

  it('does not run a second balance check until the first deploy has completed', async () => {
    let releaseFirstDeploy!: () => void;
    const firstDeployFinished = new Promise<void>((resolve) => {
      releaseFirstDeploy = resolve;
    });
    let inFlightDeploys = 0;
    let maxInFlightDeploys = 0;
    vi.mocked(MeteoraAdapter.deployPosition).mockImplementation(async () => {
      inFlightDeploys++;
      maxInFlightDeploys = Math.max(maxInFlightDeploys, inFlightDeploys);
      if (inFlightDeploys === 1) await firstDeployFinished;
      inFlightDeploys--;
      return { success: true, position: `position-${Date.now()}` } as any;
    });

    const args = {
      pool_address: 'pool-one',
      amount_y: 0.5,
      bins_below: 35,
      bins_above: 0,
    };
    const first = executeTool('deploy_position', { ...args });
    await vi.waitFor(() => expect(MeteoraAdapter.deployPosition).toHaveBeenCalledTimes(1));
    const second = executeTool('deploy_position', { ...args, pool_address: 'pool-two' });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(MeteoraAdapter.getMyPositions).toHaveBeenCalledTimes(1);
    expect(MeteoraAdapter.deployPosition).toHaveBeenCalledTimes(1);
    expect(maxInFlightDeploys).toBe(1);

    releaseFirstDeploy();
    await Promise.all([first, second]);
    expect(MeteoraAdapter.getMyPositions).toHaveBeenCalledTimes(2);
    expect(MeteoraAdapter.deployPosition).toHaveBeenCalledTimes(2);
    expect(maxInFlightDeploys).toBe(1);
  });
});
