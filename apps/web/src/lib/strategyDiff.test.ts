import { describe, expect, it } from 'vitest'
import { diffStrategies, flatten, formatDiffValue } from './strategyDiff'

describe('flatten', () => {
  it('produces dotted keys for nested params', () => {
    expect(flatten({ range: { min: 1, max: { bins: 69 } }, name: 'x' })).toEqual({
      'range.min': 1,
      'range.max.bins': 69,
      name: 'x',
    })
  })

  it('treats arrays, null and empty objects as leaves', () => {
    expect(flatten({ tags: ['a', 'b'], extra: null, empty: {} })).toEqual({ tags: ['a', 'b'], extra: null, empty: {} })
  })
})

describe('diffStrategies', () => {
  it('reports nested changes as their own rows', () => {
    const rows = diffStrategies(
      { id: 'a', range: { min: 10, max: 60 }, entry: { minTvl: 1000 } },
      { id: 'b', range: { min: 20, max: 60 }, entry: { minTvl: 1000 } },
    )
    expect(rows).toEqual([
      { key: 'id', kind: 'changed', before: 'a', after: 'b' },
      { key: 'range.min', kind: 'changed', before: 10, after: 20 },
    ])
  })

  it('reports added and removed leaves', () => {
    const rows = diffStrategies({ range: { min: 1, old: true } }, { range: { min: 1, fresh: 2 } })
    expect(rows).toEqual([
      { key: 'range.fresh', kind: 'added', after: 2 },
      { key: 'range.old', kind: 'removed', before: true },
    ])
  })

  it('compares arrays by value', () => {
    expect(diffStrategies({ tags: ['a'] }, { tags: ['a'] })).toEqual([])
    expect(diffStrategies({ tags: ['a'] }, { tags: ['a', 'b'] })).toHaveLength(1)
  })

  it('ignores the parent-relative is_active flag', () => {
    expect(diffStrategies({ id: 'a', is_active: true }, { id: 'a', is_active: false })).toEqual([])
  })

  it('treats a missing current strategy as all-added', () => {
    const rows = diffStrategies(null, { id: 'b', range: { min: 1 } })
    expect(rows.map((r) => [r.key, r.kind])).toEqual([
      ['id', 'added'],
      ['range.min', 'added'],
    ])
  })

  it('handles a nested object replacing a scalar', () => {
    const rows = diffStrategies({ range: 5 }, { range: { min: 1 } })
    expect(rows).toEqual([
      { key: 'range', kind: 'removed', before: 5 },
      { key: 'range.min', kind: 'added', after: 1 },
    ])
  })
})

describe('formatDiffValue', () => {
  it('formats leaves compactly', () => {
    expect(formatDiffValue(undefined)).toBe('—')
    expect(formatDiffValue('x')).toBe('x')
    expect(formatDiffValue([1, 2])).toBe('[1,2]')
    expect(formatDiffValue(null)).toBe('null')
  })
})
