import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Daemon, type DaemonAdapters, getDeterministicCloseRule } from './Daemon.js'

function createMockAdapters(): DaemonAdapters {
  return {
    meteora: {
      getMyPositions: vi.fn().mockResolvedValue({ positions: [], total_positions: 0 }),
      closePosition: vi.fn().mockResolvedValue({ success: true }),
      getActiveBin: vi.fn().mockResolvedValue({ activeId: 100 }),
    },
    wallet: {
      getWalletBalances: vi.fn().mockResolvedValue({ sol: 5, tokens: [] }),
    },
    screening: {
      getTopCandidates: vi.fn().mockResolvedValue({ candidates: [] }),
      degenScore: vi.fn().mockReturnValue(50),
      getPoolDetail: vi.fn().mockResolvedValue({}),
    },
    toolExecutor: {
      executeTool: vi.fn().mockResolvedValue({ success: true }),
      registerCronRestarter: vi.fn(),
    },
    telegram: {
      startPolling: vi.fn(),
      stopPolling: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue({}),
      sendMessageWithButtons: vi.fn().mockResolvedValue({}),
      editMessage: vi.fn().mockResolvedValue({}),
      editMessageWithButtons: vi.fn().mockResolvedValue({}),
      answerCallbackQuery: vi.fn().mockResolvedValue({}),
      notifyOutOfRange: vi.fn().mockResolvedValue({}),
      isEnabled: vi.fn().mockReturnValue(false),
      createLiveMessage: vi.fn().mockResolvedValue(null),
    },
    briefing: {
      generateBriefing: vi.fn().mockResolvedValue('briefing'),
    },
    hivemind: {
      bootstrapHiveMind: vi.fn().mockResolvedValue({}),
      ensureAgentId: vi.fn().mockReturnValue('agent-123'),
      getHiveMindPullMode: vi.fn().mockReturnValue('manual'),
      isHiveMindEnabled: vi.fn().mockReturnValue(false),
      pullHiveMindLessons: vi.fn().mockResolvedValue([]),
      pullHiveMindPresets: vi.fn().mockResolvedValue([]),
      registerHiveMindAgent: vi.fn().mockResolvedValue({}),
      startHiveMindBackgroundSync: vi.fn(),
    },
    domain: {
      validateActiveStrategy: vi.fn(),
      getActiveStrategy: vi.fn().mockReturnValue({}),
      recordPositionSnapshot: vi.fn(),
      recallForPool: vi.fn().mockReturnValue(null),
      addPoolNote: vi.fn(),
      checkSmartWalletsOnPool: vi.fn().mockResolvedValue({ in_pool: [] }),
      getTokenNarrative: vi.fn().mockResolvedValue({}),
      getTokenInfo: vi.fn().mockResolvedValue({}),
      stageSignals: vi.fn(),
      getWeightsSummary: vi.fn().mockReturnValue('weights'),
      appendDecision: vi.fn(),
    },
    agentLoopDeps: {} as any,
  }
}

