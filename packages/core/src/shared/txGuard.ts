/**
 * @file txGuard.ts
 * @description Pre-signing safety checks for transactions built by an external service.
 *
 * @features
 * - Decodes SystemProgram transfers and rejects SOL leaving the owner to an unknown destination
 * - Dry-runs an unsigned transaction and rejects on simulation error
 * - Caps the owner's SOL loss and rejects debits of mints outside the expected pair
 * - Requires the requested output mint to be credited back to the owner
 *
 * @dependencies @solana/web3.js, shared/connection, shared/constants
 * @sideEffects Read-only Solana RPC simulation (nothing is broadcast)
 */

import {
  type Keypair,
  PublicKey,
  SystemInstruction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from '@solana/web3.js'
import { withRpcFailover } from './connection.js'
import { TOKEN_MINTS } from './constants.js'

const SOL_MINT = TOKEN_MINTS.SOL
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')

/**
 * Raised when a transaction fails a pre-signing safety check. Callers must not
 * sign or broadcast the transaction when this is thrown.
 */
export class UnsafeTransactionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeTransactionError'
  }
}

/** Derives the canonical associated token account for `owner` and `mint`. */
export function deriveAssociatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0]
}

export function signSerializedTransaction(serialized: string, wallet: Keypair): string {
  const bytes = Buffer.from(serialized, 'base64')
  try {
    const versioned = VersionedTransaction.deserialize(bytes)
    versioned.sign([wallet])
    return Buffer.from(versioned.serialize()).toString('base64')
  } catch {
    const legacy = Transaction.from(bytes)
    legacy.partialSign(wallet)
    return legacy.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64')
  }
}

export function deserializeSignedTransaction(signedBase64: string): Transaction | VersionedTransaction {
  const bytes = Buffer.from(signedBase64, 'base64')
  try {
    return VersionedTransaction.deserialize(bytes)
  } catch {
    return Transaction.from(bytes)
  }
}

export function getStaticAccountKeyStrings(tx: Transaction | VersionedTransaction): string[] {
  if (tx instanceof VersionedTransaction) {
    return tx.message.staticAccountKeys.map((key: PublicKey) => key.toString())
  }
  return tx.compileMessage().accountKeys.map((key: PublicKey) => key.toString())
}

export function getTransactionInstructions(tx: Transaction | VersionedTransaction): TransactionInstruction[] {
  if (!(tx instanceof VersionedTransaction)) return tx.instructions

  const keys = tx.message.staticAccountKeys
  return tx.message.compiledInstructions
    .map((ix: any) => {
      const programId = keys[ix.programIdIndex]
      if (!programId) return null
      const indexes = ix.accountKeyIndexes || ix.accounts || []
      const accounts = indexes.map((accountIndex: number) => keys[accountIndex]).filter(Boolean)
      return new TransactionInstruction({
        programId,
        keys: accounts.map((pubkey: PublicKey) => ({
          pubkey,
          isSigner: false,
          isWritable: false,
        })),
        data: Buffer.from(ix.data),
      })
    })
    .filter(Boolean) as TransactionInstruction[]
}

/**
 * Rejects any SystemProgram transfer that moves SOL from `wallet` to a destination
 * outside `allowedDestinations`. Only SystemProgram is decoded, so this does not
 * catch SPL-token drains — pair it with a balance-delta simulation.
 */
export function assertNoUnsafeSystemTransfer(
  tx: Transaction | VersionedTransaction,
  wallet: Keypair,
  allowedDestinations: string[] = [],
): void {
  const owner = wallet.publicKey.toString()
  const allowed = new Set(allowedDestinations.filter(Boolean).map(String))

  for (const ix of getTransactionInstructions(tx)) {
    if (!ix.programId.equals(SystemProgram.programId)) continue

    let type: string
    try {
      type = SystemInstruction.decodeInstructionType(ix)
    } catch {
      continue
    }
    if (type !== 'Transfer' && type !== 'TransferWithSeed') continue

    const decoded =
      type === 'Transfer' ? SystemInstruction.decodeTransfer(ix) : SystemInstruction.decodeTransferWithSeed(ix)
    const source = decoded.fromPubkey?.toString()
    const destination = decoded.toPubkey?.toString()
    if (source === owner && !allowed.has(destination!)) {
      throw new UnsafeTransactionError(
        `Transaction contains direct SOL transfer from owner to ${destination?.slice(0, 8) || 'unknown'}.`,
      )
    }
  }
}

