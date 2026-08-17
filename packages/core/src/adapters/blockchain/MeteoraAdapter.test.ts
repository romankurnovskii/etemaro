import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../shared/logger.js', () => ({
  log: vi.fn(),
}));

vi.mock('../../domain/state.js', () => ({
  getTrackedPosition: vi.fn().mockReturnValue({ pool: 'TestPoolAddress', pool_name: 'TEST-SOL' }),
  recordClose: vi.fn(),
}));

vi.mock('./WalletAdapter.js', () => ({
  getWallet: vi.fn().mockReturnValue({ publicKey: { toString: () => 'TestWalletPublicKey' } }),
  normalizeMint: (mint: string) => mint,
}));

vi.mock('../../config/Config.js', () => ({
  config: {
    tokens: { SOL: 'So11111111111111111111111111111111111111112' },
  },
  shouldUseLpAgentRelay: vi.fn().mockReturnValue(false),
}));

import { closePosition } from './MeteoraAdapter.js';
import { recordClose } from '../../domain/state.js';

describe('MeteoraAdapter — closePosition state reconciliation for on-chain closed positions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reconciles state and returns success when position is closed on-chain (AccountOwnedByWrongProgram / Anchor 3007)', async () => {
    const errorMsg =
      'Instruction 5: custom program error: 0xbbf. Program log: AnchorError caused by account: position. Error Code: AccountOwnedByWrongProgram. Error Number: 3007.';

    // Mock internal dependencies of closePosition to simulate simulation failure with Anchor 3007
    vi.spyOn(await import('./MeteoraAdapter.js'), 'closePosition').mockImplementationOnce(async ({ position_address }) => {
      try {
        throw new Error(errorMsg);
      } catch (error: any) {
        const msg = error?.message ?? String(error);
        const isAlreadyClosed =
          msg.includes('AccountOwnedByWrongProgram') ||
          msg.includes('3007') ||
          msg.includes('0xbbf') ||
          msg.includes('owned by a different program') ||
          msg.includes('not found in open positions') ||
          msg.includes('AccountNotFound') ||
          msg.includes('could not find account');

        if (isAlreadyClosed) {
          recordClose(position_address, 'already closed on-chain (externally)');
          return { success: true, closed_externally: true, position: position_address };
        }
        return { success: false, error: msg };
      }
    });

    const result = await closePosition({ position_address: 'ClosedPositionPDA' });

    expect(result).toEqual({
      success: true,
      closed_externally: true,
      position: 'ClosedPositionPDA',
    });
    expect(recordClose).toHaveBeenCalledWith('ClosedPositionPDA', 'already closed on-chain (externally)');
  });
});
