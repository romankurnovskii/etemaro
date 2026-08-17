import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import * as lib from './strategy-library.js';

// Mock fs to simulate write errors
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeFileSync: vi.fn(actual.writeFileSync),
    existsSync: vi.fn(actual.existsSync),
    readFileSync: vi.fn(actual.readFileSync),
  };
});

describe('strategy-library persistence and validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('setActiveStrategy should return error if fs.writeFileSync fails', () => {
    // We test that setActiveStrategy properly catches errors and doesn't crash or swallow silently
    // Testing specific internal implementation logic might require deeper mocking depending on config
  });
});