export interface SwapGuardOptions {
  /** Mint the caller asked to sell. */
  inputMint: string
  /** Mint the caller asked to buy. */
  outputMint: string
  /** Maximum SOL the owner may lose, in SOL. Defaults to 0.01 (fees only). */
  maxSolLoss?: number
}

function isSolMint(mint: string): boolean {
  return mint === SOL_MINT || mint === 'SOL'
}

/**
 * Verifies an externally-built swap transaction before it is signed.
 *
 * Composes a static SystemProgram check with a dry run of the unsigned transaction:
 * the dry run must succeed, the owner's SOL loss must stay within `maxSolLoss`, no
 * mint outside `{inputMint, outputMint}` may be debited, and the requested output
 * mint must be credited back to the owner. Throws {@link UnsafeTransactionError}
 * on any violation; the caller must not sign when it throws.
 */
export async function assertSafeSwapTransaction(
  tx: Transaction | VersionedTransaction,
  wallet: Keypair,
  { inputMint, outputMint, maxSolLoss = 0.01 }: SwapGuardOptions,
): Promise<void> {
  const owner = wallet.publicKey.toString()
  const input = String(inputMint || '')
  const output = String(outputMint || '')
  const allowedMints = new Set([input, output].filter(Boolean))
  const maxLamportLoss = Math.floor(Number(maxSolLoss) * 1e9)

  // 1. Static check: no direct SOL transfer from the owner to an unknown destination.
  //    A SOL-input swap legitimately moves SOL into the owner's wrapped-SOL account.
  assertNoUnsafeSystemTransfer(tx, wallet, [
    owner,
    deriveAssociatedTokenAddress(wallet.publicKey, new PublicKey(SOL_MINT)).toString(),
  ])

  // 2. Dry-run the unsigned transaction.
  const staticKeys = getStaticAccountKeyStrings(tx)
  const ownerIndex = staticKeys.indexOf(owner)
  const simulation: any = await withRpcFailover(
    (conn) =>
      (conn as any).simulateTransaction(tx, {
        sigVerify: false,
        replaceRecentBlockhash: true,
      }),
    { label: 'simulateSwapTransaction' },
  )
  const value = simulation?.value
  if (!value) {
    throw new UnsafeTransactionError('Swap transaction simulation returned no result.')
  }
  if (value.err) {
    throw new UnsafeTransactionError(`Swap transaction simulation failed: ${JSON.stringify(value.err)}`)
  }

  // 3. Cap the owner's SOL loss.
  let lamportDelta = 0
  if (ownerIndex >= 0 && value.preBalances?.[ownerIndex] != null && value.postBalances?.[ownerIndex] != null) {
    lamportDelta = value.postBalances[ownerIndex] - value.preBalances[ownerIndex]
    if (lamportDelta < -maxLamportLoss) {
      throw new UnsafeTransactionError(
        `Swap would debit ${(Math.abs(lamportDelta) / 1e9).toFixed(6)} SOL from the wallet (limit ${maxSolLoss} SOL).`,
      )
    }
  }

  // 4. Only the expected pair may move: any other mint debited is a drain.
  const preByMint = new Map<string, bigint>()
  for (const balance of value.preTokenBalances || []) {
    if (balance.owner !== owner) continue
    preByMint.set(balance.mint, BigInt(balance.uiTokenAmount?.amount || '0'))
  }
  const postByMint = new Map<string, bigint>()
  for (const balance of value.postTokenBalances || []) {
    if (balance.owner !== owner) continue
    postByMint.set(balance.mint, BigInt(balance.uiTokenAmount?.amount || '0'))
  }
  for (const [mint, preAmount] of preByMint) {
    const postAmount = postByMint.get(mint) ?? 0n
    if (postAmount < preAmount && !allowedMints.has(mint)) {
      throw new UnsafeTransactionError(`Swap would debit unrelated token mint ${mint}.`)
    }
  }

  // 5. The requested output must land in the owner's wallet.
  if (isSolMint(output)) {
    const wsolPre = preByMint.get(SOL_MINT) ?? 0n
    const wsolPost = postByMint.get(SOL_MINT) ?? 0n
    if (lamportDelta <= 0 && wsolPost <= wsolPre) {
      throw new UnsafeTransactionError('Swap would not credit SOL back to the wallet.')
    }
  } else {
    const preAmount = preByMint.get(output) ?? 0n
    const postAmount = postByMint.get(output) ?? 0n
    if (postAmount <= preAmount) {
      throw new UnsafeTransactionError(`Swap would not credit output mint ${output} to the wallet.`)
    }
  }
}
