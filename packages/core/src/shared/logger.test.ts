import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';

// Spy on fs.appendFileSync before importing logger so the mock intercepts file writes.
// vi.spyOn mutates the fs object in-place, so any module that imported fs shares the same spy.
const appendSpy = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => undefined as any);

// Import logger after spy is set up
const { log, logStructured, logAction, redactSensitive, createCorrelationId, setCorrelationId, getCorrelationId, createTimer } =
  await import('./logger.js');

describe('logger', () => {
  const originalDryRun = process.env.DRY_RUN;
  let stdoutSpy: any;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as any);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    if (originalDryRun === undefined) {
      delete process.env.DRY_RUN;
    } else {
      process.env.DRY_RUN = originalDryRun;
    }
    setCorrelationId(null);
    appendSpy.mockClear();
  });

  it('formats log lines without [DRY RUN] when DRY_RUN is false', () => {
    process.env.DRY_RUN = 'false';
    log('info', 'Test message live');
    expect(stdoutSpy).toHaveBeenCalled();
    const output = stdoutSpy.mock.calls[0][0] as string;
    expect(output).toContain('[info]');
    expect(output).toContain('Test message live');
    expect(output).not.toContain('[DRY RUN]');
  });

  it('injects [DRY RUN] tag into log lines when DRY_RUN is true', () => {
    process.env.DRY_RUN = 'true';
    log('info', 'Test message dry run');
    expect(stdoutSpy).toHaveBeenCalled();
    const output = stdoutSpy.mock.calls[0][0] as string;
    expect(output).toContain('[info]');
    expect(output).toContain('[DRY RUN]');
    expect(output).toContain('Test message dry run');
  });
});

describe('redactSensitive', () => {
  it('redacts long base58 strings (Solana private keys)', () => {
    // Valid base58: chars 1-9, A-H, J-N, P-Z, a-k, m-z (no 0, I, O, l)
    // 88 chars minimum (Ed25519 private keys encode to 88 base58 chars)
    const key = '4rQHpCGMGVBdFjhVbfqMVz3BJ3X2d9cWm1V3Vkz8R1a2b3c4d5e6f7g8h9jPkPqRsTuVwXyZabCDefGhiJkLmnoP';
    expect(key.length).toBeGreaterThanOrEqual(88);
    // Verify no invalid base58 chars
    expect(key).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    const result = redactSensitive(`Private key: ${key}`);
    expect(result).not.toContain(key);
    expect(result).toContain('[REDACTED]');
  });

  it('redacts api-key= patterns in URLs', () => {
    const url = 'https://api.helius.xyz/v1/wallet/abc/balances?api-key=sk_test_abc123def456ghi789';
    const result = redactSensitive(url);
    expect(result).not.toContain('sk_test_abc123def456ghi789');
    expect(result).toContain('[REDACTED]');
  });

  it('redacts generic key= patterns in URLs', () => {
    const url = 'https://api.example.com/v1?apikey=abcdefghijklmnop1234';
    const result = redactSensitive(url);
    expect(result).not.toContain('abcdefghijklmnop1234');
  });

  it('does not redact short strings', () => {
    const result = redactSensitive('Pool: ABC123');
    expect(result).toBe('Pool: ABC123');
  });

  it('does not redact empty strings', () => {
    expect(redactSensitive('')).toBe('');
  });

  it('redacts multiple patterns in one string', () => {
    // Both values need 20+ chars for the api-key= pattern
    const input = 'api-key=abcdefghijklmnopqrstuvwxyz1234 secret=ABCDEFGHIJKLMNOPQRSTUVWXYZ1234';
    const result = redactSensitive(input);
    expect(result).not.toContain('abcdefghijklmnopqrstuvwxyz1234');
    expect(result).not.toContain('ABCDEFGHIJKLMNOPQRSTUVWXYZ1234');
  });
});

describe('correlationId', () => {
  it('creates a 12-character correlation ID', () => {
    const id = createCorrelationId();
    expect(id).toHaveLength(12);
    expect(typeof id).toBe('string');
  });

  it('creates unique IDs on each call', () => {
    const id1 = createCorrelationId();
    const id2 = createCorrelationId();
    expect(id1).not.toBe(id2);
  });

  it('sets and gets correlation ID', () => {
    setCorrelationId('test-id-123');
    expect(getCorrelationId()).toBe('test-id-123');
  });

  it('clears correlation ID with null', () => {
    setCorrelationId('test-id');
    setCorrelationId(null);
    expect(getCorrelationId()).toBeNull();
  });

  it('logStructured includes correlation ID when set', () => {
    setCorrelationId('abc123');
    logStructured({ category: 'test', message: 'test message' });
    expect(fs.appendFileSync).toHaveBeenCalled();
    const call = vi.mocked(fs.appendFileSync).mock.calls.find((c: any) => String(c[0]).includes('structured'));
    if (call) {
      const record = JSON.parse(call[1] as string);
      expect(record.correlationId).toBe('abc123');
    }
  });
});

