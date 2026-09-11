import { describe, expect, it } from 'vitest'
import type { ConfigPort } from '../ports/config.js'
import { buildSystemPrompt } from './prompt-builder.js'

function stubConfig(overrides: { timeframe?: string; minTokenFeesSol?: number } = {}): ConfigPort {
  return {
    screening: {
      timeframe: overrides.timeframe ?? '24h',
      minTokenFeesSol: overrides.minTokenFeesSol ?? 30,
      maxBotHoldersPct: 30,
    },
    management: { minFeePerTvl24h: 7 },
    strategy: { minBinsBelow: 0, maxBinsBelow: 0 },
  } as unknown as ConfigPort
}

const portfolio = { sol: 1, usd: 1, tokens: [] } as unknown as Parameters<typeof buildSystemPrompt>[2]
const positions = { positions: [], total_positions: 0 }

describe('buildSystemPrompt config injection', () => {
  it('renders injected screening config for the GENERAL role', () => {
    const prompt = buildSystemPrompt(
      stubConfig({ timeframe: '9h' }),
      'GENERAL',
      portfolio,
      positions,
      null,
      null,
      null,
      null,
      null,
    )
    expect(prompt).toContain('Current screening timeframe: 9h')
  })

  it('renders injected thresholds for SCREENER', () => {
    const prompt = buildSystemPrompt(
      stubConfig({ minTokenFeesSol: 12345 }),
      'SCREENER',
      portfolio,
      positions,
      null,
      null,
      null,
      null,
      null,
    )
    expect(prompt).toContain('fees_sol < 12345')
  })

  it('renders injected management config for MANAGER', () => {
    const prompt = buildSystemPrompt(stubConfig(), 'MANAGER', portfolio, positions, null, null, null, null, null)
    expect(prompt).toContain('{"minFeePerTvl24h":7}')
  })
})
