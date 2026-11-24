import { describe, expect, it } from 'vitest'
import { normalizeBinBounds } from './Config.js'

describe('normalizeBinBounds', () => {
  it('clamps defaultBinsBelow into [min, max] after an override', () => {
    // Shipped default is 35..69; an agent overriding to 10..30 keeps defaultBinsBelow: 35.
    expect(normalizeBinBounds({ minBinsBelow: 10, maxBinsBelow: 30, defaultBinsBelow: 35 })).toEqual({
      minBinsBelow: 10,
      maxBinsBelow: 30,
      defaultBinsBelow: 30,
    })
  })

  it('leaves a coherent range untouched', () => {
    expect(normalizeBinBounds({ minBinsBelow: 35, maxBinsBelow: 69, defaultBinsBelow: 69 })).toEqual({
      minBinsBelow: 35,
      maxBinsBelow: 69,
      defaultBinsBelow: 69,
    })
  })

  it('keeps max >= min and raises min to the safe floor', () => {
    expect(normalizeBinBounds({ minBinsBelow: 2, maxBinsBelow: 1, defaultBinsBelow: 1 })).toEqual({
      minBinsBelow: 10,
      maxBinsBelow: 10,
      defaultBinsBelow: 10,
    })
  })

  it('fills missing bounds from the safe floor', () => {
    expect(normalizeBinBounds({})).toEqual({ minBinsBelow: 10, maxBinsBelow: 10, defaultBinsBelow: 10 })
  })

  it('rounds fractional values', () => {
    expect(normalizeBinBounds({ minBinsBelow: 10.4, maxBinsBelow: 30.6, defaultBinsBelow: 20.5 })).toEqual({
      minBinsBelow: 10,
      maxBinsBelow: 31,
      defaultBinsBelow: 21,
    })
  })
})
