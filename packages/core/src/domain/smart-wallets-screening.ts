/**
 * @file smart-wallets-screening.ts
 * @description Pure helper logic for smart wallet candidate discovery, snapshot diffing, and position ledger tracking.
 */

export interface SmartWalletSnapshot {
  initialized: boolean
  positions: string[]
}

export interface WalletPositionItem {
  position: string
  pool: string
}

export interface SmartWalletDiffResult {
  isFirstRun: boolean
  newPositions: WalletPositionItem[]
  uniquePools: string[]
  nextSnapshot: SmartWalletSnapshot
}

/**
 * Calculates new smart wallet positions against a snapshot ledger.
 * On first run (!snapshot.initialized), initializes the snapshot with currentPositions and returns isFirstRun: true.
 */
export function diffSmartWalletPositions(
  currentPositions: WalletPositionItem[],
  existingSnapshot?: SmartWalletSnapshot | null,
): SmartWalletDiffResult {
  const snapshot: SmartWalletSnapshot =
    existingSnapshot && typeof existingSnapshot === 'object'
      ? {
          initialized: Boolean(existingSnapshot.initialized),
          positions: Array.isArray(existingSnapshot.positions) ? existingSnapshot.positions : [],
        }
      : { initialized: false, positions: [] }

  if (!snapshot.initialized) {
    const allPos = Array.from(new Set(currentPositions.map((p) => p.position)))
    return {
      isFirstRun: true,
      newPositions: [],
      uniquePools: [],
      nextSnapshot: {
        initialized: true,
        positions: allPos,
      },
    }
  }

  const knownSet = new Set(snapshot.positions)
  const newPositions = currentPositions.filter((p) => !knownSet.has(p.position))
  const uniquePools = Array.from(new Set(newPositions.map((p) => p.pool).filter(Boolean)))

  return {
    isFirstRun: false,
    newPositions,
    uniquePools,
    nextSnapshot: { ...snapshot },
  }
}

/**
 * Updates snapshot ledger with newly processed positions.
 * Only positions marked as resolved (successful deploy or vetoed) are committed to the known positions set.
 * Failed deployments are left uncommitted so they can retry on the next screening tick.
 */
export function updateSnapshotPositions(
  snapshot: SmartWalletSnapshot,
  processedPositions: { position: string; resolved: boolean }[],
): SmartWalletSnapshot {
  const knownSet = new Set(snapshot.positions)
  for (const item of processedPositions) {
    if (item.resolved) {
      knownSet.add(item.position)
    }
  }
  return {
    initialized: true,
    positions: Array.from(knownSet),
  }
}
