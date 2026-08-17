import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/Config.js', () => ({
  config: {
    hiveMind: {
      enabled: true,
      url: 'https://test-hivemind.api',
      apiKey: 'test-key',
      agentId: 'agt_test123',
    },
  },
}));

vi.mock('../../shared/logger.js', () => ({
  log: vi.fn(),
}));

import { pushHivePerformanceEvent } from './HivemindAdapter.js';

describe('HivemindAdapter — pushHivePerformanceEvent', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('correctly maps pricePnlUsd, netPnlUsd, and pnlUsd in the event payload', async () => {
    let capturedBody: any = null;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url, options) => {
        capturedBody = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({ status: 'ok' }),
        };
      }),
    );

    const result = await pushHivePerformanceEvent({
      position: 'pos123',
      pool: 'pool456',
      pool_name: 'TEST-SOL',
      initial_value_usd: 100,
      final_value_usd: 85,
      fees_earned_usd: 20,
      price_pnl_usd: -15,
      price_pnl_pct: -15,
      net_pnl_usd: 5,
      pnl_usd: 5,
      pnl_pct: 5,
      close_reason: 'manual close',
    });

    expect(result).toEqual({ status: 'ok' });
    expect(capturedBody).not.toBeNull();

    const event = capturedBody.event;
    expect(event.pricePnlUsd).toBe(-15);
    expect(event.pricePnlPct).toBe(-15);
    expect(event.netPnlUsd).toBe(5);
    expect(event.pnlUsd).toBe(5);
    expect(event.feesUsd).toBe(20);
  });

  it('falls back to computing pricePnlUsd if price_pnl_usd is missing from legacy record', async () => {
    let capturedBody: any = null;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url, options) => {
        capturedBody = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({ status: 'ok' }),
        };
      }),
    );

    await pushHivePerformanceEvent({
      position: 'legacy_pos',
      pool: 'pool1',
      pnl_usd: 10,
      fees_earned_usd: 15,
      pnl_pct: 10,
      close_reason: 'manual',
    });

    const event = capturedBody.event;
    // Fallback: pricePnlUsd = pnl_usd ($10) - fees_earned_usd ($15) = -$5
    expect(event.pricePnlUsd).toBe(-5);
    expect(event.netPnlUsd).toBe(10);
    expect(event.pnlUsd).toBe(10);
    expect(event.feesUsd).toBe(15);
  });
});
