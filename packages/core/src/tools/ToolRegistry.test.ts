import { describe, expect, it } from 'vitest'
import type { ToolDefinition } from '../shared/types.js'
import { ToolRegistry } from './ToolRegistry.js'

function def(name: string): ToolDefinition {
  return {
    type: 'function',
    function: { name, description: `${name} desc`, parameters: { type: 'object', properties: {} } },
  }
}

const handler = async () => ({ ok: true })

describe('ToolRegistry', () => {
  it('indexes definitions and handlers by name', () => {
    const reg = new ToolRegistry({ definitions: [def('a'), def('b')], handlers: { a: handler, b: handler } })
    expect(reg.names().sort()).toEqual(['a', 'b'])
    expect(reg.getHandler('a')).toBe(handler)
    expect(reg.getDefinition('a')?.function.name).toBe('a')
    expect(reg.getDefinitions().map((d) => d.function.name)).toEqual(['a', 'b'])
  })

  it('throws when a definition has no handler', () => {
    expect(() => new ToolRegistry({ definitions: [def('a')], handlers: {} })).toThrow(/no handler/)
  })

  it('rejects duplicate definition names', () => {
    expect(() => new ToolRegistry({ definitions: [def('a'), def('a')], handlers: { a: handler } })).toThrow(/duplicate/)
  })

  it('treats handlers without definitions as internal and never exposes them', () => {
    const reg = new ToolRegistry({ definitions: [def('a')], handlers: { a: handler, internal_only: handler } })
    expect(reg.internalNames()).toEqual(['internal_only'])
    expect(reg.exposedNames()).toEqual(['a'])
    expect(reg.has('internal_only')).toBe(true)
  })

  it('classifies write and protected tools', () => {
    const reg = new ToolRegistry({
      definitions: [def('w')],
      handlers: { w: handler, p: handler, r: handler },
      writeTools: ['w', 'p'],
      protectedTools: ['p'],
    })
    expect(reg.isWrite('w')).toBe(true)
    expect(reg.isProtected('p')).toBe(true)
    expect(reg.isWrite('r')).toBe(false)
    expect(reg.isProtected('w')).toBe(false)
    expect(reg.kindOf('w')).toBe('write')
    expect(reg.kindOf('p')).toBe('protected')
    expect(reg.kindOf('r')).toBe('read')
  })

  it('throws when a write or protected tool has no handler', () => {
    expect(() => new ToolRegistry({ definitions: [], handlers: { a: handler }, writeTools: ['missing'] })).toThrow(
      /no handler/,
    )
  })
})
