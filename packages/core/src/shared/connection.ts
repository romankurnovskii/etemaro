/**
 * @file connection.ts
 * @description Centralized Solana RPC connection and wallet manager.
 * Uses config.connection as the single source of truth with automatic RPC fallback support.
 */

import { Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { config } from '../config/Config.js';

let _primaryConnection: Connection | null = null;
let _primaryRpcUrl: string | null = null;

let _fallbackConnection: Connection | null = null;
let _fallbackRpcUrl: string | null = null;

let _walletKeypair: Keypair | null = null;
let _walletPrivateKey: string | null = null;

/**
 * Returns the configured primary or fallback RPC URL.
 * Reads from config.connection with env var fallback.
 */
export function getRpcUrl(fallback = false): string {
  if (fallback && config.connection?.rpcUrl2) {
    return config.connection.rpcUrl2;
  }
  if (fallback && process.env.RPC_URL_2) {
    return process.env.RPC_URL_2;
  }
  return config.connection?.rpcUrl || process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
}

/**
 * Returns a cached Connection instance for primary or fallback RPC endpoint.
 * Dynamically re-initializes if configuration changes.
 */
export function getConnection(fallback = false): Connection {
  const rpc = getRpcUrl(fallback);
  if (fallback) {
    if (!_fallbackConnection || _fallbackRpcUrl !== rpc) {
      _fallbackConnection = new Connection(rpc, 'confirmed');
      _fallbackRpcUrl = rpc;
    }
    return _fallbackConnection;
  }
  if (!_primaryConnection || _primaryRpcUrl !== rpc) {
    _primaryConnection = new Connection(rpc, 'confirmed');
    _primaryRpcUrl = rpc;
  }
  return _primaryConnection;
}

/**
 * Returns the Keypair for the configured wallet.
 * Reads private key from config.connection.walletPrivateKey with WALLET_PRIVATE_KEY fallback.
 */
export function getWalletKeypair(): Keypair {
  const key = config.connection?.walletPrivateKey || process.env.WALLET_PRIVATE_KEY;
  if (!key) {
    throw new Error('Wallet private key is not configured. Set connection.walletPrivateKey in config or WALLET_PRIVATE_KEY in env.');
  }
  if (!_walletKeypair || _walletPrivateKey !== key) {
    _walletKeypair = Keypair.fromSecretKey(bs58.decode(key));
    _walletPrivateKey = key;
  }
  return _walletKeypair;
}

/**
 * Returns the public key (base58) of the configured wallet, or null if unconfigured.
 */
export function getWalletAddress(): string | null {
  try {
    return getWalletKeypair().publicKey.toString();
  } catch {
    return null;
  }
}

/**
 * Resets cached connection and wallet singletons (primarily used for test isolation).
 */
export function resetConnectionState(): void {
  _primaryConnection = null;
  _primaryRpcUrl = null;
  _fallbackConnection = null;
  _fallbackRpcUrl = null;
  _walletKeypair = null;
  _walletPrivateKey = null;
}
