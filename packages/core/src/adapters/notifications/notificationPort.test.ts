import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./TelegramAdapter.js', () => ({
  notifyDeploy: vi.fn().mockResolvedValue(undefined),
  notifyClose: vi.fn().mockResolvedValue(undefined),
  notifySwap: vi.fn().mockResolvedValue(undefined),
  notifySwapError: vi.fn().mockResolvedValue(undefined),
  notifyLiquidationAlert: vi.fn().mockResolvedValue(undefined),
  notifyTransactionError: vi.fn().mockResolvedValue(undefined),
}))

import type { NotificationPort } from '../../ports/notifications.js'
import { getNotificationPort, resetNotificationPort, setNotificationPort } from './notificationPort.js'
import * as TelegramAdapter from './TelegramAdapter.js'

function fakePort(): NotificationPort {
  return {
    notifyDeploy: vi.fn().mockResolvedValue(undefined),
    notifyClose: vi.fn().mockResolvedValue(undefined),
    notifySwap: vi.fn().mockResolvedValue(undefined),
    notifySwapError: vi.fn().mockResolvedValue(undefined),
    notifyLiquidationAlert: vi.fn().mockResolvedValue(undefined),
    notifyTransactionError: vi.fn().mockResolvedValue(undefined),
  }
}

describe('notification port binding', () => {
  beforeEach(() => {
    resetNotificationPort()
    vi.clearAllMocks()
  })

  it('defaults to delegating to TelegramAdapter', async () => {
    await getNotificationPort().notifySwap({
      inputSymbol: 'A',
      outputSymbol: 'B',
      amountIn: '1',
      amountOut: '2',
      tx: 'tx',
    })
    expect(TelegramAdapter.notifySwap).toHaveBeenCalledTimes(1)
  })

  it('allows replacing the active port', async () => {
    const fake = fakePort()
    setNotificationPort(fake)
    await getNotificationPort().notifyClose({ pair: 'A', pnlUsd: 1, pnlPct: 1 })
    expect(fake.notifyClose).toHaveBeenCalledTimes(1)
    expect(TelegramAdapter.notifyClose).not.toHaveBeenCalled()
  })
})
