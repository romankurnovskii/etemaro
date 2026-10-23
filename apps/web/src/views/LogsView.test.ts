import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogEntry } from '../lib/ipc'
import { filterLogs, LogsView, logLevel } from './LogsView'

const logs: LogEntry[] = [
  {
    category: 'worker',
    message: 'error appears in a normal info message',
    level: 'info',
    agentId: 'alpha',
    ts: '2026-10-17T01:00:00Z',
  },
  { category: 'worker', message: 'retrying', level: 'warn', agentId: 'alpha', ts: '2026-10-17T01:00:01Z' },
  {
    category: 'tool',
    message: 'ERROR is text, severity was not reported',
    agentId: 'alpha',
    ts: '2026-10-17T01:00:02Z',
  },
]
let renderer: ReactTestRenderer | undefined
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
afterEach(async () => {
  if (renderer)
    await act(async () => {
      renderer?.unmount()
    })
  renderer = undefined
  vi.unstubAllGlobals()
})

describe('producer-reported log filtering', () => {
  it('keeps missing and unfamiliar levels unknown instead of inferring severity from message/category', () => {
    expect(logLevel(logs[0]!)).toBe('info')
    expect(logLevel(logs[2]!)).toBe('unknown')
    expect(logLevel({ ...logs[0]!, level: 'future-level' } as unknown as LogEntry)).toBe('unknown')
    expect(filterLogs(logs, 'error', null, 'error')).toEqual([])
    expect(filterLogs(logs, 'error', null, 'unknown')).toEqual([logs[2]])
  })
  it('combines category, text and severity while preserving the original buffer', () => {
    expect(filterLogs(logs, ' RETRY ', 'worker', 'warn')).toEqual([logs[1]])
    expect(filterLogs(logs, '', null, 'all')).toEqual(logs)
    expect(logs).toHaveLength(3)
  })
  it('shows missing severity by default and retains a selected category when that category leaves the rolling buffer', async () => {
    await act(async () => {
      renderer = create(createElement(LogsView, { logs }))
    })
    expect(renderer!.root.findAllByProps({ className: 'log-line' })).toHaveLength(3)
    await act(async () =>
      renderer!.root.findByProps({ id: 'console-log-category' }).props.onChange({ target: { value: 'category:tool' } }),
    )
    await act(async () =>
      renderer!.root.findByProps({ id: 'console-log-level' }).props.onChange({ target: { value: 'unknown' } }),
    )
    expect(renderer!.root.findAllByProps({ className: 'log-line' })).toHaveLength(1)
    await act(async () => renderer!.update(createElement(LogsView, { logs: logs.slice(0, 2) })))
    expect(renderer!.root.findByProps({ id: 'console-log-category' }).props.value).toBe('category:tool')
    expect(JSON.stringify(renderer!.toJSON())).toContain('not in current buffer')
    expect(JSON.stringify(renderer!.toJSON())).toContain('No logs match these filters.')
    await act(async () => renderer!.root.findByType('button').props.onClick())
    expect(renderer!.root.findAllByProps({ className: 'log-line' })).toHaveLength(2)
  })
  it('reports the visible tail limit without dropping unknown entries from the matching count', async () => {
    const many = Array.from({ length: 405 }, (_, index) => ({ ...logs[2]!, ts: String(index) }))
    await act(async () => {
      renderer = create(createElement(LogsView, { logs: many }))
    })
    expect(renderer!.root.findAllByProps({ className: 'log-line' })).toHaveLength(400)
    expect(renderer!.root.findByProps({ role: 'status' }).children.join('')).toContain('Showing 400 of 405')
  })
})
