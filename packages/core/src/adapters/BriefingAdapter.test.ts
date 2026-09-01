import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Redirect dataPath() to a temp dir so the briefing never reads real data/ files.
// The async factory creates the dir at import time (after hoisting), and exposes
// it via __testDataDir so tests can write fixture files there.
vi.mock('../shared/constants.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/constants.js')>()
  const nodeFs = await import('node:fs')
  const nodeOs = await import('node:os')
  const nodePath = await import('node:path')
  const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'briefing-test-'))
  return {
    ...actual,
    dataPath: (...segments: string[]) => nodePath.join(dir, ...segments),
    __testDataDir: dir,
  }
})

import { generateBriefing } from './BriefingAdapter.js'

type MockedConstants = typeof import('../shared/constants.js') & { __testDataDir: string }
const constants = (await import('../shared/constants.js')) as MockedConstants
const tmpDir = constants.__testDataDir

function writeData(state: unknown, lessons: unknown): void {
  fs.writeFileSync(path.join(tmpDir, 'state.json'), JSON.stringify(state))
  fs.writeFileSync(path.join(tmpDir, 'lessons.json'), JSON.stringify(lessons))
}

describe('generateBriefing', () => {
  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('renders lesson rules containing "<" (e.g. stop-loss "PnL <= -5%") as plain text', async () => {
    const now = new Date()
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
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
    )

    const briefing = await generateBriefing()

    // The offending rule must appear verbatim — no HTML parse-breaking, no mangling.
    expect(briefing).toContain('Stop loss: PnL -6.83% <= -5%.')
    // Briefing must be plain text: no HTML tags at all.
    expect(briefing).not.toMatch(/<[^>]+>/)
  })

  it('renders a briefing without lessons and without performance', async () => {
    writeData({ positions: {} }, { lessons: [], performance: [] })

    const briefing = await generateBriefing()

    expect(briefing).toContain('Daily Briefing')
    expect(briefing).toContain('No new lessons recorded overnight.')
    expect(briefing).toContain('Open Positions: 0')
    expect(briefing).not.toMatch(/<[^>]+>/)
  })

  it('renders PnL and fees with SOL conversion when solPrice is provided', async () => {
    const now = new Date()
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
    writeData(
      { positions: {} },
      {
        lessons: [],
        performance: [
          {
            position: 'pos1',
            pool: 'pool1',
            pool_name: 'TEST-SOL',
            strategy: 'classic',
            bin_range: 20,
            bin_step: 10,
            volatility: 0.1,
            fee_tvl_ratio: 0.05,
            organic_score: 80,
            amount_sol: 1.0,
            initial_value_usd: 150,
            final_value_usd: 165,
            fees_earned_usd: 5.0,
            minutes_in_range: 30,
            minutes_held: 30,
            close_reason: 'manual',
            pnl_usd: 20.0,
            pnl_pct: 13.33,
            recorded_at: hourAgo,
          },
        ],
      },
    )

    const briefing = await generateBriefing({ solPrice: 150 })

    expect(briefing).toContain('Daily Briefing')
    expect(briefing).toContain('💰 Net PnL: +$20.00 (+0.133 SOL)')
    expect(briefing).toContain('💎 Fees Earned: $5.00 (+0.033 SOL)')
    expect(briefing).toContain('📊 All-time PnL: $20.00 (+0.133 SOL)')
  })
})
