import { describe, expect, it } from 'vitest'
import {
  computeStrategyDiff,
  decisionLabel,
  deriveLoopStage,
  extractCategories,
  extractLastTool,
  formatMetrics,
  isLoopActive,
  logSeverity,
  relativeTime,
  shortenAddress,
} from './agentViz'
import type { Decision, LogEntry } from './ipc'

function makeLog(category: string, message = 'test', ts = '2026-10-17T12:00:00.000Z'): LogEntry {
  return { category, message, agentId: 'agent-1', ts }
}

describe('agentViz', () => {
  describe('deriveLoopStage', () => {
    it('returns Idle for empty logs', () => {
      expect(deriveLoopStage([])).toBe('Idle')
    })

    it('returns Evaluating when loop has started', () => {
      const logs = [makeLog('agent_loop_start')]
      expect(deriveLoopStage(logs)).toBe('Evaluating')
    })

    it('returns Rebalancing during tool execution', () => {
      const logs = [makeLog('agent_loop_start'), makeLog('tool_start', 'tool swap_token')]
      expect(deriveLoopStage(logs)).toBe('Rebalancing')
    })

    it('returns Settled when agent loop ends', () => {
      const logs = [makeLog('agent_loop_start'), makeLog('tool_finish'), makeLog('agent_loop_end')]
      expect(deriveLoopStage(logs)).toBe('Settled')
    })

    it('returns Idle after an agent loop error', () => {
      const logs = [makeLog('agent_loop_start'), makeLog('agent_loop_error', 'RPC connection failed')]
      expect(deriveLoopStage(logs)).toBe('Idle')
    })

    it('scans backwards past unrelated log categories', () => {
      const logs = [makeLog('agent_loop_start'), makeLog('tool_start'), makeLog('telemetry_ping'), makeLog('heartbeat')]
      expect(deriveLoopStage(logs)).toBe('Rebalancing')
    })
  })

  describe('isLoopActive', () => {
    it('returns false for empty logs', () => {
      expect(isLoopActive([])).toBe(false)
    })

    it('returns true when loop iteration is in progress', () => {
      expect(isLoopActive([makeLog('agent_loop_start')])).toBe(true)
      expect(isLoopActive([makeLog('tool_start')])).toBe(true)
    })

    it('returns false when loop iteration has closed', () => {
      expect(isLoopActive([makeLog('agent_loop_start'), makeLog('agent_loop_end')])).toBe(false)
      expect(isLoopActive([makeLog('agent_loop_start'), makeLog('agent_loop_error')])).toBe(false)
    })
  })

  describe('logSeverity', () => {
    it('identifies error severity from categories and messages', () => {
      expect(logSeverity(makeLog('agent_loop_error', 'fatal'))).toBe('error')
      expect(logSeverity(makeLog('tool_blocked', 'insufficient balance'))).toBe('error')
      expect(logSeverity(makeLog('system', 'Transaction failed'))).toBe('error')
    })

    it('identifies warn severity', () => {
      expect(logSeverity(makeLog('anti_hallucination_reject', 'rejected hallucinated pool'))).toBe('warn')
      expect(logSeverity(makeLog('system', 'High slippage warning'))).toBe('warn')
    })

    it('defaults to info for regular logs', () => {
      expect(logSeverity(makeLog('agent_loop_start', 'Starting screening'))).toBe('info')
      expect(logSeverity(makeLog('screening', 'Discovered 12 pools'))).toBe('info')
    })
  })

  describe('shortenAddress', () => {
    it('handles null, undefined and empty strings', () => {
      expect(shortenAddress(null)).toBe('—')
      expect(shortenAddress(undefined)).toBe('—')
      expect(shortenAddress('')).toBe('—')
    })

    it('returns short strings unaltered', () => {
      expect(shortenAddress('SOL')).toBe('SOL')
    })

    it('shortens Solana base58 public keys', () => {
      const pubkey = 'So11111111111111111111111111111111111111112'
      expect(shortenAddress(pubkey, 4, 4)).toBe('So11…1112')
    })
  })

  describe('relativeTime', () => {
    it('returns dash for invalid or missing timestamps', () => {
      expect(relativeTime(null)).toBe('—')
      expect(relativeTime('invalid-time')).toBe('—')
    })

    it('formats relative durations', () => {
      const now = 1700000000000
      expect(relativeTime(new Date(now - 10_000).toISOString(), now)).toBe('just now')
      expect(relativeTime(new Date(now - 60_000).toISOString(), now)).toBe('1m ago')
      expect(relativeTime(new Date(now - 300_000).toISOString(), now)).toBe('5m ago')
      expect(relativeTime(new Date(now - 7_200_000).toISOString(), now)).toBe('2h ago')
      expect(relativeTime(new Date(now - 172_800_000).toISOString(), now)).toBe('2d ago')
    })
  })

  describe('decisionLabel', () => {
    it('formats decision label with actor and pool', () => {
      const d: Decision = {
        id: 'dec-1',
        ts: '2026-10-17T12:00:00Z',
        type: 'deploy',
        actor: 'sol-agent',
        pool: 'So11111111111111111111111111111111111111112',
        pool_name: 'SOL-USDC',
        position: 'pos-123',
        summary: 'Deploying liquidity',
        reason: 'High fee APR',
        risks: ['volatility'],
        metrics: { fee_tvl: 0.12 },
        rejected: [],
      }
      expect(decisionLabel(d)).toBe('[sol-agent] DEPLOY SOL-USDC')
    })
  })

  describe('formatMetrics', () => {
    it('formats numeric, boolean, and string metrics', () => {
      const metrics = { apr: 45.2, active: true, label: 'dlmm', complex: { nested: 1 } }
      const formatted = formatMetrics(metrics)
      expect(formatted).toContain('apr=45.2')
      expect(formatted).toContain('active=true')
      expect(formatted).toContain('label=dlmm')
      expect(formatted).not.toContain('complex=[object Object]')
    })

    it('returns empty array for invalid metrics', () => {
      expect(formatMetrics(undefined)).toEqual([])
      expect(formatMetrics(null as unknown as Record<string, unknown>)).toEqual([])
    })
  })

  describe('extractLastTool', () => {
    it('extracts the latest tool call and status from logs', () => {
      const logs = [
        makeLog('tool_start', 'tool deploy_position', '2026-10-17T12:01:00Z'),
        makeLog('tool_finish', 'tool deploy_position ok', '2026-10-17T12:01:05Z'),
      ]
      const last = extractLastTool(logs)
      expect(last).toEqual({
        name: 'deploy_position',
        timestamp: '2026-10-17T12:01:05Z',
        status: 'completed',
      })
    })

    it('returns null if no tool invocations are present', () => {
      expect(extractLastTool([makeLog('agent_loop_start')])).toBe(null)
    })
  })

  describe('extractCategories', () => {
    it('returns unique sorted categories', () => {
      const logs = [makeLog('tool_start'), makeLog('agent_loop_start'), makeLog('tool_start'), makeLog('swap')]
      expect(extractCategories(logs)).toEqual(['agent_loop_start', 'swap', 'tool_start'])
    })
  })

  describe('computeStrategyDiff', () => {
    it('detects added, removed, changed, and unchanged parameters', () => {
      const current = {
        minLiquidityUsd: 1000,
        stopLossPct: 15,
        rebalanceInterval: '10m',
      }
      const target = {
        minLiquidityUsd: 2500, // changed
        stopLossPct: 15, // unchanged
        takeProfitPct: 30, // added
        // rebalanceInterval removed
      }

      const diff = computeStrategyDiff(current, target)
      expect(diff).toEqual([
        { key: 'minLiquidityUsd', from: 1000, to: 2500, status: 'changed' },
        { key: 'rebalanceInterval', from: '10m', to: undefined, status: 'removed' },
        { key: 'stopLossPct', from: 15, to: 15, status: 'unchanged' },
        { key: 'takeProfitPct', from: undefined, to: 30, status: 'added' },
      ])
    })
  })
})
