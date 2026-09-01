import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendDecision, getDecisionSummary, getRecentDecisions, parseRejectedCandidates } from './decision-log.js'

describe('decision-log domain', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-log-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('parseRejectedCandidates', () => {
    it('parses bulleted candidates under REJECTED header', () => {
      const report = `
🚀 DEPLOYED

BONK/SOL
PoolAddress123

WHY THIS WON
Strong organic volume and high smart wallet presence.

REJECTED
- PEPE/SOL: high dev holding and PVP conflict
- WIF/SOL: low fee/active TVL ratio
- DOGE/SOL: weak narrative and bot concentration
`
      const rejected = parseRejectedCandidates(report)
      expect(rejected).toEqual([
        'PEPE/SOL: high dev holding and PVP conflict',
        'WIF/SOL: low fee/active TVL ratio',
        'DOGE/SOL: weak narrative and bot concentration',
      ])
    })

    it('parses numbered or bulleted list under ⛔ NO DEPLOY', () => {
      const report = `
⛔ NO DEPLOY

Cycle finished with no valid entry.

BEST LOOKING CANDIDATE
MOON/SOL

WHY SKIPPED
Only one surviving candidate but volume was insufficient.

REJECTED
1. MOON/SOL: volume below threshold
2. SUN/SOL: PVP hard filter
• STAR/SOL: bot holders exceeded limit
`
      const rejected = parseRejectedCandidates(report)
      expect(rejected).toEqual([
        'MOON/SOL: volume below threshold',
        'SUN/SOL: PVP hard filter',
        'STAR/SOL: bot holders exceeded limit',
      ])
    })

    it('returns empty array when REJECTED section is absent or empty', () => {
      expect(parseRejectedCandidates('')).toEqual([])
      expect(parseRejectedCandidates('Some random text without header')).toEqual([])
      expect(
        parseRejectedCandidates(`
REJECTED
<none>
`),
      ).toEqual([])
    })
  })

  describe('appendDecision & getRecentDecisions', () => {
    it('stores structured decision with extended reason and rejected list', () => {
      const longReason = 'A'.repeat(1200)
      const rejected = [
        'ALPHA/SOL: rejected due to high bot concentration (85%)',
        'BETA/SOL: rejected due to PVP symbol conflict',
      ]

      const decision = appendDecision({
        type: 'no_deploy',
        actor: 'SCREENER',
        summary: 'LLM chose no deploy',
        reason: longReason,
        rejected,
      })

      expect(decision.type).toBe('no_deploy')
      expect(decision.actor).toBe('SCREENER')
      expect(decision.reason?.length).toBe(1200)
      expect(decision.rejected).toEqual(rejected)

      const recent = getRecentDecisions(5)
      expect(recent.length).toBeGreaterThanOrEqual(1)
      expect(recent[0]?.id).toBe(decision.id)
      expect(recent[0]?.rejected).toEqual(rejected)
    })

    it('formats human-readable summary including rejected candidate rationale', () => {
      appendDecision({
        type: 'no_deploy',
        actor: 'SCREENER',
        pool_name: 'TEST/SOL',
        summary: 'Screening finished without deploy',
        reason: 'No pools met threshold',
        rejected: ['TOKEN_A: low volume', 'TOKEN_B: high bots'],
      })

      const summary = getDecisionSummary(1)
      expect(summary).toContain('[SCREENER] NO_DEPLOY TEST/SOL')
      expect(summary).toContain('rejected: TOKEN_A: low volume | TOKEN_B: high bots')
    })
  })
})
