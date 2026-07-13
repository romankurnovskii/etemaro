import { randomUUID } from 'crypto';
import { setDefaultResultOrder } from 'dns';
import { config } from '../../config/Config.js';
import { log } from '../../shared/logger.js';

// Force IPv4 — GMGN OpenAPI does not support IPv6
setDefaultResultOrder('ipv4first');

let lastGmgnRequestAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function paceGmgnRequest(): Promise<void> {
  const delayMs = Math.max(0, Number(config.gmgn?.requestDelayMs ?? 2500));
  if (!delayMs) return;
  const elapsed = Date.now() - lastGmgnRequestAt;
  if (elapsed < delayMs) await sleep(delayMs - elapsed);
  lastGmgnRequestAt = Date.now();
}

function getApiKey(): string {
  const key = config.gmgn?.apiKey || process.env.GMGN_API_KEY;
  if (!key) throw new Error('GMGN_API_KEY is required for the GMGN fee source.');
  return key;
}

export function hasGmgnApiKey(): boolean {
  return !!(config.gmgn?.apiKey || process.env.GMGN_API_KEY);
}

function appendParams(url: URL, params: Record<string, unknown> = {}): void {
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const entry of value.filter((item) => item != null && item !== '')) {
        url.searchParams.append(key, String(entry));
      }
    } else {
      url.searchParams.set(key, String(value));
    }
  }
}

async function gmgnFetch(
  pathname: string,
  {
    method = 'GET',
    params = {},
    body = null,
  }: {
    method?: string;
    params?: Record<string, unknown>;
    body?: unknown;
  } = {},
): Promise<Record<string, unknown>> {
  const baseUrl = String(config.gmgn?.baseUrl || 'https://openapi.gmgn.ai').replace(/\/+$/, '');
  const url = new URL(`${baseUrl}${pathname}`);
  appendParams(url, {
    ...params,
    timestamp: Math.floor(Date.now() / 1000),
    client_id: randomUUID(),
  });

  const maxRetries = Math.max(0, Number(config.gmgn?.maxRetries ?? 2));
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await paceGmgnRequest();
    const res = await fetch(url, {
      method,
      headers: {
        'X-APIKEY': getApiKey(),
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : null,
    });
    const text = await res.text().catch(() => '');
    let payload: Record<string, unknown> = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    const message = (payload?.message as string) || (payload?.error as string) || (payload?.raw as string) || `GMGN ${pathname} ${res.status}`;
    const rateLimited = res.status === 429 || /rate limit|temporarily banned/i.test(String(message));
    if (res.ok) return payload;
    if (rateLimited && attempt < maxRetries) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const backoffMs = Number.isFinite(retryAfter)
        ? retryAfter * 1000
        : /temporarily banned/i.test(String(message))
          ? 60000
          : Math.min(30000, 3000 * Math.pow(2, attempt));
      await sleep(backoffMs);
      continue;
    }
    throw new Error(message);
  }
  throw new Error(`GMGN ${pathname} failed`);
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ─── Token fees (SOL) for the minTokenFeesSol gate ──────────────
// Returns { total_fee, trade_fee } in SOL, or null on missing key / error
// so callers can fall back to Jupiter's fee figure.
export async function getGmgnTokenFees(mint: string): Promise<{ total_fee: number | null; trade_fee: number | null } | null> {
  if (!mint || !hasGmgnApiKey()) return null;
  try {
    const payload = await gmgnFetch('/v1/token/info', {
      params: { chain: 'sol', address: mint },
    });
    const info = (payload?.data as Record<string, unknown>)?.data || payload?.data || payload;
    if (!info || typeof info !== 'object') return null;
    const record = info as Record<string, unknown>;
    return {
      total_fee: num(record.total_fee),
      trade_fee: num(record.trade_fee),
    };
  } catch (error) {
    log('gmgn', `token fees lookup failed for ${String(mint).slice(0, 8)}: ${(error as Error).message}`);
    return null;
  }
}
