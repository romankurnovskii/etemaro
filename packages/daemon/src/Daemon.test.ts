import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Daemon, type DaemonAdapters } from './Daemon.js';

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
  };
}

describe('Daemon — Concurrency & Mutex Guards', () => {
  let adapters: DaemonAdapters;
  let daemon: Daemon;

  beforeEach(() => {
    vi.clearAllMocks();
    adapters = createMockAdapters();
    daemon = new Daemon(adapters);
  });

  it('runManagementCycle skips when managementBusy is true', async () => {
    (daemon as any).managementBusy = true;

    const res = await daemon.runManagementCycle();
    expect(res).toBeNull();
    expect(adapters.meteora.getMyPositions).not.toHaveBeenCalled();
  });

  it('runManagementCycle skips when pnlPollBusy is true', async () => {
    (daemon as any).pnlPollBusy = true;

    const res = await daemon.runManagementCycle();
    expect(res).toBeNull();
    expect(adapters.meteora.getMyPositions).not.toHaveBeenCalled();
  });

  it('runManagementCycle runs when not busy and resets managementBusy on completion', async () => {
    expect((daemon as any).managementBusy).toBe(false);
    expect((daemon as any).pnlPollBusy).toBe(false);

    adapters.meteora.getMyPositions = vi.fn().mockResolvedValue({
      total_positions: 0,
      positions: [],
    });

    const res = await daemon.runManagementCycle({ silent: true });
    expect(res).toContain('No open positions');
    expect((daemon as any).managementBusy).toBe(false);
  });

  it('preserves existing managementBusy state when executing PnL poll action', async () => {
    const actionPositions = [
      {
        position: 'pos_xyz',
        pool: 'pool_123',
        pair: 'SOL-USDC',
        pnl_pct: -6.5,
      },
    ];
    const actionMap = new Map([['pos_xyz', { action: 'CLOSE', rule: 'stop_loss', reason: 'Stop loss hit' }]]);

    // Case 1: managementBusy was FALSE before
    (daemon as any).managementBusy = false;
    const wasManagementBusy = (daemon as any).managementBusy;
    (daemon as any).managementBusy = true;
    try {
      await daemon.executeManagementActions(actionPositions, actionMap, {});
    } finally {
      (daemon as any).managementBusy = wasManagementBusy;
    }
    expect((daemon as any).managementBusy).toBe(false);

    // Case 2: managementBusy was TRUE before (e.g. nested call)
    (daemon as any).managementBusy = true;
    const wasManagementBusy2 = (daemon as any).managementBusy;
    (daemon as any).managementBusy = true;
    try {
      await daemon.executeManagementActions(actionPositions, actionMap, {});
    } finally {
      (daemon as any).managementBusy = wasManagementBusy2;
    }
    expect((daemon as any).managementBusy).toBe(true);
  });
});
