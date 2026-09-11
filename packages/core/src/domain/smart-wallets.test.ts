/**
 * @file smart-wallets.test.ts
 * @description Unit tests for smart-wallets domain module, verifying shared path resolution and CRUD.
 */

import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sharedConfigPath } from '../shared/constants.js'
import { addSmartWallet, listSmartWallets, removeSmartWallet } from './smart-wallets.js'

describe('smart-wallets domain module', () => {
  const originalConfigPath = process.env.USER_CONFIG_PATH
  const testWalletPath = sharedConfigPath('smart-wallets.json')
  let backupContent: string | null = null

  beforeEach(() => {
    if (fs.existsSync(testWalletPath)) {
      backupContent = fs.readFileSync(testWalletPath, 'utf8')
    }
  })

  afterEach(() => {
    if (originalConfigPath === undefined) {
      delete process.env.USER_CONFIG_PATH
    } else {
      process.env.USER_CONFIG_PATH = originalConfigPath
    }

    if (backupContent !== null) {
      fs.writeFileSync(testWalletPath, backupContent, 'utf8')
    } else if (fs.existsSync(testWalletPath)) {
      fs.unlinkSync(testWalletPath)
    }
  })

  it('reads from sharedConfigPath without agent suffix even when AGENT_CONFIG_PATH is set', () => {
    process.env.USER_CONFIG_PATH = '/path/to/config/agt_custom_strategy.json'

    // Seed test wallet data in the shared path
    const seedData = {
      lists: {
        alpha: {
          wallets: [
            {
              name: 'alpha-test-1',
              address: '7xKp9QZ6mN2vR5wX8yA1bC3dE4fG6hJ9kL2mV4nW7z',
              category: 'alpha',
              type: 'lp',
              addedAt: '2026-08-30T12:00:00.000Z',
            },
          ],
        },
      },
    }
    fs.writeFileSync(testWalletPath, JSON.stringify(seedData, null, 2), 'utf8')

    const result = listSmartWallets({ listId: 'alpha' })
    expect(result.total).toBe(1)
    expect(result.wallets[0]?.name).toBe('alpha-test-1')
  })

  it('adds and removes a smart wallet correctly in the shared file', () => {
    process.env.USER_CONFIG_PATH = '/path/to/config/agt_custom_strategy.json'
    fs.writeFileSync(testWalletPath, JSON.stringify({ lists: { alpha: { wallets: [] } } }, null, 2), 'utf8')

    const testAddress = '9mN3pR8sW2vK5xY7bA4cD6eF9gH1jL4kM8nP3qS6t'
    const addRes = addSmartWallet({
      listId: 'alpha',
      name: 'whale-test',
      address: testAddress,
      category: 'whale',
      type: 'lp',
    })
    expect(addRes.success).toBe(true)

    const listRes = listSmartWallets({ listId: 'alpha' })
    expect(listRes.total).toBe(1)
    expect(listRes.wallets[0]?.name).toBe('whale-test')

    const remRes = removeSmartWallet({ listId: 'alpha', address: testAddress })
    expect(remRes.success).toBe(true)

    const listAfter = listSmartWallets({ listId: 'alpha' })
    expect(listAfter.total).toBe(0)
  })

  it('rejects an unknown smart-wallet list instead of using another list', () => {
    fs.writeFileSync(testWalletPath, JSON.stringify({ lists: { alpha: { wallets: [] } } }, null, 2), 'utf8')

    expect(() => listSmartWallets({ listId: 'copy-trade' })).toThrow(/Smart wallet list "copy-trade" not found/)
  })

  describe('smart wallet position cache pruning and bounding', () => {
    const wallet1 = '7xKp9QZ6mN2vR5wX8yA1bC3dE4fG6hJ9kL2mV4nW7z'
    const wallet2 = '8yLq0RA7nO3wS6yY9zB2cD4eF5gH7iK0lM3nW5oX8a'

    beforeEach(async () => {
      const { __clearSmartWalletCache } = await import('./smart-wallets.js')
      __clearSmartWalletCache()
    })

    it('clears specific wallet from cache when removeSmartWallet is called', async () => {
      const { checkSmartWalletsOnPool, getSmartWalletCacheSize } = await import('./smart-wallets.js')
      fs.writeFileSync(
        testWalletPath,
        JSON.stringify({
          lists: {
            alpha: {
              wallets: [
                { name: 'w1', address: wallet1, type: 'lp' },
                { name: 'w2', address: wallet2, type: 'lp' },
              ],
            },
          },
        }),
        'utf8',
      )

      const mockGetPositions = async ({ wallet_address }: { wallet_address: string }) => ({
        positions: [{ pool: 'pool_xyz' }],
      })

      await checkSmartWalletsOnPool({ listId: 'alpha', pool_address: 'pool_xyz' }, mockGetPositions)
      expect(getSmartWalletCacheSize()).toBe(2)

      removeSmartWallet({ listId: 'alpha', address: wallet1 })
      expect(getSmartWalletCacheSize()).toBe(1)
    })

    it('prunes untracked addresses when pruneSmartWalletCache is called', async () => {
      const { checkSmartWalletsOnPool, pruneSmartWalletCache, getSmartWalletCacheSize } = await import(
        './smart-wallets.js'
      )
      fs.writeFileSync(
        testWalletPath,
        JSON.stringify({
          lists: {
            alpha: {
              wallets: [
                { name: 'w1', address: wallet1, type: 'lp' },
                { name: 'w2', address: wallet2, type: 'lp' },
              ],
            },
          },
        }),
        'utf8',
      )

      const mockGetPositions = async ({ wallet_address }: { wallet_address: string }) => ({
        positions: [{ pool: 'pool_xyz' }],
      })

      await checkSmartWalletsOnPool({ listId: 'alpha', pool_address: 'pool_xyz' }, mockGetPositions)
      expect(getSmartWalletCacheSize()).toBe(2)

      // Prune keeping only wallet2
      pruneSmartWalletCache(new Set([wallet2]))
      expect(getSmartWalletCacheSize()).toBe(1)
    })
  })
})
