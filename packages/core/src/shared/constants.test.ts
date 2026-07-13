/**
 * @file constants.test.ts
 * @description Verifies repo root detection and config path resolution produce paths outside the package directory.
 *
 * @features
 * - Confirms REPO_ROOT contains pnpm-workspace.yaml
 * - Asserts configPath('user-config.json') resolves to <root>/config and not packages/core/config
 *
 * @dependencies vitest
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, configPath } from './constants.js';

describe('REPO_ROOT resolves to the pnpm workspace root', () => {
  it('points at the directory containing pnpm-workspace.yaml', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'pnpm-workspace.yaml'))).toBe(true);
  });

  it('configPath resolves to <root>/config, not packages/core/config', () => {
    expect(configPath('user-config.json')).toBe(path.join(REPO_ROOT, 'config', 'user-config.json'));
    expect(configPath('user-config.json')).not.toContain('packages/core/config');
  });
});
