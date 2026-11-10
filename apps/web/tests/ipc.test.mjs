import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentEndpoint, logSeverity, loopStage, strategyDiff } from '../src/lib/ipc.ts'

const snapshot = (busy, positions = []) => ({ busy, positions, totalPnlUsd: 0 })
const log = (category, metadata = {}) => ({ category, metadata, agentId: 'a', ts: '2026-10-22T12:00:00Z', message: 'event' })

test('unknown telemetry never implies an idle or settled loop', () => assert.equal(loopStage(null, []), null))
test('idle requires an actual non-busy empty snapshot', () => assert.equal(loopStage(snapshot(false), []), 'Idle'))
test('non-busy positions represent a settled allocation', () => assert.equal(loopStage(snapshot(false, [{}]), []), 'Settled'))
test('busy without a write tool is evaluating', () => assert.equal(loopStage(snapshot(true), []), 'Evaluating'))
test('read-only tool invocation never implies rebalancing', () => assert.equal(loopStage(snapshot(true), [log('tool_start', { tool: 'get_my_positions' })]), 'Evaluating'))
test('an active allocation write implies rebalancing', () => assert.equal(loopStage(snapshot(true), [log('tool_start', { tool: 'deploy_position' })]), 'Rebalancing'))
test('a completed write does not leave the loop stuck rebalancing', () => assert.equal(loopStage(snapshot(true), [log('tool_start', { tool: 'deploy_position' }), log('tool_finish', { tool: 'deploy_position' })]), 'Evaluating'))
test('a blocked write does not imply an executed rebalance', () => assert.equal(loopStage(snapshot(true), [log('tool_start', { tool: 'swap_token' }), log('tool_blocked', { tool: 'swap_token' })]), 'Evaluating'))
test('a later read supersedes an earlier write event', () => assert.equal(loopStage(snapshot(true), [log('tool_start', { tool: 'deploy_position' }), log('tool_start', { tool: 'get_my_positions' })]), 'Evaluating'))
test('severity recognizes existing daemon error categories', () => assert.equal(logSeverity(log('rpc_error')), 'error'))
test('severity recognizes warning and blocked tool categories', () => { assert.equal(logSeverity(log('ipc_warn')), 'warn'); assert.equal(logSeverity(log('tool_blocked')), 'warn') })
test('explicit structured severity takes precedence over category', () => assert.equal(logSeverity(log('rpc_error', { level: 'info' })), 'info'))
test('normal structured tool events are informational', () => assert.equal(logSeverity(log('tool_finish')), 'info'))
test('strategy diff reports nested changed, removed and added values', () => {
  assert.deepEqual(strategyDiff({ risk: { max: 4, stop: 8 }, removed: true }, { risk: { max: 2, stop: 8 }, added: ['SOL'] }), [
    { path: 'added', before: undefined, after: ['SOL'] }, { path: 'removed', before: true, after: undefined }, { path: 'risk.max', before: 4, after: 2 },
  ])
})
test('strategy diff ignores only the transient active marker', () => assert.deepEqual(strategyDiff({ id: 'a', is_active: true }, { id: 'a', is_active: false }), []))
test('unchanged strategy fields produce no diff', () => assert.deepEqual(strategyDiff({ risk: { max: 4 } }, { risk: { max: 4 } }), []))
test('object key ordering does not produce false changes', () => assert.deepEqual(strategyDiff({ a: 1, b: 2 }, { b: 2, a: 1 }), []))
test('arrays are compared as values including order', () => assert.deepEqual(strategyDiff({ pairs: ['SOL', 'USDC'] }, { pairs: ['USDC', 'SOL'] }), [{ path: 'pairs', before: ['SOL', 'USDC'], after: ['USDC', 'SOL'] }]))
test('strategy preview preserves meaningful null and false values', () => assert.deepEqual(strategyDiff({ value: null }, { value: false }), [{ path: 'value', before: null, after: false }]))
test('agent endpoint changes only port on the configured daemon host', () => assert.equal(agentEndpoint('https://daemon.example:8765', 8766), 'https://daemon.example:8766'))
test('agent endpoint supports loopback IPv6', () => assert.equal(agentEndpoint('http://[::1]:8765', 8767), 'http://[::1]:8767'))
test('agent endpoint rejects missing, non-integral and invalid ports', () => {
  for (const port of [undefined, null, '8766', 0, -1, 1.5, 65536, NaN, Infinity, 'https://attacker.example']) assert.throws(() => agentEndpoint('http://127.0.0.1:8765', port))
})
