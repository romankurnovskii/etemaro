import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  reconcileTrackedPositions,
  getTrackedPositions,
  getTrackedPosition,
  trackPosition,
  recordClose,
  syncOpenPositions,
  withStateLock,
  setPositionInstruction,
  confirmPeak,
  isPnlSuspect,
  updatePnlAndCheckExits,
  __setStateFilePath,
} from './state.js';

// Isolate the test from the real data/state.json via the test seam.
const TMP_STATE = path.join(os.tmpdir(), `etemaro-state-test-${process.pid}.json`);

describe('reconcileTrackedPositions', () => {
  beforeAll(() => {
    __setStateFilePath(TMP_STATE);
  });

  afterAll(() => {
    if (fs.existsSync(TMP_STATE)) fs.unlinkSync(TMP_STATE);
  });

  beforeEach(() => {
    if (fs.existsSync(TMP_STATE)) fs.unlinkSync(TMP_STATE);
  });

  it('imports an on-chain position the agent did not deploy', () => {
    const added = reconcileTrackedPositions([
      { position: 'PosX', pool: 'PoolA', pool_name: 'TOKEN/SOL', lower_bin: 10, upper_bin: 20, fee_per_tvl_24h: 12.5, total_value_true_usd: 100 },
    ]);
    expect(added).toBe(1);
    const tracked = getTrackedPositions(true);
    expect(tracked).toHaveLength(1);
    const pos = tracked[0]!;
    expect(pos.position).toBe('PosX');
    expect(pos.pool).toBe('PoolA');
    expect(pos.strategy).toBe('imported');
    expect(pos.bin_range).toEqual({ min: 10, max: 20 });
    expect(pos.notes.join(' ')).toMatch(/Imported from on-chain/);
  });

  it('does not clobber an already-tracked position', () => {
    trackPosition({
      position: 'PosY',
      pool: 'PoolB',
      pool_name: 'OTHER/SOL',
      strategy: 'bid_ask',
      bin_range: { min: 1, max: 2 },
      amount_sol: 0.1,
      active_bin: 1,
      bin_step: 100,
      volatility: 1.2,
      fee_tvl_ratio: 5,
      organic_score: 80,
      initial_value_usd: 50,
    } as any);

    const added = reconcileTrackedPositions([
      { position: 'PosY', pool: 'PoolB', pool_name: 'OTHER/SOL', lower_bin: 99, upper_bin: 99, fee_per_tvl_24h: 1 },
    ]);
    expect(added).toBe(0);
    const tracked = getTrackedPositions(true);
    expect(tracked).toHaveLength(1);
    const pos = tracked[0]!;
    expect(pos.strategy).toBe('bid_ask'); // original metadata preserved
    expect(pos.bin_range).toEqual({ min: 1, max: 2 });
  });

  it('syncOpenPositions still closes positions missing on-chain', () => {
    trackPosition({
      position: 'PosZ',
      pool: 'PoolC',
      pool_name: 'Z/SOL',
      strategy: 'bid_ask',
      bin_range: { min: 1, max: 2 },
      amount_sol: 0.1,
      active_bin: 1,
      bin_step: 100,
      volatility: 1,
      fee_tvl_ratio: 1,
      organic_score: 70,
      initial_value_usd: 50,
    } as any);
    // Older than SYNC_GRACE_MS so it is eligible for auto-close.
    const state = JSON.parse(fs.readFileSync(TMP_STATE, 'utf8'));
    state.positions.PosZ.deployed_at = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    fs.writeFileSync(TMP_STATE, JSON.stringify(state));

    syncOpenPositions(['PosY']); // PosZ not in on-chain list
    const tracked = getTrackedPositions(true);
    expect(tracked.find((p) => p.position === 'PosZ')).toBeUndefined();
  });
});

function deployOpts(position: string) {
  return {
    position,
    pool: 'PoolFail',
    pool_name: 'FAIL/SOL',
    strategy: 'bid_ask',
    bin_range: { min: 1, max: 2 },
    amount_sol: 0.1,
    active_bin: 1,
    bin_step: 100,
    volatility: 1,
    fee_tvl_ratio: 1,
    organic_score: 70,
    initial_value_usd: 50,
  } as const;
}

