import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setDryRun } from './flags.js'
import { addLogListener, clearLogListeners, log, logStructured } from './logger.js'

interface Captured {
  category: string
  dryRun?: boolean
}

describe('IPC log entries carry the dry-run flag', () => {
  let captured: Captured[] = []
  let stop: () => void

  beforeEach(() => {
    captured = []
    stop = addLogListener((entry) => {
      captured.push({ category: entry.category, dryRun: entry.dryRun })
    })
  })

  afterEach(() => {
    stop()
    clearLogListeners()
    setDryRun(false)
  })

  it('marks text log entries as dry-run', () => {
    setDryRun(true)
    log('startup', 'hello')
    expect(captured.at(-1)).toMatchObject({ category: 'startup', dryRun: true })
  })

  it('marks structured log entries as dry-run', () => {
    setDryRun(true)
    logStructured({ category: 'tool_start', message: 'exec' })
    expect(captured.at(-1)).toMatchObject({ category: 'tool_start', dryRun: true })
  })

  it('reports false when live', () => {
    setDryRun(false)
    log('startup', 'hello')
    expect(captured.at(-1)).toMatchObject({ category: 'startup', dryRun: false })
  })
})
