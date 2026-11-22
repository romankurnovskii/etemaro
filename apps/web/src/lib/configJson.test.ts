import { describe, expect, it } from 'vitest'
import { parseJsonField } from './configJson'

describe('parseJsonField', () => {
  it('accepts a complete object', () => {
    expect(parseJsonField('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
  })

  it('accepts arrays and primitives', () => {
    expect(parseJsonField('[1,2]')).toEqual({ ok: true, value: [1, 2] })
    expect(parseJsonField('true')).toEqual({ ok: true, value: true })
  })

  it('rejects a half-typed object instead of throwing', () => {
    expect(parseJsonField('{')).toEqual({ ok: false })
    expect(parseJsonField('{"a":1,}')).toEqual({ ok: false })
    expect(parseJsonField('')).toEqual({ ok: false })
  })
})
