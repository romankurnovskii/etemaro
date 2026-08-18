import { describe, it, expect } from 'vitest';
import { diffSmartWalletPositions, updateSnapshotPositions, type SmartWalletSnapshot, type WalletPositionItem } from './smart-wallets-screening.js';

describe('Smart Wallets Screening Logic', () => {
  describe('diffSmartWalletPositions', () => {
    it('initializes snapshot on first run and records baseline without returning new positions', () => {
      const current: WalletPositionItem[] = [
        { position: 'pos1', pool: 'poolA' },
        { position: 'pos2', pool: 'poolB' },
      ];

      const res = diffSmartWalletPositions(current, null);

      expect(res.isFirstRun).toBe(true);
      expect(res.newPositions).toEqual([]);
      expect(res.uniquePools).toEqual([]);
      expect(res.nextSnapshot).toEqual({
        initialized: true,
        positions: ['pos1', 'pos2'],
      });
    });

    it('initializes snapshot on first run even when zero positions are active', () => {
      const current: WalletPositionItem[] = [];

      const res = diffSmartWalletPositions(current, { initialized: false, positions: [] });

      expect(res.isFirstRun).toBe(true);
      expect(res.nextSnapshot.initialized).toBe(true);
      expect(res.nextSnapshot.positions).toEqual([]);

      // Second run: wallet opens position 1
      const currentRun2: WalletPositionItem[] = [{ position: 'pos1', pool: 'poolA' }];
      const resRun2 = diffSmartWalletPositions(currentRun2, res.nextSnapshot);

      expect(resRun2.isFirstRun).toBe(false);
      expect(resRun2.newPositions).toEqual([{ position: 'pos1', pool: 'poolA' }]);
      expect(resRun2.uniquePools).toEqual(['poolA']);
    });

    it('identifies newly opened positions and unique pools correctly', () => {
      const snapshot: SmartWalletSnapshot = {
        initialized: true,
        positions: ['pos1'],
      };

      const current: WalletPositionItem[] = [
        { position: 'pos1', pool: 'poolA' },
        { position: 'pos2', pool: 'poolB' },
        { position: 'pos3', pool: 'poolB' }, // duplicate poolB
      ];

      const res = diffSmartWalletPositions(current, snapshot);

      expect(res.isFirstRun).toBe(false);
      expect(res.newPositions).toEqual([
        { position: 'pos2', pool: 'poolB' },
        { position: 'pos3', pool: 'poolB' },
      ]);
      expect(res.uniquePools).toEqual(['poolB']);
    });
  });

  describe('updateSnapshotPositions', () => {
    it('only commits resolved (successful or vetoed) positions to snapshot', () => {
      const snapshot: SmartWalletSnapshot = {
        initialized: true,
        positions: ['pos1'],
      };

      const processed = [
        { position: 'pos2', resolved: true }, // Vetoed or successfully deployed
        { position: 'pos3', resolved: false }, // Deploy failed with network error
      ];

      const updated = updateSnapshotPositions(snapshot, processed);

      expect(updated.positions).toContain('pos1');
      expect(updated.positions).toContain('pos2');
      expect(updated.positions).not.toContain('pos3'); // Retry pos3 on next tick
    });
  });
});
