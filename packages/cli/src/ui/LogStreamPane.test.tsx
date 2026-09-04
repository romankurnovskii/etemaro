import type { IpcLogEntry } from '@etemaro/core'
import { renderToString } from 'ink'
import { describe, expect, it } from 'vitest'
import { LogStreamPane } from './LogStreamPane.js'

describe('LogStreamPane', () => {
  const sampleLogs: IpcLogEntry[] = Array.from({ length: 30 }, (_, i) => ({
    category: i % 2 === 0 ? 'swap' : 'state',
    message: `Log message ${i + 1}`,
    agentId: 'agent-default',
    ts: '2026-09-04T12:00:00.000Z',
  }))

  it('renders latest logs in live mode (scrollOffset = 0)', () => {
    const output = renderToString(<LogStreamPane logs={sampleLogs} maxVisible={10} scrollOffset={0} />)
    expect(output).toContain('Logs (Live Stream)')
    expect(output).toContain('Log message 30')
    expect(output).toContain('Log message 21')
    expect(output).not.toContain('Log message 15')
  })

  it('renders historical logs when scrollOffset > 0', () => {
    const output = renderToString(<LogStreamPane logs={sampleLogs} maxVisible={10} scrollOffset={5} />)
    expect(output).toContain('PAUSED HISTORY')
    // 30 - 5 = 25 (endIndex), startIndex = 15
    expect(output).toContain('Viewing 16-25 of 30')
    expect(output).toContain('Log message 25')
    expect(output).toContain('Log message 16')
    expect(output).not.toContain('Log message 30')
  })

  it('clamps scrollOffset to oldest available log range', () => {
    const output = renderToString(<LogStreamPane logs={sampleLogs} maxVisible={10} scrollOffset={999} />)
    expect(output).toContain('Viewing 1-10 of 30')
    expect(output).toContain('Log message 1')
    expect(output).toContain('Log message 10')
  })
})
