import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as NotificationSink from './NotificationSink.js'
import { notifySwap, notifySwapError, notifyTransactionError, summarizeToolResult } from './TelegramAdapter.js'

vi.mock('./NotificationSink.js', () => ({
  notify: vi.fn(),
}))

vi.mock('../../shared/logger.js', () => ({
  log: vi.fn(),
}))

describe('TelegramAdapter notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('notifySwap formats message with USD amount when provided', async () => {
    await notifySwap({
      inputSymbol: 'Council',
      outputSymbol: 'SOL',
      amountIn: '1250',
      amountOut: '0.0240 SOL',
      tx: '5K8x7q1234567890abcdef',
      amountUsd: 4.52,
    })

    expect(NotificationSink.notify).toHaveBeenCalledWith(
      'swap',
      '🔄',
      'Swapped Council → SOL',
      'In: 1250 (~$4.52) | Out: 0.0240 SOL\nTx: 5K8x7q1234567890...',
    )
  })

  it('notifySwap formats message without USD amount when not provided', async () => {
    await notifySwap({
      inputSymbol: 'Council',
      outputSymbol: 'SOL',
      amountIn: '1250',
      amountOut: '0.0240 SOL',
      tx: '5K8x7q1234567890abcdef',
    })

    expect(NotificationSink.notify).toHaveBeenCalledWith(
      'swap',
      '🔄',
      'Swapped Council → SOL',
      'In: 1250 | Out: 0.0240 SOL\nTx: 5K8x7q1234567890...',
    )
  })

  it('summarizeToolResult reports scanned vs shortlisted for get_top_candidates', () => {
    expect(
      summarizeToolResult('get_top_candidates', {
        candidates: [{ name: 'STACY-SOL' }],
        total_screened: 6,
        filtered_examples: [{ name: 'fone-SOL' }, { name: 'TOAD-SOL' }],
      }),
    ).toBe('6 scanned / 1 shortlisted')
  })

  it('summarizeToolResult does not say 0 candidates when pools were scanned but none shortlisted', () => {
    expect(
      summarizeToolResult('get_top_candidates', {
        candidates: [],
        total_screened: 0,
        filtered_examples: [
          { name: 'fone-SOL' },
          { name: 'TOAD-SOL' },
          { name: 'GTA6-SOL' },
          { name: 'Morty-SOL' },
          { name: 'GHOST-SOL' },
        ],
      }),
    ).toBe('5 scanned / 0 shortlisted')
  })

  it('summarizeToolResult reserves 0 candidates for a truly empty fetch', () => {
    expect(summarizeToolResult('get_top_candidates', { candidates: [] })).toBe('0 candidates')
  })

  it('notifySwapError formats failure alert', async () => {
    await notifySwapError({
      inputSymbol: 'Council',
      outputSymbol: 'SOL',
      reason: 'Slippage exceeded',
    })

    expect(NotificationSink.notify).toHaveBeenCalledWith(
      'swap_error',
      '⚠️',
      'Auto-swap failed: Council → SOL',
      'Reason: Slippage exceeded',
    )
  })

  it('notifyTransactionError formats failure alert for failed transaction execution', async () => {
    await notifyTransactionError({
      type: 'deploy',
      pair: 'SOL/USDC',
      reason: 'Transaction simulation failed: Custom program error 0x1',
    })

    expect(NotificationSink.notify).toHaveBeenCalledWith(
      'tx_error',
      '❌',
      'Transaction Failed: DEPLOY | SOL/USDC',
      expect.stringContaining('Custom program error 0x1'),
    )
  })

  it('summarizeToolResult formats swap_token and swap_all_tokens_to_sol', () => {
    expect(
      summarizeToolResult('swap_token', {
        tx: '5K8x7q1234567890abcdef',
        amount_in: 10,
        amount_out: 0.1,
      }),
    ).toBe('tx 5K8x7q12...')

    expect(
      summarizeToolResult('swap_all_tokens_to_sol', {
        swapped: 3,
        total: 3,
        failed: 0,
      }),
    ).toBe('swapped 3/3')
  })
})
