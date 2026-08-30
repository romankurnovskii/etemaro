import { describe, it, expect } from 'vitest';
import { applyCliRuntimeFlags, resolveGlobalFlagValue } from './Cli.js';

describe('resolveGlobalFlagValue', () => {
  it('returns the value following the long flag', () => {
    expect(resolveGlobalFlagValue(['--config', '/tmp/cfg.json'], '--config')).toBe('/tmp/cfg.json');
  });

  it('returns the value following an alias', () => {
    expect(resolveGlobalFlagValue(['-c', '/tmp/cfg.json'], '--config', '-c')).toBe('/tmp/cfg.json');
  });

  it('returns undefined when the flag is absent', () => {
    expect(resolveGlobalFlagValue(['balance', '--portal'], '--config', '-c')).toBeUndefined();
  });

  it('returns undefined when the flag has no following value', () => {
    expect(resolveGlobalFlagValue(['balance', '--config'], '--config')).toBeUndefined();
  });

  it('returns undefined when the following token is another flag', () => {
    expect(resolveGlobalFlagValue(['balance', '--config', '--dry-run'], '--config')).toBeUndefined();
  });

  it('extends forward to find the value past the subcommand', () => {
    expect(resolveGlobalFlagValue(['balance', '--data-dir', '/tmp/d'], '--data-dir', '-d')).toBe('/tmp/d');
  });
});

describe('applyCliRuntimeFlags', () => {
  it('sets DRY_RUN when --dry-run is present', () => {
    const env: Record<string, string | undefined> = {};
    applyCliRuntimeFlags({ 'dry-run': true }, env);
    expect(env.DRY_RUN).toBe('true');
  });

  it('does not set DRY_RUN when the flag is absent', () => {
    const env: Record<string, string | undefined> = { DRY_RUN: 'false' };
    applyCliRuntimeFlags({}, env);
    expect(env.DRY_RUN).toBe('false');
  });
});
