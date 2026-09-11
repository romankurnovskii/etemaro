import { toolExecutor, tools, wallet } from '@etemaro/core'
import { describe, expect, it } from 'vitest'
import { createDaemonAdapters } from './composition.js'

describe('createDaemonAdapters', () => {
  it('assembles the core adapter namespaces into the daemon container', () => {
    const adapters = createDaemonAdapters()
    expect(adapters.toolExecutor).toBe(toolExecutor)
    expect(adapters.wallet).toBe(wallet)
    expect(adapters.meteora).toBeDefined()
    expect(adapters.screening).toBeDefined()
    expect(typeof adapters.agentLoopDeps.executeTool).toBe('function')
    expect(typeof adapters.agentLoopDeps.getTools).toBe('function')
    expect(adapters.agentLoopDeps.getTools()).toBe(tools)
  })
})
