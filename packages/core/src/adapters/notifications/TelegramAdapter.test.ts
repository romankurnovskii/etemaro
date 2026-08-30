import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  notifySwap,
  notifySwapError,
  notifyRpcError,
  notifyTransactionError,
  resetRpcErrorThrottle,
  summarizeToolResult,
} from './TelegramAdapter.js';
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

  it('summarizeToolResult reports scanned vs shortlisted for get_top_candidates', () => {
    expect(
      summarizeToolResult('get_top_candidates', {
        candidates: [{ name: 'STACY-SOL' }],
        total_screened: 6,
        filtered_examples: [{ name: 'fone-SOL' }, { name: 'TOAD-SOL' }],
      }),
    ).toBe('6 scanned / 1 shortlisted');
  });

  it('summarizeToolResult does not say 0 candidates when pools were scanned but none shortlisted', () => {
    expect(
      summarizeToolResult('get_top_candidates', {
        candidates: [],
        total_screened: 0,
        filtered_examples: [{ name: 'fone-SOL' }, { name: 'TOAD-SOL' }, { name: 'GTA6-SOL' }, { name: 'Morty-SOL' }, { name: 'GHOST-SOL' }],
      }),
    ).toBe('5 scanned / 0 shortlisted');
  });

  it('summarizeToolResult reserves 0 candidates for a truly empty fetch', () => {
    expect(summarizeToolResult('get_top_candidates', { candidates: [] })).toBe('0 candidates');
  });

  it('notifySwapError formats failure alert', async () => {
    await notifySwapError({
      inputSymbol: 'Council',
      outputSymbol: 'SOL',
      reason: 'Slippage exceeded',
    });

    expect(NotificationSink.notify).toHaveBeenCalledWith('swap_error', '⚠️', 'Auto-swap failed: Council → SOL', 'Reason: Slippage exceeded');
  });

  it('notifyRpcError formats alert and throttles repeated alerts within 5 minutes', async () => {
    resetRpcErrorThrottle();

    await notifyRpcError({
      operation: 'Management Cycle',
      error: 'Solana RPC rate limited (429)',
      endpoint: 'https://api.mainnet-beta.solana.com',
    });

    expect(NotificationSink.notify).toHaveBeenCalledTimes(1);
    expect(NotificationSink.notify).toHaveBeenCalledWith(
      'rpc_error',
      '⚠️',
      'RPC/Network Error: Management Cycle',
      expect.stringContaining('Solana RPC rate limited (429)'),
    );

    // Call again immediately for same operation -> should be throttled (no second notify call)
    await notifyRpcError({
      operation: 'Management Cycle',
      error: 'Solana RPC rate limited (429)',
    });
    expect(NotificationSink.notify).toHaveBeenCalledTimes(1);

    // Call for different operation -> should alert
    await notifyRpcError({
      operation: 'Screening Cycle',
      error: 'Timeout fetching candidates',
    });
    expect(NotificationSink.notify).toHaveBeenCalledTimes(2);
  });

  it('notifyTransactionError formats failure alert for failed transaction execution', async () => {
    await notifyTransactionError({
      type: 'deploy',
      pair: 'SOL/USDC',
      reason: 'Transaction simulation failed: Custom program error 0x1',
    });

    expect(NotificationSink.notify).toHaveBeenCalledWith(
      'tx_error',
      '❌',
      'Transaction Failed: DEPLOY | SOL/USDC',
      expect.stringContaining('Custom program error 0x1'),
    );
  });
});
