import { describe, expect, it } from 'vitest'
import { diffObjects, unwrapStrategy } from './strategyDiff'

describe('unwrapStrategy', () => {
  it('unwraps the /api/tool result and a nested strategy', () => {
    expect(unwrapStrategy({ result: { strategy: { id: 'a' } } })).toEqual({ id: 'a' })
    expect(unwrapStrategy({ result: { id: 'a' } })).toEqual({ id: 'a' })
  })
})

describe('diffObjects', () => {
  it('reports changed, added and removed leaves with dotted paths', () => {
    const rows = diffObjects(
      { id: 'a', range: { min: 1, max: 5 }, tags: ['x'], old: true },
      { id: 'b', range: { min: 1, max: 9 }, tags: ['x', 'y'], fresh: 1 },
    )
    expect(rows).toEqual([
      { path: 'fresh', before: '', after: '1', kind: 'added' },
      { path: 'id', before: 'a', after: 'b', kind: 'changed' },
      { path: 'old', before: 'true', after: '', kind: 'removed' },
      { path: 'range.max', before: '5', after: '9', kind: 'changed' },
      { path: 'tags.1', before: '', after: 'y', kind: 'added' },
    ])
  })
  it('ignores volatile timestamp keys and equal objects', () => {
    expect(diffObjects({ a: 1, created_at: 'x', updatedAt: 'y' }, { a: 1, created_at: 'z', updatedAt: 'w' })).toEqual(
      [],
    )
  })
  it('treats a missing current strategy as all-added', () => {
    expect(diffObjects(null, { a: 1 }).map((r) => r.kind)).toEqual(['added'])
  })
})
