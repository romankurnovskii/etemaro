import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { generateNewWallet, WalletsStore } from './WalletAdapter.js';
import bs58 from 'bs58';

describe('WalletAdapter', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etemaro-wallet-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('generateNewWallet', () => {
    it('generates a valid Solana keypair and saves it to wallets.json', () => {
      const result = generateNewWallet({
        configDir: tempDir,
        label: 'Test Generated Wallet',
      });

      expect(result).toBeDefined();
      expect(result.publicKey).toBeDefined();
      expect(result.privateKey).toBeDefined();
      expect(result.label).toBe('Test Generated Wallet');
      expect(typeof result.createdAt).toBe('string');

      // Verify public key is base58 string with correct length
      expect(result.publicKey.length).toBeGreaterThanOrEqual(32);

      // Verify private key can be decoded back to 64-byte keypair secret
      const decodedSecret = bs58.decode(result.privateKey);
      expect(decodedSecret.length).toBe(64);

      // Verify wallets.json was created and populated
      const targetFile = path.join(tempDir, 'wallets.json');
      expect(fs.existsSync(targetFile)).toBe(true);

      const store: WalletsStore = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
      expect(store.wallets).toHaveLength(1);
      expect(store.wallets[0]?.publicKey).toBe(result.publicKey);
      expect(store.wallets[0]?.privateKey).toBe(result.privateKey);
      expect(store.wallets[0]?.label).toBe('Test Generated Wallet');
    });

    it('appends multiple generated wallets without overwriting existing entries', () => {
      const w1 = generateNewWallet({ configDir: tempDir, label: 'Wallet 1' });
      const w2 = generateNewWallet({ configDir: tempDir, label: 'Wallet 2' });

      expect(w1.publicKey).not.toBe(w2.publicKey);
      expect(w1.privateKey).not.toBe(w2.privateKey);

      const targetFile = path.join(tempDir, 'wallets.json');
      const store: WalletsStore = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
      expect(store.wallets).toHaveLength(2);
      expect(store.wallets[0]?.publicKey).toBe(w1.publicKey);
      expect(store.wallets[1]?.publicKey).toBe(w2.publicKey);
    });
  });
});
