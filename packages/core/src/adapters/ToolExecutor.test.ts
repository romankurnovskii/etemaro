import { describe, it, expect, vi, beforeEach } from 'vitest';
import { swapAllTokensToSol } from './ToolExecutor.js';
import * as WalletAdapter from './blockchain/WalletAdapter.js';

// Mock the WalletAdapter functions
vi.mock('./blockchain/WalletAdapter.js', () => ({
  getWalletBalances: vi.fn(),
  swapToken: vi.fn(),
}));

// Mock logger to avoid noisy output during tests
vi.mock('../shared/logger.js', () => ({
  log: vi.fn(),
  logAction: vi.fn(),
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
        { mint: 'DUST1111111111111111111111111111111111111111', symbol: 'DUST', balance: 100, usd: 0.05 },
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
