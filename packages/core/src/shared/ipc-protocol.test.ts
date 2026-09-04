/**
 * @file ipc-protocol.test.ts
 * @description Tests for IPC protocol type shapes and enum completeness.
 */

import { describe, expect, it } from 'vitest'
import {
  type IpcAckPayload,
  type IpcCommandActionPayload,
  type IpcCommandChatPayload,
  type IpcErrorPayload,
  type IpcLogEntry,
  type IpcMessage,
  IpcMessageType,
  type IpcPositionSummary,
  type IpcStateSnapshot,
} from './ipc-protocol.js'

describe('IpcMessageType enum', () => {
  it('has all required client→daemon message types', () => {
    expect(IpcMessageType.SUBSCRIBE_LOGS).toBe('subscribe:logs')
    expect(IpcMessageType.SUBSCRIBE_STATE).toBe('subscribe:state')
    expect(IpcMessageType.COMMAND_CHAT).toBe('command:chat')
    expect(IpcMessageType.COMMAND_ACTION).toBe('command:action')
    expect(IpcMessageType.AUTH).toBe('auth')
  })

  it('has all required daemon→client message types', () => {
    expect(IpcMessageType.LOG_ENTRY).toBe('log:entry')
    expect(IpcMessageType.STATE_SNAPSHOT).toBe('state:snapshot')
    expect(IpcMessageType.ACK).toBe('ack')
    expect(IpcMessageType.ERROR).toBe('error')
  })

  it('has no duplicate enum values', () => {
    const values = Object.values(IpcMessageType)
    const unique = new Set(values)
    expect(unique.size).toBe(values.length)
  })
})

describe('IpcMessage envelope', () => {
  it('round-trips through JSON serialisation', () => {
    const msg: IpcMessage<IpcCommandChatPayload> = {
      id: 'test-id-001',
      type: IpcMessageType.COMMAND_CHAT,
      payload: { prompt: 'Hello agent' },
      timestamp: 1000000,
    }
    const roundTripped = JSON.parse(JSON.stringify(msg)) as IpcMessage<IpcCommandChatPayload>
    expect(roundTripped.id).toBe(msg.id)
    expect(roundTripped.type).toBe(msg.type)
    expect(roundTripped.payload.prompt).toBe(msg.payload.prompt)
    expect(roundTripped.timestamp).toBe(msg.timestamp)
  })

  it('accepts a LOG_ENTRY payload shape', () => {
    const entry: IpcLogEntry = {
      category: 'tool_start',
      message: 'Starting screen cycle',
      agentId: 'agent-default',
      ts: new Date().toISOString(),
      metadata: { pool: 'ABC123' },
    }
    const msg: IpcMessage<IpcLogEntry> = {
      id: 'log-001',
      type: IpcMessageType.LOG_ENTRY,
      payload: entry,
      timestamp: Date.now(),
    }
    expect(msg.payload.category).toBe('tool_start')
    expect(msg.payload.agentId).toBe('agent-default')
  })
})

describe('IpcLogEntry', () => {
  it('has fields consistent with StructuredLogEntry + runtime envelope', () => {
    const entry: IpcLogEntry = {
      category: 'test_category',
      message: 'test message',
      agentId: 'agent-test',
      ts: '2026-09-04T00:00:00Z',
    }
    // These are the mandatory fields — metadata is optional
    expect(entry.category).toBeDefined()
    expect(entry.message).toBeDefined()
    expect(entry.agentId).toBeDefined()
    expect(entry.ts).toBeDefined()
    expect(entry.metadata).toBeUndefined()
  })
})

describe('IpcStateSnapshot', () => {
  it('accepts minimal snapshot with empty positions', () => {
    const snap: IpcStateSnapshot = {
      positions: [],
      totalPnlUsd: 0,
      busy: false,
    }
    expect(snap.positions).toHaveLength(0)
    expect(snap.totalPnlUsd).toBe(0)
    expect(snap.busy).toBe(false)
  })

  it('accepts full snapshot with positions and schedule', () => {
    const pos: IpcPositionSummary = {
      positionAddress: 'pos123',
      poolAddress: 'pool456',
      tokenSymbol: 'SOL-USDC',
      pnlUsd: 12.5,
      pnlPct: 0.5,
      deployedAt: '2026-09-04T10:00:00Z',
    }
    const snap: IpcStateSnapshot = {
      positions: [pos],
      totalPnlUsd: 12.5,
      busy: true,
      nextScreenAt: '2026-09-04T10:30:00Z',
      nextManageAt: '2026-09-04T10:10:00Z',
    }
    expect(snap.positions).toHaveLength(1)
    // biome-ignore lint/style/noNonNullAssertion: length checked above
    expect(snap.positions[0]!.tokenSymbol).toBe('SOL-USDC')
    expect(snap.nextScreenAt).toBeDefined()
  })
})

describe('IpcCommandActionPayload', () => {
  it('accepts valid action literals', () => {
    const actions: IpcCommandActionPayload['action'][] = ['screen', 'close', 'stop']
    for (const action of actions) {
      const payload: IpcCommandActionPayload = { action }
      expect(payload.action).toBe(action)
    }
  })

  it('accepts optional args', () => {
    const payload: IpcCommandActionPayload = {
      action: 'close',
      args: { position_address: 'pos123' },
    }
    expect(payload.args?.position_address).toBe('pos123')
  })
})

describe('IpcAckPayload and IpcErrorPayload', () => {
  it('ACK contains ref and ok=true', () => {
    const ack: IpcAckPayload = { ref: 'msg-001', ok: true }
    expect(ack.ref).toBe('msg-001')
    expect(ack.ok).toBe(true)
  })

  it('ERROR contains code and message; ref is optional', () => {
    const err: IpcErrorPayload = { code: 'AUTH_FAILED', message: 'Invalid token' }
    expect(err.code).toBe('AUTH_FAILED')
    expect(err.ref).toBeUndefined()

    const errWithRef: IpcErrorPayload = { ref: 'msg-001', code: 'UNKNOWN', message: 'oops' }
    expect(errWithRef.ref).toBe('msg-001')
  })
})
