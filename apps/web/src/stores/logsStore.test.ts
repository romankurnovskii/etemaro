import { beforeEach, describe, expect, it } from 'vitest'
import type { LogEntry } from '../lib/ipc'
import { MAX_LOGS_PER_AGENT } from '../lib/logs'
import { useLogsStore } from './logsStore'

function entry(agentId: string, message = 'm', category = 'cron'): LogEntry {
  return { agentId, category, message, ts: new Date().toISOString() }
}

describe('logsStore', () => {
  beforeEach(() => {
    useLogsStore.getState().clear()
  })

  it('buckets entries by their own agentId', () => {
    const { ingest } = useLogsStore.getState()
    ingest(entry('a', 'one'))
    ingest(entry('b', 'two'))
    ingest(entry('a', 'three'))

    const store = useLogsStore.getState().store
    expect(store.a?.map((r) => r.entry.message)).toEqual(['one', 'three'])
    expect(store.b?.map((r) => r.entry.message)).toEqual(['two'])
  })

  it('assigns a monotonic seq used for stable keys', () => {
    const { ingest } = useLogsStore.getState()
    ingest(entry('a'))
    ingest(entry('a'))
    const seqs = useLogsStore.getState().store.a?.map((r) => r.seq)
    expect(seqs).toEqual([0, 1])
  })

  it('drops entries without an agentId', () => {
    const { ingest } = useLogsStore.getState()
    ingest({ ...entry(''), agentId: '' })
    ingest({ ...entry('a'), agentId: undefined as unknown as string })
    expect(Object.keys(useLogsStore.getState().store)).toHaveLength(0)
  })

  it('coerces missing category/message to strings', () => {
    const { ingest } = useLogsStore.getState()
    ingest({ agentId: 'a', ts: 't' } as unknown as LogEntry)
    const record = useLogsStore.getState().store.a?.[0]
    expect(record?.entry.category).toBe('')
    expect(record?.entry.message).toBe('')
  })

  it('bounds each agent bucket', () => {
    const { ingest } = useLogsStore.getState()
    for (let i = 0; i < MAX_LOGS_PER_AGENT + 5; i++) ingest(entry('a', `m${i}`))
    const bucket = useLogsStore.getState().store.a ?? []
    expect(bucket).toHaveLength(MAX_LOGS_PER_AGENT)
    expect(bucket[bucket.length - 1]?.entry.message).toBe(`m${MAX_LOGS_PER_AGENT + 4}`)
  })

  it('clear resets buckets and the sequence', () => {
    const { ingest } = useLogsStore.getState()
    ingest(entry('a'))
    useLogsStore.getState().clear()
    expect(useLogsStore.getState().store).toEqual({})
    expect(useLogsStore.getState().seq).toBe(0)
  })
})