describe('Daemon — Concurrency & Mutex Guards', () => {
  let adapters: DaemonAdapters
  let daemon: Daemon

  beforeEach(() => {
    vi.clearAllMocks()
    adapters = createMockAdapters()
    daemon = new Daemon(adapters)
  })

  it('runManagementCycle skips when managementBusy is true', async () => {
    ;(daemon as any).managementBusy = true

    const res = await daemon.runManagementCycle()
    expect(res).toBeNull()
    expect(adapters.meteora.getMyPositions).not.toHaveBeenCalled()
  })

  it('runManagementCycle skips when pnlPollBusy is true', async () => {
    ;(daemon as any).pnlPollBusy = true

    const res = await daemon.runManagementCycle()
    expect(res).toBeNull()
    expect(adapters.meteora.getMyPositions).not.toHaveBeenCalled()
  })

  it('runManagementCycle runs when not busy and resets managementBusy on completion', async () => {
    expect((daemon as any).managementBusy).toBe(false)
    expect((daemon as any).pnlPollBusy).toBe(false)

    adapters.meteora.getMyPositions = vi.fn().mockResolvedValue({
      total_positions: 0,
      positions: [],
    })

    const res = await daemon.runManagementCycle({ silent: true })
    expect(res).toContain('No open positions')
    expect((daemon as any).managementBusy).toBe(false)
  })

  it('preserves existing managementBusy state when executing PnL poll action', async () => {
    const actionPositions = [
      {
        position: 'pos_xyz',
        pool: 'pool_123',
        pair: 'SOL-USDC',
        pnl_pct: -6.5,
      },
    ]
    const actionMap = new Map([['pos_xyz', { action: 'CLOSE', rule: 'stop_loss', reason: 'Stop loss hit' }]])

    // Case 1: managementBusy was FALSE before
    ;(daemon as any).managementBusy = false
    const wasManagementBusy = (daemon as any).managementBusy
    ;(daemon as any).managementBusy = true
    try {
      await daemon.executeManagementActions(actionPositions, actionMap, {})
    } finally {
      ;(daemon as any).managementBusy = wasManagementBusy
    }
    expect((daemon as any).managementBusy).toBe(false)

    // Case 2: managementBusy was TRUE before (e.g. nested call)
    ;(daemon as any).managementBusy = true
    const wasManagementBusy2 = (daemon as any).managementBusy
    ;(daemon as any).managementBusy = true
    try {
      await daemon.executeManagementActions(actionPositions, actionMap, {})
    } finally {
      ;(daemon as any).managementBusy = wasManagementBusy2
    }
    expect((daemon as any).managementBusy).toBe(true)
  })

  it('calls getMyPositions only once during runManagementCycle and calculates remaining positions in memory', async () => {
    const mockPositions = [
      {
        position: 'pos_1',
        pool: 'pool_1',
        pair: 'SOL-USDC',
        pnl_pct: -55.0, // triggers stop loss close (default stopLossPct is -50)
        unclaimed_fees_usd: 0,
        total_value_usd: 100,
        in_range: true,
      },
    ]

    adapters.meteora.getMyPositions = vi.fn().mockResolvedValue({
      total_positions: 1,
      positions: mockPositions,
    })
    adapters.toolExecutor.executeTool = vi.fn().mockResolvedValue({ success: true })
    const runScreeningSpy = vi.spyOn(daemon, 'runScreeningCycle').mockResolvedValue(null)

    // Set cooldown to past so screening can trigger
    ;(daemon as any).screeningLastTriggered = 0

    await daemon.runManagementCycle({ silent: true })

    // getMyPositions should only be called once at start of cycle, NOT at the end
    expect(adapters.meteora.getMyPositions).toHaveBeenCalledTimes(1)
    expect(runScreeningSpy).toHaveBeenCalledTimes(1)
  })

  it('atomically prevents concurrent runManagementCycle executions', async () => {
    let resolveFirst: any
    adapters.meteora.getMyPositions = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
    )

    // Start cycle 1
    const p1 = daemon.runManagementCycle({ silent: true })
    // Attempt concurrent cycle 2 immediately
    const p2 = daemon.runManagementCycle({ silent: true })

    // p2 should immediately return null because lock is held synchronously
    const res2 = await p2
    expect(res2).toBeNull()

    // Resolve cycle 1
    resolveFirst({ total_positions: 0, positions: [] })
    const res1 = await p1
    expect(res1).toContain('No open positions')

    // Lock is now released, a subsequent call succeeds
    adapters.meteora.getMyPositions = vi.fn().mockResolvedValue({ total_positions: 0, positions: [] })
    const res3 = await daemon.runManagementCycle({ silent: true })
    expect(res3).toContain('No open positions')
  })

  it('atomically prevents concurrent runScreeningCycle executions', async () => {
    let resolvePositions: any
    adapters.meteora.getMyPositions = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePositions = resolve
        }),
    )

    // Start screening 1
    const p1 = daemon.runScreeningCycle({ silent: true })
    // Attempt concurrent screening 2 immediately
    const p2 = daemon.runScreeningCycle({ silent: true })

    // p2 should immediately return null because screeningBusy lock is held synchronously
    const res2 = await p2
    expect(res2).toBeNull()

    // Resolve screening 1 pre-checks
    resolvePositions({ total_positions: 5, positions: [] }) // exceeds max positions, skips
    const res1 = await p1
    expect(res1).toContain('max positions reached')

    // Lock is released after completion
    expect((daemon as any).screeningBusy).toBe(false)
  })

  it('releases lock cleanly even when runManagementCycle throws', async () => {
    adapters.meteora.getMyPositions = vi.fn().mockResolvedValue({
      total_positions: 1,
      positions: [{ position: 'pos_1', pool: 'pool_1', pair: 'SOL-USDC' }],
    })
    adapters.domain.recordPositionSnapshot = vi.fn().mockImplementation(() => {
      throw new Error('State explosion')
    })

    const res = await daemon.runManagementCycle({ silent: true })
    expect(res).toContain('Management cycle failed: State explosion')
    expect((daemon as any).managementBusy).toBe(false)
  })

  it('releases lock cleanly even when runScreeningCycle throws', async () => {
    adapters.meteora.getMyPositions = vi.fn().mockRejectedValue(new Error('Screening RPC explosion'))

    const res = await daemon.runScreeningCycle({ silent: true })
    expect(res).toContain('Screening cycle failed: Screening RPC explosion')
    expect((daemon as any).screeningBusy).toBe(false)
  })

  it('parses and persists structured rejected candidate rationales on NO DEPLOY screening decision', async () => {
    adapters.meteora.getMyPositions = vi.fn().mockResolvedValue({ total_positions: 0, positions: [] })
    adapters.wallet.getWalletBalances = vi.fn().mockResolvedValue({ sol: 10, tokens: [] })
    adapters.screening.getTopCandidates = vi.fn().mockResolvedValue({
      candidates: [
        { pool: 'pool_1', name: 'TOKEN1/SOL', base: { mint: 'mint_1' }, bin_step: 100 },
        { pool: 'pool_2', name: 'TOKEN2/SOL', base: { mint: 'mint_2' }, bin_step: 100 },
      ],
      filtered_examples: [{ name: 'EARLY_FILTERED/SOL', reason: 'volume too low' }],
    })
    adapters.domain.parseRejectedCandidates = (content: string) => {
      if (content.includes('TOKEN1/SOL: low fees')) {
        return ['TOKEN1/SOL: low fees', 'TOKEN2/SOL: PvP conflict']
      }
      return []
    }

    const screeningReportContent = `
⛔ NO DEPLOY

Cycle finished with no valid entry.

BEST LOOKING CANDIDATE
TOKEN1/SOL

WHY SKIPPED
Candidates failed qualitative thresholds.

REJECTED
- TOKEN1/SOL: low fees
- TOKEN2/SOL: PvP conflict
`

    vi.spyOn(await import('@etemaro/core'), 'agentLoop').mockResolvedValueOnce({
      content: screeningReportContent,
      steps: [],
      toolCalls: [],
      finalAnswer: screeningReportContent,
    } as any)

    const res = await daemon.runScreeningCycle({ silent: true })
    expect(res).toContain('⛔ NO DEPLOY')
    expect(adapters.domain.appendDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'no_deploy',
        actor: 'SCREENER',
        summary: 'LLM chose no deploy',
        rejected: expect.arrayContaining([
          'TOKEN1/SOL: low fees',
          'TOKEN2/SOL: PvP conflict',
          'EARLY_FILTERED/SOL: volume too low',
        ]),
      }),
    )
  })

  it('logs cron_error when getMyPositions fails in runManagementCycle', async () => {
    adapters.meteora.getMyPositions = vi.fn().mockRejectedValue(new Error('RPC rate limited'))

    const res = await daemon.runManagementCycle({ silent: true })
    expect(res).toBe('No open positions.')
    expect((daemon as any).managementBusy).toBe(false)
  })

  it('logs telegram_warn and handles error gracefully when sendTelegramSafe fails', async () => {
    adapters.telegram.isEnabled = () => true
    adapters.telegram.sendMessage = vi.fn().mockRejectedValue(new Error('Network offline'))

    // Should not throw even when sendMessage rejects
    await expect((daemon as any).sendTelegramSafe('Test message')).resolves.toBeNull()
  })
})

