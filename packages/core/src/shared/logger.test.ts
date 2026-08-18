import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { log } from './logger.js';

describe('logger', () => {
  const originalDryRun = process.env.DRY_RUN;
  let stdoutSpy: any;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    if (originalDryRun === undefined) {
      delete process.env.DRY_RUN;
    } else {
      process.env.DRY_RUN = originalDryRun;
    }
  });

  it('formats log lines without [DRY RUN] when DRY_RUN is false', () => {
    process.env.DRY_RUN = 'false';
    log('info', 'Test message live');
    expect(stdoutSpy).toHaveBeenCalled();
    const output = stdoutSpy.mock.calls[0][0];
    expect(output).toContain('[info]');
    expect(output).toContain('Test message live');
    expect(output).not.toContain('[DRY RUN]');
  });

  it('injects [DRY RUN] tag into log lines when DRY_RUN is true', () => {
    process.env.DRY_RUN = 'true';
    log('info', 'Test message dry run');
    expect(stdoutSpy).toHaveBeenCalled();
    const output = stdoutSpy.mock.calls[0][0];
    expect(output).toContain('[info]');
    expect(output).toContain('[DRY RUN]');
    expect(output).toContain('Test message dry run');
  });
});
