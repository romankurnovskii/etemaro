import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { _validateDeployPoolThresholds } from './ToolExecutor.js';
import { config } from '../config/Config.js';

vi.mock('../shared/logger.js', () => ({
  log: vi.fn(),
  logAction: vi.fn(),
  logStructured: vi.fn(),
}));

const DISCOVERY_BASE = 'https://pool-discovery-api.datapi.meteora.ag';
const DLMM_BASE = 'https://dlmm.datapi.meteora.ag';

const discoveryPool = {
  pool_address: 'DISCOVERY_POOL_ADDR',
  name: 'SOL-USDC',
  bin_step: 100,
  dlmm_params: { bin_step: 100 },
  tvl: 50000,
  volume: 2000,
  fee_active_tvl_ratio: 0.05,
  volatility: 0.8,
  token_x: { address: 'TOKENX', symbol: 'SOL', market_cap: 1500000, holders: 8000 },
  token_y: { address: 'TOKENY', symbol: 'USDC' },
};

const dlmmPool = {
  address: 'DLMM_POOL_ADDR',
  name: 'SOL-USDC',
  tvl: 50000,
  pool_config: { bin_step: 100, base_fee_pct: 0.1 },
  token_x: { address: 'TOKENX', symbol: 'SOL', market_cap: 1500000, holders: 8000 },
  token_y: { address: 'TOKENY', symbol: 'USDC' },
  volume: { '30m': 500, '1h': 1000, '24h': 5000 },
  fee_tvl_ratio: { '30m': 0.05, '1h': 0.06, '24h': 0.1 },
  current_price: 1.05,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let discoveryReturn: () => Response;
let dlmmReturn: (path: string) => Response;

function stubFetch(): void {
  const mockFetch = vi.fn(async (url: string) => {
    if (url.startsWith(DISCOVERY_BASE)) return discoveryReturn();
    if (url.startsWith(`${DLMM_BASE}/pools/`)) return dlmmReturn(url);
    throw new Error(`Unexpected URL in test fetch: ${url}`);
  });
  vi.stubGlobal('fetch', mockFetch);
}

const savedScreening = { ...config.screening };

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(config.screening, savedScreening);
  config.screening.minTvl = 10000;
  config.screening.maxTvl = 150000;
  config.screening.minBinStep = 80;
  config.screening.maxBinStep = 125;
  config.screening.minFeeActiveTvlRatio = 0.02;
  config.screening.timeframe = '5m';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ToolExecutor - deploy_position screening via validateDeployPoolThresholds', () => {
  it('passes with warnings when the pool is only indexed in the DLMM API (discovery lag)', async () => {
    discoveryReturn = () => jsonResponse({ data: [] });
    dlmmReturn = () => jsonResponse(dlmmPool);
    stubFetch();

    const result = await _validateDeployPoolThresholds({ pool_address: dlmmPool.address });

    expect(result.pass).toBe(true);
    expect(result.source).toBe('dlmm');
    expect(result.warnings?.length).toBeGreaterThan(0);
    expect(result.entryMarketData?.entry_tvl).toBe(50000);
    expect(result.entryMarketData?.entry_volume).toBe(500);
    expect(result.entryMarketData?.entry_mcap).toBe(1500000);
    expect(result.entryMarketData?.entry_holders).toBe(8000);
  });

  it('fails with a classified message when the pool is missing from both APIs', async () => {
    discoveryReturn = () => jsonResponse({ data: [] });
    dlmmReturn = () => new Response('Not Found', { status: 404 });
    stubFetch();

    const result = await _validateDeployPoolThresholds({ pool_address: dlmmPool.address });

    expect(result.pass).toBe(false);
    expect(result.reason).toContain('invalid or does not exist on Solana');
    expect(result.reason).toContain('not found in Pool Discovery API or DLMM API');
  });

  it('passes without warnings when the pool is fully indexed in the Pool Discovery API', async () => {
    discoveryReturn = () => jsonResponse({ data: [{ ...discoveryPool }] });
    dlmmReturn = () => jsonResponse(dlmmPool);
    stubFetch();

    const result = await _validateDeployPoolThresholds({ pool_address: discoveryPool.pool_address });

    expect(result.pass).toBe(true);
    expect(result.source).toBe('discovery');
    expect(result.warnings).toBeUndefined();
    expect(result.entryMarketData?.entry_tvl).toBe(50000);
    expect(result.entryMarketData?.entry_volume).toBe(2000);
  });

  it('rejects a pool whose TVL is below the configured minTvl', async () => {
    discoveryReturn = () => jsonResponse({ data: [{ ...discoveryPool, tvl: 5000 }] });
    dlmmReturn = () => jsonResponse(dlmmPool);
    stubFetch();

    const result = await _validateDeployPoolThresholds({ pool_address: discoveryPool.pool_address });

    expect(result.pass).toBe(false);
    expect(result.reason).toContain('below configured minTvl');
  });

  it('rejects a pool whose fee/active-TVL ratio is below the configured minimum (discovery source)', async () => {
    discoveryReturn = () => jsonResponse({ data: [{ ...discoveryPool, fee_active_tvl_ratio: 0.001 }] });
    dlmmReturn = () => jsonResponse(dlmmPool);
    stubFetch();

    const result = await _validateDeployPoolThresholds({ pool_address: discoveryPool.pool_address });

    expect(result.pass).toBe(false);
    expect(result.reason).toContain('below configured minFeeActiveTvlRatio');
  });
});