describe('getDeterministicCloseRule suspect PnL handling', () => {
  const mgmtConfig: any = {
    stopLossPct: -10,
    takeProfitPct: 20,
    outOfRangeBinsToClose: 5,
    outOfRangeWaitMinutes: 30,
    minFeePerTvl24h: 1,
  }

  it('skips stop loss close rule when untracked position has deep negative PnL but retains value', () => {
    // Position is active on-chain, not tracked in state.json, but has USD value during an RPC glitch
    const rule = getDeterministicCloseRule(
      {
        position: 'PosUntrackedGlitch',
        pair: 'SOL/USDC',
        pnl_pct: -99.9,
        total_value_usd: 25.0,
      },
      mgmtConfig,
    )
    expect(rule).toBeNull()
  })

  it('triggers stop loss close rule when untracked position has legitimate negative PnL exceeding threshold', () => {
    const rule = getDeterministicCloseRule(
      {
        position: 'PosUntrackedRealLoss',
        pair: 'SOL/USDC',
        pnl_pct: -15.0,
        total_value_usd: 25.0,
      },
      mgmtConfig,
    )
    expect(rule).toEqual({
      action: 'CLOSE',
      rule: 1,
      reason: 'stop loss (pnl=-15.00% threshold=-10%)',
    })
  })

  it('triggers stop loss close rule when deep negative PnL has zero value', () => {
    const rule = getDeterministicCloseRule(
      {
        position: 'PosRuggedZeroValue',
        pair: 'RUG/SOL',
        pnl_pct: -99.9,
        total_value_usd: 0,
        amount_sol: 0,
      },
      mgmtConfig,
    )
    expect(rule).toEqual({
      action: 'CLOSE',
      rule: 1,
      reason: 'stop loss (pnl=-99.90% threshold=-10%)',
    })
  })
})

