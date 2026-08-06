import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Redirect dataPath() to a temp dir so the briefing never reads real data/ files.
// The async factory creates the dir at import time (after hoisting), and exposes
// it via __testDataDir so tests can write fixture files there.
vi.mock('../shared/constants.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/constants.js')>();
  const nodeFs = await import('node:fs');
  const nodeOs = await import('node:os');
  const nodePath = await import('node:path');
  const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'briefing-test-'));
  return {
    ...actual,
    dataPath: (...segments: string[]) => nodePath.join(dir, ...segments),
    __testDataDir: dir,
  };
});

import { generateBriefing } from './BriefingAdapter.js';

type MockedConstants = typeof import('../shared/constants.js') & { __testDataDir: string };
const constants = (await import('../shared/constants.js')) as MockedConstants;
const tmpDir = constants.__testDataDir;

function writeData(state: unknown, lessons: unknown): void {
  fs.writeFileSync(path.join(tmpDir, 'state.json'), JSON.stringify(state));
  fs.writeFileSync(path.join(tmpDir, 'lessons.json'), JSON.stringify(lessons));
}

describe('generateBriefing', () => {
  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('renders lesson rules containing "<" (e.g. stop-loss "PnL <= -5%") as plain text', async () => {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    writeData(
      { positions: {} },
      {
        lessons: [
          {
            id: 1,
            rule: 'FAILED: CLANKER-SOL → PnL -5.64%. Reason: Stop loss: PnL -6.83% <= -5%.',
            tags: ['failed'],
            outcome: 'bad',
            created_at: hourAgo,
          },
        ],
        performance: [],
      },
    );

    const briefing = await generateBriefing();

    // The offending rule must appear verbatim — no HTML parse-breaking, no mangling.
    expect(briefing).toContain('Stop loss: PnL -6.83% <= -5%.');
    // Briefing must be plain text: no HTML tags at all.
    expect(briefing).not.toMatch(/<[^>]+>/);
  });

  it('renders a briefing without lessons and without performance', async () => {
    writeData({ positions: {} }, { lessons: [], performance: [] });

    const briefing = await generateBriefing();

    expect(briefing).toContain('Morning Briefing');
    expect(briefing).toContain('No new lessons recorded overnight.');
    expect(briefing).toContain('Open Positions: 0');
    expect(briefing).not.toMatch(/<[^>]+>/);
  });
});