describe('createTimer', () => {
  it('returns elapsed_ms that increases over time', async () => {
    const timer = createTimer();
    expect(timer.elapsed_ms).toBeGreaterThanOrEqual(0);
    await new Promise((r) => setTimeout(r, 25));
    expect(timer.elapsed_ms).toBeGreaterThanOrEqual(10);
  });

  it('stop() returns final elapsed time and freezes it', async () => {
    const timer = createTimer();
    await new Promise((r) => setTimeout(r, 25));
    const stopped = timer.stop();
    expect(stopped).toBeGreaterThanOrEqual(10);
    // After stop, elapsed_ms should not change
    const afterStop = timer.elapsed_ms;
    expect(afterStop).toBe(stopped);
  });

  it('stop() is idempotent', async () => {
    const timer = createTimer();
    await new Promise((r) => setTimeout(r, 5));
    const first = timer.stop();
    const second = timer.stop();
    expect(first).toBe(second);
  });
});

describe('logStructured', () => {
  beforeEach(() => {
    vi.mocked(fs.appendFileSync).mockClear();
  });

  it('writes a valid JSONL record with required fields', () => {
    logStructured({ category: 'test_event', message: 'Hello structured' });
    expect(fs.appendFileSync).toHaveBeenCalled();
    const call = vi.mocked(fs.appendFileSync).mock.calls.find((c: any) => String(c[0]).includes('structured'));
    expect(call).toBeDefined();
    const record = JSON.parse(call![1] as string);
    expect(record.ts).toBeDefined();
    expect(record.category).toBe('test_event');
    expect(record.message).toBe('Hello structured');
    expect(record.agentId).toBeDefined();
    expect(typeof record.dryRun).toBe('boolean');
  });

  it('includes metadata when provided', () => {
    logStructured({ category: 'test', message: 'with meta', metadata: { pool: 'abc123', amount: 1.5 } });
    const call = vi.mocked(fs.appendFileSync).mock.calls.find((c: any) => String(c[0]).includes('structured'));
    const record = JSON.parse(call![1] as string);
    expect(record.metadata.pool).toBe('abc123');
    expect(record.metadata.amount).toBe(1.5);
  });

  it('redacts sensitive data in message and metadata', () => {
    logStructured({
      category: 'test',
      message: 'Key: api-key=sk_test_abcdefghijklmnopqrstuvwxyz1234',
      metadata: { url: 'https://api.example.com?apikey=abcdefghijklmnop1234' },
    });
    const call = vi.mocked(fs.appendFileSync).mock.calls.find((c: any) => String(c[0]).includes('structured'));
    const record = JSON.parse(call![1] as string);
    expect(record.message).not.toContain('sk_test_abcdefghijklmnopqrstuvwxyz1234');
    expect(record.metadata.url).not.toContain('abcdefghijklmnop1234');
  });

  it('omits metadata key when empty', () => {
    logStructured({ category: 'test', message: 'no meta' });
    const call = vi.mocked(fs.appendFileSync).mock.calls.find((c: any) => String(c[0]).includes('structured'));
    const record = JSON.parse(call![1] as string);
    expect(record.metadata).toBeUndefined();
  });
});

describe('logAction', () => {
  beforeEach(() => {
    vi.mocked(fs.appendFileSync).mockClear();
  });

  it('includes correlation ID when set', () => {
    setCorrelationId('trace-456');
    logAction({ tool: 'test_tool', success: true });
    const call = vi.mocked(fs.appendFileSync).mock.calls.find((c: any) => String(c[0]).includes('actions'));
    const record = JSON.parse(call![1] as string);
    expect(record.correlationId).toBe('trace-456');
    expect(record.tool).toBe('test_tool');
    expect(record.success).toBe(true);
  });

  it('redacts sensitive data in error field', () => {
    logAction({ tool: 'test', error: 'Failed: api-key=sk_testabcdefghijklmnop1234' });
    const call = vi.mocked(fs.appendFileSync).mock.calls.find((c: any) => String(c[0]).includes('actions'));
    const record = JSON.parse(call![1] as string);
    expect(record.error).not.toContain('sk_testabcdefghijklmnop1234');
    expect(record.error).toContain('[REDACTED]');
  });
});