describe('save() persistence failures', () => {
  beforeAll(() => {
    __setStateFilePath(TMP_STATE);
  });

  afterAll(() => {
    if (fs.existsSync(TMP_STATE)) fs.unlinkSync(TMP_STATE);
  });

  beforeEach(() => {
    if (fs.existsSync(TMP_STATE)) fs.unlinkSync(TMP_STATE);
  });

  it('trackPosition throws when state.json cannot be written and does not pretend the position was tracked', () => {
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('disk full');
    });

    try {
      expect(() => trackPosition(deployOpts('PosPersistFail') as any)).toThrow('disk full');
      expect(getTrackedPosition('PosPersistFail')).toBeNull();
      expect(fs.existsSync(TMP_STATE)).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('recordClose throws when state.json cannot be written and leaves the position open on disk', () => {
    trackPosition(deployOpts('PosCloseFail') as any);
    expect(getTrackedPosition('PosCloseFail')?.closed).toBe(false);

    const spy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('permission denied');
    });

    try {
      expect(() => recordClose('PosCloseFail', 'agent decision')).toThrow('permission denied');
      expect(getTrackedPosition('PosCloseFail')?.closed).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('state.json corruption handling', () => {
  beforeAll(() => {
    __setStateFilePath(TMP_STATE);
  });

  afterAll(() => {
    if (fs.existsSync(TMP_STATE)) fs.unlinkSync(TMP_STATE);
  });

  beforeEach(() => {
    if (fs.existsSync(TMP_STATE)) fs.unlinkSync(TMP_STATE);
  });

  it('fails fast and throws when state.json contains corrupted JSON', () => {
    fs.writeFileSync(TMP_STATE, '{"positions": { invalid json');
    expect(() => getTrackedPositions()).toThrowError(/Failed to parse JSON file at.*Critical file corrupted/);
  });
});

describe('withStateLock concurrency synchronization', () => {
  beforeAll(() => {
    __setStateFilePath(TMP_STATE);
  });

  afterAll(() => {
    if (fs.existsSync(TMP_STATE)) fs.unlinkSync(TMP_STATE);
  });

  beforeEach(() => {
    if (fs.existsSync(TMP_STATE)) fs.unlinkSync(TMP_STATE);
  });

  it('serializes concurrent async state modifications without losing updates', async () => {
    trackPosition(deployOpts('PosConcurrent') as any);

    // Run 5 concurrent async state updates with simulated async delays
    const updates = [1, 2, 3, 4, 5].map((idx) =>
      withStateLock(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        setPositionInstruction('PosConcurrent', `Instruction-${idx}`);
        confirmPeak('PosConcurrent', idx * 5, 1);
      }),
    );

    await Promise.all(updates);

    const pos = getTrackedPosition('PosConcurrent');
    expect(pos).not.toBeNull();
    // Peak PnL should reflect the maximum confirmed peak PnL (25)
    expect(pos?.peak_pnl_pct).toBe(25);
    // Instruction was set
    expect(pos?.instruction).toMatch(/^Instruction-\d$/);
  });
});

describe('isPnlSuspect', () => {
  it('returns true when pnl_pct_suspicious flag is set', () => {
    expect(isPnlSuspect({ pnl_pct_suspicious: true, pnl_pct: 10 })).toBe(true);
  });

  it('returns false when pnl_pct is null or undefined', () => {
    expect(isPnlSuspect({ pnl_pct: null, total_value_usd: 100 })).toBe(false);
    expect(isPnlSuspect({ pnl_pct: undefined, total_value_usd: 100 })).toBe(false);
  });

  it('returns false for normal negative PnL above -90%', () => {
    expect(isPnlSuspect({ pnl_pct: -15, total_value_usd: 100 })).toBe(false);
    expect(isPnlSuspect({ pnl_pct: -89.9, total_value_usd: 100 })).toBe(false);
  });

  it('flags PnL <= -90% as suspect when position retains USD value without local state', () => {
    // Untracked position on-chain during RPC glitch: trackedAmountSol is null/undefined
    expect(isPnlSuspect({ pnl_pct: -99.5, total_value_usd: 45.2 }, null)).toBe(true);
    expect(isPnlSuspect({ pnl_pct: -95, total_value_true_usd: 10.0 }, undefined)).toBe(true);
  });

  it('flags PnL <= -90% as suspect when position retains SOL value', () => {
    expect(isPnlSuspect({ pnl_pct: -99, amount_sol: 0.5 })).toBe(true);
    expect(isPnlSuspect({ pnl_pct: -99 }, 0.5)).toBe(true);
  });

  it('returns false for PnL <= -90% when position has zero remaining value', () => {
    expect(isPnlSuspect({ pnl_pct: -99.9, total_value_usd: 0, amount_sol: 0 }, 0)).toBe(false);
  });
});

describe('updatePnlAndCheckExits suspect PnL handling', () => {
  beforeAll(() => {
    __setStateFilePath(TMP_STATE);
  });

  afterAll(() => {
    if (fs.existsSync(TMP_STATE)) fs.unlinkSync(TMP_STATE);
  });

  beforeEach(() => {
    if (fs.existsSync(TMP_STATE)) fs.unlinkSync(TMP_STATE);
  });

  it('skips stop-loss exit when deep negative PnL is suspect', () => {
    trackPosition(deployOpts('PosSuspect') as any);
    const result = updatePnlAndCheckExits(
      'PosSuspect',
      {
        pnl_pct: -99,
        total_value_usd: 50,
        in_range: true,
      },
      {
        stopLossPct: -10,
        takeProfitPct: 5,
        trailingTakeProfit: false,
        trailingTriggerPct: 3,
        trailingDropPct: 1,
        outOfRangeWaitMinutes: 30,
        outOfRangeBinsToClose: 5,
        minFeePerTvl24h: 1,
      } as any,
    );
    expect(result).toBeNull();
  });

  it('triggers stop-loss exit for normal negative PnL exceeding threshold', () => {
    trackPosition(deployOpts('PosNormalStop') as any);
    const result = updatePnlAndCheckExits(
      'PosNormalStop',
      {
        pnl_pct: -15,
        total_value_usd: 50,
        in_range: true,
      },
      {
        stopLossPct: -10,
        takeProfitPct: 5,
        trailingTakeProfit: false,
        trailingTriggerPct: 3,
        trailingDropPct: 1,
        outOfRangeWaitMinutes: 30,
        outOfRangeBinsToClose: 5,
        minFeePerTvl24h: 1,
      } as any,
    );
    expect(result).toEqual({
      action: 'STOP_LOSS',
      reason: 'Stop loss: PnL -15.00% <= -10%',
    });
  });
});

