import { beforeEach, describe, expect, it } from 'vitest'
import { applyTheme, useThemeStore } from './themeStore'

describe('themeStore', () => {
  beforeEach(() => {
    useThemeStore.setState({ mode: 'system' })
  })

  it('cycles system → light → dark → system', () => {
    const { cycle } = useThemeStore.getState()
    expect(useThemeStore.getState().mode).toBe('system')
    cycle()
    expect(useThemeStore.getState().mode).toBe('light')
    cycle()
    expect(useThemeStore.getState().mode).toBe('dark')
    cycle()
    expect(useThemeStore.getState().mode).toBe('system')
  })

  it('setMode stores the explicit mode', () => {
    useThemeStore.getState().setMode('dark')
    expect(useThemeStore.getState().mode).toBe('dark')
  })

  it('applyTheme is a no-op without a document (SSR / tests)', () => {
    expect(() => applyTheme('dark')).not.toThrow()
  })
})
