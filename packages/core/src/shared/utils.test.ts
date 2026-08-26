import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveEnvString, resolveEnvVars, safeNumber, clamp, avg, percentile, nudge } from './utils.js';

describe('resolveEnvString and resolveEnvVars', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('resolves string starting with env. to process.env value', () => {
    process.env.TEST_VAR = 'hello_world';
    expect(resolveEnvString('env.TEST_VAR')).toBe('hello_world');
  });

  it('returns null if env var is missing or empty', () => {
    delete process.env.MISSING_VAR;
    expect(resolveEnvString('env.MISSING_VAR')).toBeNull();

    process.env.EMPTY_VAR = '   ';
    expect(resolveEnvString('env.EMPTY_VAR')).toBeNull();
  });

  it('leaves regular strings unchanged', () => {
    expect(resolveEnvString('regular_value')).toBe('regular_value');
    expect(resolveEnvString('https://pump.helius-rpc.com')).toBe('https://pump.helius-rpc.com');
  });

  it('recursively resolves nested objects and arrays', () => {
    process.env.RPC_URL = 'https://custom.rpc';
    process.env.API_KEY = 'secret_key';

    const input = {
      connection: {
        rpcUrl: 'env.RPC_URL',
        missing: 'env.UNSET_KEY',
        staticVal: 'unchanged',
      },
      tokens: ['env.API_KEY', 'plain_item'],
      count: 42,
    };

    const output = resolveEnvVars(input);

    expect(output).toEqual({
      connection: {
        rpcUrl: 'https://custom.rpc',
        missing: null,
        staticVal: 'unchanged',
      },
      tokens: ['secret_key', 'plain_item'],
      count: 42,
    });
  });
});

describe('math and string utilities', () => {
  it('safeNumber handles fallbacks', () => {
    expect(safeNumber(10)).toBe(10);
    expect(safeNumber('20')).toBe(20);
    expect(safeNumber('invalid', 5)).toBe(5);
    expect(safeNumber(null, 0)).toBe(0);
  });

  it('clamp restricts values to bounds', () => {
    expect(clamp(5, 10, 20)).toBe(10);
    expect(clamp(15, 10, 20)).toBe(15);
    expect(clamp(25, 10, 20)).toBe(20);
  });

  it('avg computes array average', () => {
    expect(avg([])).toBe(0);
    expect(avg([10, 20, 30])).toBe(20);
  });

  it('nudge adjusts values towards target with limit', () => {
    expect(nudge(100, 150, 0.1)).toBe(110);
    expect(nudge(100, 105, 0.1)).toBe(105);
  });
});