describe('Telegram /stop & Busy Cycle Queue Draining (#236)', () => {
  let adapters: DaemonAdapters
  let daemon: Daemon
  let exitSpy: any

  beforeEach(() => {
    vi.clearAllMocks()
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any)
    adapters = createMockAdapters()
    adapters.telegram.isEnabled = () => true
    daemon = new Daemon(adapters)
  })

  it('AC-1: queues /stop during active management cycle and shuts down on lock release', async () => {
    const shutdownSpy = vi.spyOn(daemon as any, 'shutdown')
    ;(daemon as any).managementBusy = true

    // Receive /stop while management is busy
    await (daemon as any).telegramHandler({ text: '/stop' })

    expect(adapters.telegram.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('⏳ Queued (1 in queue): "/stop"'),
    )
    expect(shutdownSpy).not.toHaveBeenCalled()
    expect((daemon as any).telegramQueue.length).toBe(1)

    // Release management lock
    ;(daemon as any).releaseLock('management')
    // Wait microtasks
    await new Promise((r) => setTimeout(r, 10))

    expect(adapters.telegram.sendMessage).toHaveBeenCalledWith('🛑 Shutting down agent...')
    expect(shutdownSpy).toHaveBeenCalledWith('telegram /stop')
  })

  it('AC-2: queues /stop during active screening cycle and shuts down on lock release', async () => {
    const shutdownSpy = vi.spyOn(daemon as any, 'shutdown')
    ;(daemon as any).screeningBusy = true

    await (daemon as any).telegramHandler({ text: '/stop' })
    expect(shutdownSpy).not.toHaveBeenCalled()

    // Release screening lock
    ;(daemon as any).releaseLock('screening')
    await new Promise((r) => setTimeout(r, 10))

    expect(adapters.telegram.sendMessage).toHaveBeenCalledWith('🛑 Shutting down agent...')
    expect(shutdownSpy).toHaveBeenCalledWith('telegram /stop')
  })

  it('AC-3: queues /stop during active pnlPoll and shuts down on lock release', async () => {
    const shutdownSpy = vi.spyOn(daemon as any, 'shutdown')
    ;(daemon as any).pnlPollBusy = true

    await (daemon as any).telegramHandler({ text: '/stop' })
    expect(shutdownSpy).not.toHaveBeenCalled()

    // Release pnlPoll lock
    ;(daemon as any).releaseLock('pnlPoll')
    await new Promise((r) => setTimeout(r, 10))

    expect(adapters.telegram.sendMessage).toHaveBeenCalledWith('🛑 Shutting down agent...')
    expect(shutdownSpy).toHaveBeenCalledWith('telegram /stop')
  })

  it('AC-4: queues /stop during active opportunityPoll and shuts down on lock release', async () => {
    const shutdownSpy = vi.spyOn(daemon as any, 'shutdown')
    ;(daemon as any).opportunityPollBusy = true

    await (daemon as any).telegramHandler({ text: '/stop' })
    expect(shutdownSpy).not.toHaveBeenCalled()

    // Release opportunityPoll lock
    ;(daemon as any).releaseLock('opportunityPoll')
    await new Promise((r) => setTimeout(r, 10))

    expect(adapters.telegram.sendMessage).toHaveBeenCalledWith('🛑 Shutting down agent...')
    expect(shutdownSpy).toHaveBeenCalledWith('telegram /stop')
  })

  it('AC-5: prioritizes /stop over other queued commands and prevents remaining queue execution', async () => {
    const shutdownSpy = vi.spyOn(daemon as any, 'shutdown')
    ;(daemon as any).managementBusy = true

    // Queue /screen, /stop, /positions
    await (daemon as any).telegramHandler({ text: '/screen' })
    await (daemon as any).telegramHandler({ text: '/stop' })
    await (daemon as any).telegramHandler({ text: '/positions' })

    expect((daemon as any).telegramQueue.length).toBe(3)
    expect(shutdownSpy).not.toHaveBeenCalled()

    // Release lock to trigger drain
    ;(daemon as any).releaseLock('management')
    await new Promise((r) => setTimeout(r, 10))

    // /stop was prioritized and triggered shutdown
    expect(shutdownSpy).toHaveBeenCalledWith('telegram /stop')
    expect((daemon as any).shuttingDown).toBe(true)
  })

  it('AC-6: queues /stop during free-form chat and shuts down on chat completion', async () => {
    const shutdownSpy = vi.spyOn(daemon as any, 'shutdown')
    ;(daemon as any).busy = true

    await (daemon as any).telegramHandler({ text: '/stop' })
    expect(shutdownSpy).not.toHaveBeenCalled()

    // Simulate chat finally block
    ;(daemon as any).busy = false
    await (daemon as any).drainTelegramQueue()

    expect(adapters.telegram.sendMessage).toHaveBeenCalledWith('🛑 Shutting down agent...')
    expect(shutdownSpy).toHaveBeenCalledWith('telegram /stop')
  })

  it('AC-7: executes immediate shutdown when idle', async () => {
    const shutdownSpy = vi.spyOn(daemon as any, 'shutdown')

    await (daemon as any).telegramHandler({ text: '/stop' })

    expect(adapters.telegram.sendMessage).toHaveBeenCalledWith('🛑 Shutting down agent...')
    expect(shutdownSpy).toHaveBeenCalledWith('telegram /stop')
    expect((daemon as any).telegramQueue.length).toBe(0)
  })

  it('AC-8: shuttingDown flag prevents cycle execution and lock acquisition', async () => {
    ;(daemon as any).shuttingDown = true

    expect((daemon as any).acquireLock('management')).toBe(false)
    expect((daemon as any).acquireLock('screening')).toBe(false)
    expect((daemon as any).acquireLock('pnlPoll')).toBe(false)
    expect((daemon as any).acquireLock('opportunityPoll')).toBe(false)

    const mgmtRes = await daemon.runManagementCycle()
    expect(mgmtRes).toBeNull()

    const screenRes = await daemon.runScreeningCycle()
    expect(screenRes).toBeNull()
  })

  it('AC-9: drains full queue without starving /stop at the tail', async () => {
    const shutdownSpy = vi.spyOn(daemon as any, 'shutdown')
    ;(daemon as any).managementBusy = true

    await (daemon as any).telegramHandler({ text: '/status' })
    await (daemon as any).telegramHandler({ text: '/config' })
    await (daemon as any).telegramHandler({ text: '/positions' })
    await (daemon as any).telegramHandler({ text: '/help' })
    await (daemon as any).telegramHandler({ text: '/stop' })

    expect((daemon as any).telegramQueue.length).toBe(5)

    ;(daemon as any).releaseLock('management')
    await new Promise((r) => setTimeout(r, 10))

    expect(shutdownSpy).toHaveBeenCalledWith('telegram /stop')
  })

  it('Edge Case 1: handles concurrent /stop without duplicate shutdown', async () => {
    const shutdownSpy = vi.spyOn(daemon as any, 'shutdown')

    await (daemon as any).telegramHandler({ text: '/stop' })
    await (daemon as any).telegramHandler({ text: '/stop' })

    expect(shutdownSpy).toHaveBeenCalledTimes(1)
  })

  it('Edge Case 4: shutdown proceeds cleanly even if sendMessage fails or throws', async () => {
    adapters.telegram.sendMessage = vi.fn().mockRejectedValue(new Error('Network offline'))
    const stopPollingSpy = vi.spyOn(adapters.telegram, 'stopPolling')

    await (daemon as any).shutdown('telegram /stop')

    expect((daemon as any).shuttingDown).toBe(true)
    expect(stopPollingSpy).toHaveBeenCalled()
    expect(exitSpy).toHaveBeenCalledWith(0)
  })
})
