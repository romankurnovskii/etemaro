import { describe, expect, it, vi } from 'vitest'
import type { ToolPorts } from './toolPorts.js'
import { getToolPorts, resetToolPorts, setToolPorts } from './toolPorts.js'

describe('tool ports binding', () => {
  it('defaults to the concrete adapters', () => {
    resetToolPorts()
    expect(typeof getToolPorts().chain.deployPosition).toBe('function')
    expect(typeof getToolPorts().market.discoverPools).toBe('function')
    expect(typeof getToolPorts().wallet.swapToken).toBe('function')
  })

  it('can be swapped', () => {
    const fake = { chain: { deployPosition: vi.fn() }, market: {}, wallet: {} } as unknown as ToolPorts
    setToolPorts(fake)
    expect(getToolPorts().chain.deployPosition).toBe(fake.chain.deployPosition)
    resetToolPorts()
  })
})
