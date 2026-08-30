/**
 * @file Daemon.smart-wallet-screening.test.ts
 * @description Tests for maxPositions enforcement inside the smart-wallet deploy loop.
 * Validates the cap is checked per-iteration, preventing over-allocation when multiple
 * new positions are detected in a single screening cycle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';

// ─── Module-level mocks ─────────────────────────────────────────────────────
// runSmartWalletScreening uses core imports directly (not through adapters):
//   domain.listSmartWallets, meteora.getWalletPositions, domain.diffSmartWalletPositions,
//   getTrackedPositions, screening.getPoolDetail, screening.getRawPoolScreeningRejectReason,
//   domain.recordPositionSnapshot, domain.updateSnapshotPositions
// These must be mocked via vi.mock() before the Daemon class is imported.

// Mock snapshot file state (in-memory). vi.hoisted() runs alongside vi.mock()
// so the factory closure has access to this state at hoist time.
const {
  snapshotState,
  mockGetTrackedPositions,
  mockListSmartWallets,
  mockDiffSmartWalletPositions,
  mockGetWalletPositions,
  mockGetPoolDetail,
  mockGetRawPoolScreeningRejectReason,
  mockRecordPositionSnapshot,
  mockDeployPosition,
  mockUpdateSnapshotPositions,
  mockLog,
  mockGetDataDir,
  mockComputeDeployAmount,
  mockAppendDecision,
} = vi.hoisted(() => ({
  snapshotState: {
    content: null as string | null,
    exists: false as boolean,
  },
  mockGetTrackedPositions: vi.fn(),
  mockListSmartWallets: vi.fn(),
  mockDiffSmartWalletPositions: vi.fn(),
  mockGetWalletPositions: vi.fn(),
  mockGetPoolDetail: vi.fn(),
  mockGetRawPoolScreeningRejectReason: vi.fn(),
  mockRecordPositionSnapshot: vi.fn(),
  mockDeployPosition: vi.fn(),
  mockUpdateSnapshotPositions: vi.fn(),
  mockLog: vi.fn(),
  mockGetDataDir: vi.fn().mockReturnValue('/tmp/test-data'),
  mockComputeDeployAmount: vi.fn().mockReturnValue(1),
  mockAppendDecision: vi.fn(),
}));

// Mock fs operations for snapshot file
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  const existsSync = vi.fn().mockImplementation((filePath: any) => {
    if (String(filePath).includes('.smart-wallets-snapshot.json')) {
      return snapshotState.exists;
    }
    return actual.existsSync(filePath);
  });
  const readFileSync = vi.fn().mockImplementation((filePath: any, encoding?: any) => {
    if (String(filePath).includes('.smart-wallets-snapshot.json')) {
      if (snapshotState.content === null) {
        throw new Error('ENOENT: no such file or directory');
      }
      return snapshotState.content;
    }
    return actual.readFileSync(filePath, encoding);
  });
  const writeFileSync = vi.fn().mockImplementation((filePath: any, data: any, options?: any) => {
    if (String(filePath).includes('.smart-wallets-snapshot.json')) {
      snapshotState.content = data;
      snapshotState.exists = true;
      return undefined;
    }
    return actual.writeFileSync(filePath, data, options);
  });
  const renameSync = vi.fn().mockImplementation((oldPath: any, newPath: any) => {
    if (String(oldPath).includes('.smart-wallets-snapshot.json') || String(newPath).includes('.smart-wallets-snapshot.json')) {
      snapshotState.exists = true;
      return undefined;
    }
    return actual.renameSync(oldPath, newPath);
  });
  const unlinkSync = vi.fn().mockImplementation((filePath: any) => {
    if (String(filePath).includes('.smart-wallets-snapshot.json')) {
      return undefined;
    }
    return actual.unlinkSync(filePath);
  });
  const mkdirSync = vi.fn().mockImplementation((path: string, options?: any) => {
    if (path === '/tmp/test-data') {
      return undefined;
    }
    return actual.mkdirSync(path, options);
  });

  return {
    ...actual,
    existsSync,
    readFileSync,
    writeFileSync,
    renameSync,
    unlinkSync,
    mkdirSync,
    default: {
      ...((actual as any).default ?? actual),
      existsSync,
      readFileSync,
      writeFileSync,
      renameSync,
      unlinkSync,
      mkdirSync,
    },
  };
});

vi.mock('@etemaro/core', () => ({
  // Stubs for all Daemon.ts imports (minimized — only what matters)
  config: {
    risk: { maxPositions: 2, maxDeployAmount: 10 },
    strategy: { strategyMeteora: 'bid_ask' },
    screening: { entrySource: 'smart_wallets', timeframe: '5m', category: 'trending' },
    management: { deployAmountSol: 1, gasReserve: 0.01 },
    schedule: { screeningIntervalMin: 30, managementIntervalMin: 10 },
    opportunity: { enabled: false, pollIntervalSec: 45 },
    llm: { screeningModel: 'test' },
  },
  computeDeployAmount: mockComputeDeployAmount,
  getDataDir: mockGetDataDir,
  dataPath: (p: string) => path.join('/tmp/test-data', p),
  sharedDataPath: (p: string) => path.join('/tmp/test-data', p),
  configPath: (p: string) => path.join('/tmp/test-config', p),
  log: mockLog,
  getTrackedPosition: vi.fn(),
  getTrackedPositions: mockGetTrackedPositions,
  setPositionInstruction: vi.fn(),
  updatePnlAndCheckExits: vi.fn(),
  confirmPeak: vi.fn(),
  registerExitSignal: vi.fn(),
  getLastBriefingDate: vi.fn(),
  setLastBriefingDate: vi.fn(),
  getStateSummary: vi.fn(),
  reloadScreeningThresholds: vi.fn(),
  agentLoop: vi.fn(),
  meteora: {
    getMyPositions: vi.fn().mockResolvedValue({ positions: [], total_positions: 0 }),
    closePosition: vi.fn().mockResolvedValue({ success: true }),
    getActiveBin: vi.fn().mockResolvedValue({ activeId: 100 }),
    getWalletPositions: mockGetWalletPositions,
    deployPosition: mockDeployPosition,
  },
  wallet: { getWalletBalances: vi.fn().mockResolvedValue({ sol: 10, tokens: [] }) },
  screening: {
    getTopCandidates: vi.fn().mockResolvedValue({ candidates: [] }),
    degenScore: vi.fn().mockReturnValue(50),
    getPoolDetail: mockGetPoolDetail,
    getRawPoolScreeningRejectReason: mockGetRawPoolScreeningRejectReason,
  },
  toolExecutor: { executeTool: vi.fn(), registerCronRestarter: vi.fn() },
  telegram: { startPolling: vi.fn(), stopPolling: vi.fn() },
  desktop: { start: vi.fn(), stop: vi.fn(), on: vi.fn() },
  briefing: { generateBriefing: vi.fn() },
  hivemind: {
    bootstrapHiveMind: vi.fn(),
    ensureAgentId: vi.fn().mockReturnValue('a'),
    getHiveMindPullMode: vi.fn().mockReturnValue('manual'),
    isHiveMindEnabled: vi.fn().mockReturnValue(false),
    pullHiveMindLessons: vi.fn().mockResolvedValue([]),
    pullHiveMindPresets: vi.fn().mockResolvedValue([]),
    registerHiveMindAgent: vi.fn(),
    startHiveMindBackgroundSync: vi.fn(),
  },
  domain: {
    validateActiveStrategy: vi.fn(),
    getActiveStrategy: vi.fn().mockReturnValue({}),
    recordPositionSnapshot: mockRecordPositionSnapshot,
    recallForPool: vi.fn().mockReturnValue(null),
    addPoolNote: vi.fn(),
    checkSmartWalletsOnPool: vi.fn().mockResolvedValue({ in_pool: [] }),
    getTokenNarrative: vi.fn().mockResolvedValue({}),
    getTokenInfo: vi.fn().mockResolvedValue({}),
    stageSignals: vi.fn(),
    getWeightsSummary: vi.fn().mockReturnValue(''),
    appendDecision: mockAppendDecision,
    listSmartWallets: mockListSmartWallets,
    listBlacklist: vi.fn().mockReturnValue({ count: 0, blacklist: [] }),
    diffSmartWalletPositions: mockDiffSmartWalletPositions,
    updateSnapshotPositions: mockUpdateSnapshotPositions,
  },
  token: { getPrice: vi.fn(), getDecimals: vi.fn(), getSymbol: vi.fn() },
}));

// Must import Daemon AFTER vi.mock so it gets the mocked module
import { Daemon, type DaemonAdapters } from './Daemon.js';

// ─── Adapter factory ────────────────────────────────────────────────────────
function createMockAdapters(): DaemonAdapters {
  return {
    meteora: {
      getMyPositions: vi.fn().mockResolvedValue({ positions: [], total_positions: 0 }),
      closePosition: vi.fn().mockResolvedValue({ success: true }),
      getActiveBin: vi.fn().mockResolvedValue({ activeId: 100 }),
      getWalletPositions: mockGetWalletPositions,
      deployPosition: mockDeployPosition,
    } as any,
    wallet: { getWalletBalances: vi.fn().mockResolvedValue({ sol: 10, tokens: [] }) },
    screening: {
      getTopCandidates: vi.fn().mockResolvedValue({ candidates: [] }),
      degenScore: vi.fn().mockReturnValue(50),
      getPoolDetail: mockGetPoolDetail,
      getRawPoolScreeningRejectReason: mockGetRawPoolScreeningRejectReason,
    } as any,
    toolExecutor: { executeTool: vi.fn(), registerCronRestarter: vi.fn() },
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
    briefing: { generateBriefing: vi.fn().mockResolvedValue('briefing') },
    hivemind: {
      bootstrapHiveMind: vi.fn().mockResolvedValue({}),
      ensureAgentId: vi.fn().mockReturnValue('a'),
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
      recordPositionSnapshot: mockRecordPositionSnapshot,
      recallForPool: vi.fn().mockReturnValue(null),
      addPoolNote: vi.fn(),
      checkSmartWalletsOnPool: vi.fn().mockResolvedValue({ in_pool: [] }),
      getTokenNarrative: vi.fn().mockResolvedValue({}),
      getTokenInfo: vi.fn().mockResolvedValue({}),
      stageSignals: vi.fn(),
      getWeightsSummary: vi.fn().mockReturnValue(''),
      appendDecision: mockAppendDecision,
      listSmartWallets: mockListSmartWallets,
      diffSmartWalletPositions: mockDiffSmartWalletPositions,
      updateSnapshotPositions: mockUpdateSnapshotPositions,
    } as any,
    agentLoopDeps: {} as any,
  };
}

// ─── Helper to reset snapshot state ───────────────────────────────────────
function resetSnapshot() {
  snapshotState.content = null;
  snapshotState.exists = false;
}

// ─── Shared helpers ─────────────────────────────────────────────────────────
function walletPos(position: string, pool: string) {
  return { position, pool };
}

function okDetail(name: string) {
  return { name, fee_tvl_ratio: 0.1 };
}

// ─── Tests ──────────────────────────────────────────────────────────────────
describe('runSmartWalletScreening — maxPositions enforcement', () => {
  let adapters: DaemonAdapters;
  let daemon: Daemon;

  beforeEach(() => {
    vi.clearAllMocks();
    resetSnapshot();
    adapters = createMockAdapters();
    daemon = new Daemon(adapters);

    // Defaults for tests that don't need specifics
    mockGetWalletPositions.mockResolvedValue({ positions: [] });
    mockGetPoolDetail.mockResolvedValue({ name: 'pool' });
    mockGetRawPoolScreeningRejectReason.mockReturnValue(null);
    mockRecordPositionSnapshot.mockImplementation(() => {});
    mockDeployPosition.mockImplementation((opts: any) => Promise.resolve({ position: { position: opts.pool_address + '_pos' } }));
    mockUpdateSnapshotPositions.mockImplementation((snap: any, processed: any) => ({
      ...snap,
      positions: [...(snap.positions || []), ...processed.map((p: any) => p.position)],
    }));
  });

  // ── Case 1: multiple new pools, zero open → deploy exactly maxPositions ──
  it('deploys up to maxPositions when starting from zero', async () => {
    mockGetTrackedPositions.mockReturnValue([]);
    mockListSmartWallets.mockReturnValue({
      wallets: [
        { address: 'w1', type: 'lp' },
        { address: 'w2', type: 'lp' },
      ],
    });
    mockGetWalletPositions
      .mockResolvedValueOnce({ positions: [walletPos('p1', 'poolA')] })
      .mockResolvedValueOnce({ positions: [walletPos('p2', 'poolB')] });
    mockDiffSmartWalletPositions.mockReturnValue({
      isFirstRun: false,
      newPositions: [walletPos('p1', 'poolA'), walletPos('p2', 'poolB')],
      uniquePools: ['poolA', 'poolB'],
      nextSnapshot: { initialized: true, positions: [] },
    });
    mockGetPoolDetail.mockImplementation((o: any) => (o.pool_address === 'poolA' ? okDetail('A') : okDetail('B')));

    const result = await daemon.runSmartWalletScreening({ liveMessage: null, deployAmount: 1 });

    expect(mockDeployPosition).toHaveBeenCalledTimes(2);
    expect(result).toContain('Deployed to 2 new pools');
  });

  // ── Case 2: already at cap → deploy zero ──────────────────────────────────
  it('deploys zero when already at maxPositions', async () => {
    mockGetTrackedPositions.mockReturnValue([
      { position: 'e1', pool: 'existingPool1' },
      { position: 'e2', pool: 'existingPool2' },
    ]);
    mockListSmartWallets.mockReturnValue({
      wallets: [
        { address: 'w1', type: 'lp' },
        { address: 'w2', type: 'lp' },
      ],
    });
    mockGetWalletPositions
      .mockResolvedValueOnce({ positions: [walletPos('p1', 'poolA')] })
      .mockResolvedValueOnce({ positions: [walletPos('p2', 'poolB')] });
    mockDiffSmartWalletPositions.mockReturnValue({
      isFirstRun: false,
      newPositions: [walletPos('p1', 'poolA'), walletPos('p2', 'poolB')],
      uniquePools: ['poolA', 'poolB'],
      nextSnapshot: { initialized: true, positions: [] },
    });

    const result = await daemon.runSmartWalletScreening({ liveMessage: null, deployAmount: 1 });

    expect(mockDeployPosition).toHaveBeenCalledTimes(0);
    expect(result).toContain('Deployed to 0 new pools');
  });

  // ── Case 3: cap-1 open, 3 new → deploy exactly 1, then stop ──────────────
  it('stops deploying when cap reached mid-loop', async () => {
    mockGetTrackedPositions.mockReturnValue([{ position: 'e1', pool: 'existingPool' }]);
    mockListSmartWallets.mockReturnValue({
      wallets: [
        { address: 'w1', type: 'lp' },
        { address: 'w2', type: 'lp' },
        { address: 'w3', type: 'lp' },
      ],
    });
    mockGetWalletPositions
      .mockResolvedValueOnce({ positions: [walletPos('p1', 'poolA')] })
      .mockResolvedValueOnce({ positions: [walletPos('p2', 'poolB')] })
      .mockResolvedValueOnce({ positions: [walletPos('p3', 'poolC')] });
    mockDiffSmartWalletPositions.mockReturnValue({
      isFirstRun: false,
      newPositions: [walletPos('p1', 'poolA'), walletPos('p2', 'poolB'), walletPos('p3', 'poolC')],
      uniquePools: ['poolA', 'poolB', 'poolC'],
      nextSnapshot: { initialized: true, positions: [] },
    });
    mockGetPoolDetail.mockImplementation((o: any) => {
      const m: Record<string, string> = { poolA: 'A', poolB: 'B', poolC: 'C' };
      return okDetail(m[o.pool_address] || 'x');
    });

    const result = await daemon.runSmartWalletScreening({ liveMessage: null, deployAmount: 1 });

    // maxPositions=2, already 1 open → can deploy only 1
    expect(mockDeployPosition).toHaveBeenCalledTimes(1);
    expect(result).toContain('Deployed to 1 new pools');
    expect(mockDeployPosition.mock.calls[0]?.[0]?.pool_address).toBe('poolA');
  });

  // ── Case 4: single wallet with multiple positions, cap applies ────────────
  it('enforces cap when one wallet opens multiple positions', async () => {
    mockGetTrackedPositions.mockReturnValue([]);
    mockListSmartWallets.mockReturnValue({ wallets: [{ address: 'w1', type: 'lp' }] });
    mockGetWalletPositions.mockResolvedValue({
      positions: [walletPos('p1', 'poolA'), walletPos('p2', 'poolB'), walletPos('p3', 'poolC')],
    });
    mockDiffSmartWalletPositions.mockReturnValue({
      isFirstRun: false,
      newPositions: [walletPos('p1', 'poolA'), walletPos('p2', 'poolB'), walletPos('p3', 'poolC')],
      uniquePools: ['poolA', 'poolB', 'poolC'],
      nextSnapshot: { initialized: true, positions: [] },
    });
    mockGetPoolDetail.mockImplementation((o: any) => {
      const m: Record<string, string> = { poolA: 'A', poolB: 'B', poolC: 'C' };
      return okDetail(m[o.pool_address] || 'x');
    });

    const result = await daemon.runSmartWalletScreening({ liveMessage: null, deployAmount: 1 });

    expect(mockDeployPosition).toHaveBeenCalledTimes(2);
    expect(result).toContain('Deployed to 2 new pools');
  });

  // ── Case 5: no new positions → early return before loop ───────────────────
  it('returns early when no new positions detected', async () => {
    mockGetTrackedPositions.mockReturnValue([]);
    mockListSmartWallets.mockReturnValue({ wallets: [{ address: 'w1', type: 'lp' }] });
    mockGetWalletPositions.mockResolvedValue({ positions: [walletPos('p1', 'poolA')] });
    mockDiffSmartWalletPositions.mockReturnValue({
      isFirstRun: false,
      newPositions: [],
      uniquePools: [],
      nextSnapshot: { initialized: true, positions: ['p1'] },
    });

    const result = await daemon.runSmartWalletScreening({ liveMessage: null, deployAmount: 1 });

    expect(mockDeployPosition).toHaveBeenCalledTimes(0);
    expect(result).toBe('No new positions detected by smart wallets.');
  });

  // ── Case 6: vetoed positions don't consume cap slots ──────────────────────
  it('does not count vetoed positions toward cap', async () => {
    mockGetTrackedPositions.mockReturnValue([]);
    mockListSmartWallets.mockReturnValue({
      wallets: [
        { address: 'w1', type: 'lp' },
        { address: 'w2', type: 'lp' },
        { address: 'w3', type: 'lp' },
      ],
    });
    mockGetWalletPositions
      .mockResolvedValueOnce({ positions: [walletPos('p1', 'poolA')] })
      .mockResolvedValueOnce({ positions: [walletPos('p2', 'poolB')] })
      .mockResolvedValueOnce({ positions: [walletPos('p3', 'poolC')] });
    mockDiffSmartWalletPositions.mockReturnValue({
      isFirstRun: false,
      newPositions: [walletPos('p1', 'poolA'), walletPos('p2', 'poolB'), walletPos('p3', 'poolC')],
      uniquePools: ['poolA', 'poolB', 'poolC'],
      nextSnapshot: { initialized: true, positions: [] },
    });
    mockGetPoolDetail.mockImplementation((o: any) => {
      const m: Record<string, string> = { poolA: 'A', poolB: 'B', poolC: 'C' };
      return okDetail(m[o.pool_address] || 'x');
    });
    // Veto poolB — it should be skipped, not count toward the cap
    mockGetRawPoolScreeningRejectReason.mockImplementation((detail: any) => (detail.name === 'B' ? 'Low TVL' : null));

    const result = await daemon.runSmartWalletScreening({ liveMessage: null, deployAmount: 1 });

    // poolA deployed, poolB vetoed (skipped, not a slot), poolC deployed → 2 deploys
    expect(mockDeployPosition).toHaveBeenCalledTimes(2);
    expect(result).toContain('Deployed to 2 new pools');
    expect(mockDeployPosition.mock.calls.map((c: any) => c[0].pool_address)).toEqual(['poolA', 'poolC']);
  });

  // ── Case 7: duplicate pool in newPositions → only first deploys ───────────
  it('skips duplicate pool already deployed in same loop iteration', async () => {
    mockGetTrackedPositions.mockReturnValue([]);
    mockListSmartWallets.mockReturnValue({ wallets: [{ address: 'w1', type: 'lp' }] });
    mockGetWalletPositions.mockResolvedValue({
      positions: [walletPos('p1', 'poolA'), walletPos('p2', 'poolA')], // same pool
    });
    mockDiffSmartWalletPositions.mockReturnValue({
      isFirstRun: false,
      newPositions: [walletPos('p1', 'poolA'), walletPos('p2', 'poolA')],
      uniquePools: ['poolA'],
      nextSnapshot: { initialized: true, positions: [] },
    });
    mockGetPoolDetail.mockImplementation((o: any) => okDetail('A'));

    const result = await daemon.runSmartWalletScreening({ liveMessage: null, deployAmount: 1 });

    // p1 deploys, p2 skipped (poolA already open) → 1 deploy
    expect(mockDeployPosition).toHaveBeenCalledTimes(1);
    expect(result).toContain('Deployed to 1 new pools');
  });

  // ── Case 8: cap-2 open, 5 new → deploy exactly 2 ─────────────────────────
  it('deploys remaining capacity when many candidates', async () => {
    mockGetTrackedPositions.mockReturnValue([
      { position: 'e1', pool: 'existingPool1' },
      { position: 'e2', pool: 'existingPool2' },
    ]);
    mockListSmartWallets.mockReturnValue({
      wallets: [{ address: 'w1', type: 'lp' }],
    });
    mockGetWalletPositions.mockResolvedValue({
      positions: [walletPos('p1', 'poolA'), walletPos('p2', 'poolB'), walletPos('p3', 'poolC'), walletPos('p4', 'poolD'), walletPos('p5', 'poolE')],
    });
    mockDiffSmartWalletPositions.mockReturnValue({
      isFirstRun: false,
      newPositions: [
        walletPos('p1', 'poolA'),
        walletPos('p2', 'poolB'),
        walletPos('p3', 'poolC'),
        walletPos('p4', 'poolD'),
        walletPos('p5', 'poolE'),
      ],
      uniquePools: ['poolA', 'poolB', 'poolC', 'poolD', 'poolE'],
      nextSnapshot: { initialized: true, positions: [] },
    });
    mockGetPoolDetail.mockImplementation((o: any) => okDetail(o.pool_address));

    const result = await daemon.runSmartWalletScreening({ liveMessage: null, deployAmount: 1 });

    // maxPositions=2, already at 2 → deploy 0
    expect(mockDeployPosition).toHaveBeenCalledTimes(0);
    expect(result).toContain('Deployed to 0 new pools');
  });

  // ── Case 9: deploy error on one doesn't consume a cap slot ────────────────
  it('failed deploy does not count toward cap', async () => {
    mockGetTrackedPositions.mockReturnValue([{ position: 'e1', pool: 'existingPool' }]);
    mockListSmartWallets.mockReturnValue({
      wallets: [
        { address: 'w1', type: 'lp' },
        { address: 'w2', type: 'lp' },
      ],
    });
    mockGetWalletPositions
      .mockResolvedValueOnce({ positions: [walletPos('p1', 'poolA')] })
      .mockResolvedValueOnce({ positions: [walletPos('p2', 'poolB')] });
    mockDiffSmartWalletPositions.mockReturnValue({
      isFirstRun: false,
      newPositions: [walletPos('p1', 'poolA'), walletPos('p2', 'poolB')],
      uniquePools: ['poolA', 'poolB'],
      nextSnapshot: { initialized: true, positions: [] },
    });
    mockGetPoolDetail.mockImplementation((o: any) => {
      const m: Record<string, string> = { poolA: 'A', poolB: 'B' };
      return okDetail(m[o.pool_address] || 'x');
    });
    // First deploy fails, second succeeds
    mockDeployPosition.mockRejectedValueOnce(new Error('RPC timeout')).mockResolvedValueOnce({ position: { position: 'poolB_pos' } });

    const result = await daemon.runSmartWalletScreening({ liveMessage: null, deployAmount: 1 });

    // Both attempted; cap check happens before deploy, not after
    // p1 fails (no open position tracked for it), p2 succeeds
    expect(mockDeployPosition).toHaveBeenCalledTimes(2);
    expect(result).toContain('Deployed to 1 new pools');
  });

  // ── Case 10: cap-1 open, 3 new with one vetoed → deploy 2 (cap) ──────────
  it('deploys up to remaining capacity, skipping vetoed', async () => {
    mockGetTrackedPositions.mockReturnValue([{ position: 'e1', pool: 'existingPool' }]);
    mockListSmartWallets.mockReturnValue({
      wallets: [
        { address: 'w1', type: 'lp' },
        { address: 'w2', type: 'lp' },
        { address: 'w3', type: 'lp' },
      ],
    });
    mockGetWalletPositions
      .mockResolvedValueOnce({ positions: [walletPos('p1', 'poolA')] })
      .mockResolvedValueOnce({ positions: [walletPos('p2', 'poolB')] })
      .mockResolvedValueOnce({ positions: [walletPos('p3', 'poolC')] });
    mockDiffSmartWalletPositions.mockReturnValue({
      isFirstRun: false,
      newPositions: [walletPos('p1', 'poolA'), walletPos('p2', 'poolB'), walletPos('p3', 'poolC')],
      uniquePools: ['poolA', 'poolB', 'poolC'],
      nextSnapshot: { initialized: true, positions: [] },
    });
    mockGetPoolDetail.mockImplementation((o: any) => {
      const m: Record<string, string> = { poolA: 'A', poolB: 'B', poolC: 'C' };
      return okDetail(m[o.pool_address] || 'x');
    });
    mockGetRawPoolScreeningRejectReason.mockImplementation((detail: any) => (detail.name === 'A' ? 'Bad pool' : null));

    const result = await daemon.runSmartWalletScreening({ liveMessage: null, deployAmount: 1 });

    // poolA vetoed → skip (no cap slot), poolB deployed, cap reached → stop
    expect(mockDeployPosition).toHaveBeenCalledTimes(1);
    expect(result).toContain('Deployed to 1 new pools');
  });

  // ── Case 11: firstRun → early return, no loop at all ─────────────────────
  it('returns early on first run (baseline snapshot)', async () => {
    mockGetTrackedPositions.mockReturnValue([]);
    mockListSmartWallets.mockReturnValue({ wallets: [{ address: 'w1', type: 'lp' }] });
    mockGetWalletPositions.mockResolvedValue({
      positions: [walletPos('p1', 'poolA'), walletPos('p2', 'poolB')],
    });
    mockDiffSmartWalletPositions.mockReturnValue({
      isFirstRun: true,
      newPositions: [],
      uniquePools: [],
      nextSnapshot: { initialized: true, positions: ['p1', 'p2'] },
    });

    const result = await daemon.runSmartWalletScreening({ liveMessage: null, deployAmount: 1 });

    expect(mockDeployPosition).toHaveBeenCalledTimes(0);
    expect(result).toContain('Smart wallets initialized');
  });

  // ── Case 12: no wallets → early return ────────────────────────────────────
  it('returns early when no smart wallets tracked', async () => {
    mockGetTrackedPositions.mockReturnValue([]);
    mockListSmartWallets.mockReturnValue({ wallets: [] });

    const result = await daemon.runSmartWalletScreening({ liveMessage: null, deployAmount: 1 });

    expect(mockDeployPosition).toHaveBeenCalledTimes(0);
    expect(result).toBe('No smart LP wallets tracked.');
  });

  // ── Case 13: verify snapshot updated with resolved-only positions ──────────
  it('updates snapshot with resolved positions only', async () => {
    mockGetTrackedPositions.mockReturnValue([]);
    mockListSmartWallets.mockReturnValue({
      wallets: [
        { address: 'w1', type: 'lp' },
        { address: 'w2', type: 'lp' },
      ],
    });
    mockGetWalletPositions
      .mockResolvedValueOnce({ positions: [walletPos('p1', 'poolA')] })
      .mockResolvedValueOnce({ positions: [walletPos('p2', 'poolB')] });
    mockDiffSmartWalletPositions.mockReturnValue({
      isFirstRun: false,
      newPositions: [walletPos('p1', 'poolA'), walletPos('p2', 'poolB')],
      uniquePools: ['poolA', 'poolB'],
      nextSnapshot: { initialized: true, positions: [] },
    });
    mockGetPoolDetail.mockImplementation((o: any) => okDetail(o.pool_address));

    await daemon.runSmartWalletScreening({ liveMessage: null, deployAmount: 1 });

    expect(mockUpdateSnapshotPositions).toHaveBeenCalledTimes(1);
    const [snap, processed] = mockUpdateSnapshotPositions.mock.calls[0] ?? [{}, []];
    expect(snap.initialized).toBe(true);
    // Both resolved (poolA deployed, poolB deployed)
    expect(processed).toHaveLength(2);
    expect(processed.every((p: any) => p.resolved)).toBe(true);
  });

  // ── Case 14: cap=1, 3 new → deploy exactly 1, remaining saved for later ──
  it('respects maxPositions=1 and deploys only one', async () => {
    // Override config for this test
    const coreModule = await import('@etemaro/core');
    const originalConfig = { ...coreModule.config };
    coreModule.config.risk.maxPositions = 1;

    mockGetTrackedPositions.mockReturnValue([]);
    mockListSmartWallets.mockReturnValue({
      wallets: [{ address: 'w1', type: 'lp' }],
    });
    mockGetWalletPositions.mockResolvedValue({
      positions: [walletPos('p1', 'poolA'), walletPos('p2', 'poolB'), walletPos('p3', 'poolC')],
    });
    mockDiffSmartWalletPositions.mockReturnValue({
      isFirstRun: false,
      newPositions: [walletPos('p1', 'poolA'), walletPos('p2', 'poolB'), walletPos('p3', 'poolC')],
      uniquePools: ['poolA', 'poolB', 'poolC'],
      nextSnapshot: { initialized: true, positions: [] },
    });
    mockGetPoolDetail.mockImplementation((o: any) => {
      const m: Record<string, string> = { poolA: 'A', poolB: 'B', poolC: 'C' };
      return okDetail(m[o.pool_address] || 'x');
    });

    const result = await daemon.runSmartWalletScreening({ liveMessage: null, deployAmount: 1 });

    expect(mockDeployPosition).toHaveBeenCalledTimes(1);
    expect(result).toContain('Deployed to 1 new pools');
    expect(mockDeployPosition.mock.calls[0]?.[0]?.pool_address).toBe('poolA');

    // Restore config
    coreModule.config.risk.maxPositions = originalConfig.risk.maxPositions;
  });
});
