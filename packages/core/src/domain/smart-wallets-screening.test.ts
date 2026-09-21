import { describe, expect, it } from 'vitest'
import {
  diffSmartWalletPositions,
  type SmartWalletSnapshot,
  updateSnapshotPositions,
  type WalletPositionItem,
} from './smart-wallets-screening.js'

describe('Smart Wallets Screening Logic', () => {
  describe('diffSmartWalletPositions', () => {
    it('initializes snapshot on first run and records baseline without returning new positions', () => {
      const current: WalletPositionItem[] = [
        { position: 'pos1', pool: 'poolA' },
        { position: 'pos2', pool: 'poolB' },
      ]

      const res = diffSmartWalletPositions(current, null)

      expect(res.isFirstRun).toBe(true)
      expect(res.newPositions).toEqual([])
      expect(res.uniquePools).toEqual([])
      expect(res.nextSnapshot).toEqual({
        initialized: true,
        positions: ['pos1', 'pos2'],
        vetoed: {},
      })
    })

    it('initializes snapshot on first run even when zero positions are active', () => {
      const current: WalletPositionItem[] = []

      const res = diffSmartWalletPositions(current, { initialized: false, positions: [] })

      expect(res.isFirstRun).toBe(true)
      expect(res.nextSnapshot.initialized).toBe(true)
      expect(res.nextSnapshot.positions).toEqual([])

      // Second run: wallet opens position 1
      const currentRun2: WalletPositionItem[] = [{ position: 'pos1', pool: 'poolA' }]
      const resRun2 = diffSmartWalletPositions(currentRun2, res.nextSnapshot)

      expect(resRun2.isFirstRun).toBe(false)
      expect(resRun2.newPositions).toEqual([{ position: 'pos1', pool: 'poolA' }])
      expect(resRun2.uniquePools).toEqual(['poolA'])
    })

    it('identifies newly opened positions and unique pools correctly', () => {
      const snapshot: SmartWalletSnapshot = {
        initialized: true,
        positions: ['pos1'],
      }

      const current: WalletPositionItem[] = [
        { position: 'pos1', pool: 'poolA' },
        { position: 'pos2', pool: 'poolB' },
        { position: 'pos3', pool: 'poolB' }, // duplicate poolB
      ]

      const res = diffSmartWalletPositions(current, snapshot)

      expect(res.isFirstRun).toBe(false)
      expect(res.newPositions).toEqual([
        { position: 'pos2', pool: 'poolB' },
        { position: 'pos3', pool: 'poolB' },
      ])
      expect(res.uniquePools).toEqual(['poolB'])
    })
  })

  describe('updateSnapshotPositions', () => {
    it('only commits resolved (successful or vetoed) positions to snapshot', () => {
      const snapshot: SmartWalletSnapshot = {
        initialized: true,
        positions: ['pos1'],
      }

      const processed = [
        { position: 'pos2', resolved: true }, // Vetoed or successfully deployed
        { position: 'pos3', resolved: false }, // Deploy failed with network error
      ]

      const updated = updateSnapshotPositions(snapshot, processed)

      expect(updated.positions).toContain('pos1')
      expect(updated.positions).toContain('pos2')
      expect(updated.positions).not.toContain('pos3') // Retry pos3 on next tick
    })

    it('records a vetoed position separately from permanently handled positions', () => {
      const snapshot: SmartWalletSnapshot = { initialized: true, positions: [] }

      const updated = updateSnapshotPositions(snapshot, [
        { position: 'pos2', resolved: true, vetoed: true, reason: 'volatility 0 is unusable', at: 12345 },
      ])

      expect(updated.positions).not.toContain('pos2')
      expect(updated.vetoed?.pos2).toEqual({ at: 12345, reason: 'volatility 0 is unusable' })
    })

    it('keeps a deployed position permanent and clears any prior veto marker', () => {
      const snapshot: SmartWalletSnapshot = {
        initialized: true,
        positions: [],
        vetoed: { pos2: { at: 1, reason: 'TVL 426760.4 above maxTvl 300000' } },
      }

      const updated = updateSnapshotPositions(snapshot, [{ position: 'pos2', resolved: true }])

      expect(updated.positions).toContain('pos2')
      expect(updated.vetoed?.pos2).toBeUndefined()
    })
  })

  describe('veto retry TTL', () => {
    const HOUR = 3_600_000

    it('suppresses a vetoed position until the TTL elapses, then reports it as new again', () => {
      const t0 = 1_000_000_000_000
      const snapshot: SmartWalletSnapshot = {
        initialized: true,
        positions: ['pos1'],
        vetoed: { pos2: { at: t0, reason: 'TVL 426760.4 above maxTvl 300000' } },
      }
      const current: WalletPositionItem[] = [
        { position: 'pos1', pool: 'poolA' },
        { position: 'pos2', pool: 'poolB' },
      ]

      const withinTtl = diffSmartWalletPositions(current, snapshot, { now: t0 + HOUR, vetoRetryMs: 6 * HOUR })
      expect(withinTtl.newPositions).toEqual([])
      expect(withinTtl.nextSnapshot.vetoed?.pos2).toBeDefined()

      const afterTtl = diffSmartWalletPositions(current, snapshot, { now: t0 + 7 * HOUR, vetoRetryMs: 6 * HOUR })
      expect(afterTtl.newPositions).toEqual([{ position: 'pos2', pool: 'poolB' }])
      expect(afterTtl.nextSnapshot.vetoed?.pos2).toBeUndefined()
    })

    it('migrates a legacy snapshot that has no vetoed map', () => {
      const legacy = { initialized: true, positions: ['pos1'] } as SmartWalletSnapshot

      const res = diffSmartWalletPositions(
        [
          { position: 'pos1', pool: 'poolA' },
          { position: 'pos2', pool: 'poolB' },
        ],
        legacy,
      )

      expect(res.newPositions).toEqual([{ position: 'pos2', pool: 'poolB' }])
      expect(res.nextSnapshot.vetoed).toEqual({})
    })
  })
})
