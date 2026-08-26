import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notifySwap, notifySwapError } from './TelegramAdapter.js';
import * as NotificationSink from './NotificationSink.js';

vi.mock('./NotificationSink.js', () => ({
  notify: vi.fn(),
}));

vi.mock('../../shared/logger.js', () => ({
  log: vi.fn(),
}));

describe('TelegramAdapter notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('notifySwap formats message with USD amount when provided', async () => {
    await notifySwap({
      inputSymbol: 'Council',
      outputSymbol: 'SOL',
      amountIn: '1250',
      amountOut: '0.0240 SOL',
      tx: '5K8x7q1234567890abcdef',
      amountUsd: 4.52,
    });

    expect(NotificationSink.notify).toHaveBeenCalledWith(
      'swap',
      '🔄',
      'Swapped Council → SOL',
      'In: 1250 (~$4.52) | Out: 0.0240 SOL\nTx: 5K8x7q1234567890...',
    );
  });

  it('notifySwap formats message without USD amount when not provided', async () => {
    await notifySwap({
      inputSymbol: 'Council',
      outputSymbol: 'SOL',
      amountIn: '1250',
      amountOut: '0.0240 SOL',
      tx: '5K8x7q1234567890abcdef',
    });

    expect(NotificationSink.notify).toHaveBeenCalledWith(
      'swap',
      '🔄',
      'Swapped Council → SOL',
      'In: 1250 | Out: 0.0240 SOL\nTx: 5K8x7q1234567890...',
    );
  });

  it('notifySwapError formats failure alert', async () => {
    await notifySwapError({
      inputSymbol: 'Council',
      outputSymbol: 'SOL',
      reason: 'Slippage exceeded',
    });

    expect(NotificationSink.notify).toHaveBeenCalledWith('swap_error', '⚠️', 'Auto-swap failed: Council → SOL', 'Reason: Slippage exceeded');
  });
});
