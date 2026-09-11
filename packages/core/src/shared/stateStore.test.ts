import { describe, expect, it, vi } from 'vitest'
import type { StateStorePort } from '../ports/state-store.js'
import { getStateStore, readStateFile, resetStateStore, setStateStore, writeStateFile } from './stateStore.js'

describe('state store binding', () => {
  it('can be swapped and delegates through loadState/saveState', () => {
    const fake = {
      read: vi.fn((_path: string, fallback: unknown) => fallback),
      write: vi.fn(),
    } as unknown as StateStorePort
    setStateStore(fake)
    expect(readStateFile('x.json', { a: 1 })).toEqual({ a: 1 })
    writeStateFile('x.json', { a: 1 })
    expect(fake.read).toHaveBeenCalledWith('x.json', { a: 1 }, undefined)
    expect(fake.write).toHaveBeenCalledWith('x.json', { a: 1 })
    resetStateStore()
  })

  it('defaults to a working store', () => {
    resetStateStore()
    expect(getStateStore()).toBeDefined()
  })
})
