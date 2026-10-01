/**
 * @file dev-blocklist.test.ts
 * @description Behaviour tests for the deployer blocklist. `ScreeningAdapter` drops candidate
 * pools through `isDevBlocked()` (three call sites), so these are safety-gate tests.
 *
 * Isolation: an in-memory state store is injected, so the test never touches
 * `config/shared/dev-blocklist.json`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { StateStorePort } from '../ports/state-store.js'
import { resetStateStore, setStateStore } from '../shared/stateStore.js'
import { blockDev, getBlockedDevs, isDevBlocked, listBlockedDevs, unblockDev } from './dev-blocklist.js'

function useMemoryStore(): void {
  const files = new Map<string, unknown>()
  const store: StateStorePort = {
    read<T>(filePath: string, fallback: T): T {
      return (files.has(filePath) ? files.get(filePath) : fallback) as T
    },
    write(filePath: string, data: unknown): void {
      files.set(filePath, JSON.parse(JSON.stringify(data)))
    },
  }
  setStateStore(store)
}

describe('dev-blocklist', () => {
  beforeEach(() => {
    useMemoryStore()
  })

  afterEach(() => {
    resetStateStore()
  })

  it('blocks a deployer and reports it blocked afterwards', () => {
    const result = blockDev({ wallet: 'DEV_RUG', reason: 'serial rugger', label: 'rugger-1' })

    expect(result).toMatchObject({ blocked: true, wallet: 'DEV_RUG' })
    expect(isDevBlocked('DEV_RUG')).toBe(true)
    expect(getBlockedDevs().DEV_RUG?.label).toBe('rugger-1')
    expect(getBlockedDevs().DEV_RUG?.reason).toBe('serial rugger')
  })

  it('treats unknown, empty and absent wallets as not blocked', () => {
    expect(isDevBlocked('SOMEONE_ELSE')).toBe(false)
    expect(isDevBlocked('')).toBe(false)
    expect(isDevBlocked(null)).toBe(false)
    expect(isDevBlocked(undefined)).toBe(false)
  })

  it('requires a wallet address to block', () => {
    expect(blockDev({ wallet: '' })).toEqual({ error: 'wallet required' })
  })

  it('re-blocking an existing deployer keeps the original entry', () => {
    blockDev({ wallet: 'DEV_RUG', reason: 'first reason', label: 'first-label' })

    const second = blockDev({ wallet: 'DEV_RUG', reason: 'second reason', label: 'second-label' })

    expect(second).toMatchObject({ already_blocked: true })
    expect(getBlockedDevs().DEV_RUG?.label).toBe('first-label')
    expect(getBlockedDevs().DEV_RUG?.reason).toBe('first reason')
    expect(listBlockedDevs().count).toBe(1)
  })

  it('unblocks a blocked deployer and errors for one that is not on the list', () => {
    blockDev({ wallet: 'DEV_RUG', label: 'rugger-1' })

    expect(unblockDev({ wallet: 'DEV_RUG' })).toMatchObject({ unblocked: true, wallet: 'DEV_RUG' })
    expect(isDevBlocked('DEV_RUG')).toBe(false)
    expect(unblockDev({ wallet: 'DEV_RUG' })).toEqual({ error: 'Wallet DEV_RUG not on dev blocklist' })
  })

  it('lists every blocked deployer with its metadata', () => {
    blockDev({ wallet: 'DEV_A', label: 'a', reason: 'ra' })
    blockDev({ wallet: 'DEV_B', label: 'b', reason: 'rb' })

    const listed = listBlockedDevs()

    expect(listed.count).toBe(2)
    expect(listed.blocked_devs).toHaveLength(2)
    expect(listed.blocked_devs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ wallet: 'DEV_A', label: 'a', reason: 'ra' }),
        expect.objectContaining({ wallet: 'DEV_B', label: 'b', reason: 'rb' }),
      ]),
    )
  })
})
