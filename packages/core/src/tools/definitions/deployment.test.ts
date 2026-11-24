import { describe, expect, it } from 'vitest'
import { deploymentTools } from './deployment.js'

function deployDescription(): string {
  const tool = deploymentTools.find((t) => t.function.name === 'deploy_position')
  if (!tool) throw new Error('deploy_position definition missing')
  return tool.function.description ?? ''
}

describe('deploy_position description', () => {
  it('does not hardcode a bin count', () => {
    // Bounds are config-driven; a literal here contradicts agents that override
    // minBinsBelow/maxBinsBelow (the old text said "35 bins").
    const description = deployDescription()
    expect(description).not.toMatch(/\b\d+\s+total bins\b/)
    expect(description).not.toMatch(/floor is \d+/)
  })

  it('points the model at the configured bounds instead', () => {
    const description = deployDescription()
    expect(description).toContain('minBinsBelow')
    expect(description).toContain('maxBinsBelow')
  })
})
