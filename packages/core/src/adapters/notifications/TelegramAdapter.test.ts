import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../../config/Config.js'
import { log } from '../../shared/logger.js'
import * as NotificationSink from './NotificationSink.js'
import {
  createLiveMessage,
  editMessage,
  isEnabled,
  isTelegramConfigured,
  notifySwap,
  notifySwapError,
  notifyTransactionError,
  sendMessage,
  setChatId,
  summarizeToolResult,
} from './TelegramAdapter.js'

vi.mock('./NotificationSink.js', () => ({
  notify: vi.fn(),
}))

vi.mock('../../shared/logger.js', () => ({
  log: vi.fn(),
}))

describe('TelegramAdapter notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setChatId(null)
    delete process.env.TELEGRAM_BOT_TOKEN
    delete process.env.TELEGRAM_CHAT_ID
    delete process.env.TELEGRAM_ALLOWED_USER_IDS
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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

  it('resolves Telegram credentials from config when config.connection has resolved values', async () => {
    const origChatId = config.connection?.telegramChatId
    const origToken = config.connection?.telegramBotToken
    if (config.connection) {
      config.connection.telegramChatId = '987654'
      config.connection.telegramBotToken = 'env_bot_token_123'
    }

    try {
      expect(isEnabled()).toBe(true)
      expect(isTelegramConfigured()).toBe(true)

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 111 } }),
      } as any)

      const res = await sendMessage('Test config values')
      expect(res).toBeDefined()
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.telegram.org/botenv_bot_token_123/sendMessage',
        expect.objectContaining({
          body: JSON.stringify({ chat_id: '987654', text: 'Test config values' }),
        }),
      )
    } finally {
      if (config.connection) {
        config.connection.telegramChatId = origChatId
        config.connection.telegramBotToken = origToken
      }
    }
  })

  it('silently ignores 400 "message is not modified" errors without logging telegram_error', async () => {
    config.connection.telegramBotToken = 'test_token'
    config.connection.telegramChatId = '123456'

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      text: async () =>
        'Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message',
    } as any)

    const res = await editMessage('Duplicate content', 555)
    expect(res).toBeNull()
    expect(log).not.toHaveBeenCalledWith('telegram_error', expect.any(String))
  })

  it('logs telegram_error for other 400 errors (e.g. chat not found)', async () => {
    config.connection.telegramBotToken = 'test_token'
    config.connection.telegramChatId = '123456'

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Bad Request: chat not found',
    } as any)

    const res = await editMessage('Content', 555)
    expect(res).toBeNull()
    expect(log).toHaveBeenCalledWith('telegram_error', expect.stringContaining('400: Bad Request: chat not found'))
  })

  it('createLiveMessage debounces rapid toolStart/toolFinish events and skips identical text', async () => {
    config.connection.telegramBotToken = 'test_token'
    config.connection.telegramChatId = '123456'

    const editPayloads: string[] = []
    let sendCalls = 0

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
      const urlStr = String(url)
      if (urlStr.includes('sendMessage')) {
        sendCalls++
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, result: { message_id: 999 } }),
        } as any
      }
      if (urlStr.includes('editMessageText')) {
        const body = JSON.parse(init.body)
        editPayloads.push(body.text)
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, result: { message_id: 999 } }),
        } as any
      }
      return { ok: true, json: async () => ({ ok: true }) } as any
    })

    const live = await createLiveMessage('Live Title', 'Intro')
    expect(live).not.toBeNull()
    expect(sendCalls).toBe(1)

    if (live) {
      // Dispatch multiple rapid updates synchronously
      await live.toolStart('get_wallet_balance')
      await live.toolFinish('get_wallet_balance', { sol: 5 }, true)
      await live.toolStart('swap_token')
      await live.toolFinish('swap_token', { tx: 'tx_abc' }, true)

      // Immediately after rapid events (before 800ms timer), no edits sent yet
      expect(editPayloads.length).toBe(0)

      // Wait for debounce timer (800ms) to flush
      await new Promise((resolve) => setTimeout(resolve, 950))

      // Exactly 1 batched edit was sent for the rapid burst
      expect(editPayloads.length).toBe(1)
      expect(editPayloads[0]).toContain('get wallet balance')
      expect(editPayloads[0]).toContain('swap token')

      // Finalize flushes final text
      await live.finalize('Completed.')
      expect(editPayloads.length).toBe(2)
      expect(editPayloads[1]).toContain('Completed.')
    }
  })
})
