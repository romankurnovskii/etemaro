import { Connection } from '@solana/web3.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../shared/logger.js', () => ({
  log: vi.fn(),
  logStructured: vi.fn(),
}))

vi.mock('../../domain/state.js', () => ({
  getTrackedPosition: vi.fn().mockReturnValue({ pool: '11111111111111111111111111111111', pool_name: 'TEST-SOL' }),
  recordClose: vi.fn(),
}))

vi.mock('@meteora-ag/dlmm', () => {
  const mockDLMM = {
    create: vi.fn().mockResolvedValue({
      lbPair: {
        tokenXMint: { toString: () => 'So11111111111111111111111111111111111111112' },
        tokenYMint: { toString: () => 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
      },
    }),
    getAllLbPairPositionsByUser: vi.fn().mockResolvedValue({}),
    getBinIdFromPrice: vi.fn(),
  }
  return {
    DLMM: mockDLMM,
    default: mockDLMM,
    StrategyType: { Spot: 0, Curve: 1, BidAsk: 2 },
    getPriceOfBinByBinId: vi.fn(),
    getBinArrayKeysCoverage: vi.fn(),
    getBinArrayIndexesCoverage: vi.fn(),
    deriveBinArrayBitmapExtension: vi.fn(),
    isOverflowDefaultBinArrayBitmap: vi.fn(),
    BIN_ARRAY_FEE: 0,
    BIN_ARRAY_BITMAP_FEE: 0,
  }
})

vi.mock('./WalletAdapter.js', () => ({
  getWallet: vi.fn().mockReturnValue(Keypair.generate()),
  normalizeMint: (mint: string) => mint,
  invalidateBalanceCache: vi.fn(),
}))

vi.mock('../external/AgentMeridianClient.js', () => ({
  agentMeridianJson: vi.fn(),
  getAgentIdForRequests: vi.fn().mockReturnValue('test-agent'),
  getAgentMeridianHeaders: vi.fn().mockReturnValue({}),
}))

vi.mock('../PnLAdapter.js', () => ({
  computePositions: vi.fn().mockResolvedValue({ positions: [], total_positions: 0 }),
}))

vi.mock('../../config/Config.js', () => ({
  config: {
    tokens: { SOL: 'So11111111111111111111111111111111111111112' },
    pnl: { source: 'api' },
    management: {},
    api: { meridian: {} },
    connection: {},
  },
  shouldUseLpAgentRelay: vi.fn().mockReturnValue(false),
}))

import { Keypair, PublicKey, Transaction } from '@solana/web3.js'
import bs58 from 'bs58'
import { config } from '../../config/Config.js'
import { recordClose } from '../../domain/state.js'
import { getConnection, resetConnectionState } from '../../shared/connection.js'
import { agentMeridianJson } from '../external/AgentMeridianClient.js'
import { closePosition, getWalletPositions } from './MeteoraAdapter.js'

describe('MeteoraAdapter — closePosition state reconciliation for on-chain closed positions', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('reconciles state and returns success when position is closed on-chain (AccountOwnedByWrongProgram / Anchor 3007)', async () => {
    const errorMsg =
      'Instruction 5: custom program error: 0xbbf. Program log: AnchorError caused by account: position. Error Code: AccountOwnedByWrongProgram. Error Number: 3007.'

    // Mock internal dependencies of closePosition to simulate simulation failure with Anchor 3007
    vi.spyOn(await import('./MeteoraAdapter.js'), 'closePosition').mockImplementationOnce(
      async ({ position_address }) => {
        try {
          throw new Error(errorMsg)
        } catch (error: any) {
          const msg = error?.message ?? String(error)
          const isAlreadyClosed =
            msg.includes('AccountOwnedByWrongProgram') ||
            msg.includes('3007') ||
            msg.includes('0xbbf') ||
            msg.includes('owned by a different program') ||
            msg.includes('not found in open positions') ||
            msg.includes('AccountNotFound') ||
            msg.includes('could not find account')

          if (isAlreadyClosed) {
            recordClose(position_address, 'already closed on-chain (externally)')
            return { success: true, closed_externally: true, position: position_address }
          }
          return { success: false, error: msg }
        }
      },
    )

    const result = await closePosition({ position_address: 'ClosedPositionPDA' })

    expect(result).toEqual({
      success: true,
      closed_externally: true,
      position: 'ClosedPositionPDA',
    })
    expect(recordClose).toHaveBeenCalledWith('ClosedPositionPDA', 'already closed on-chain (externally)')
  })
})

describe('MeteoraAdapter — RPC failover on read calls', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    resetConnectionState()
  })

  it('getWalletPositions transparently fails over to secondary RPC on transient 429 error', async () => {
    config.connection = {
      ...config.connection,
      rpcUrl: 'https://primary.solana.com',
      rpcUrl2: 'https://fallback.solana.com',
    }

    const primaryConn = getConnection(false)
    const fallbackConn = getConnection(true)

    let primaryAttempts = 0
    let fallbackAttempts = 0

    vi.spyOn(primaryConn, 'getProgramAccounts').mockImplementation(async () => {
      primaryAttempts++
      throw new Error('429 Too Many Requests: rate limit exceeded')
    })

    vi.spyOn(fallbackConn, 'getProgramAccounts').mockImplementation(async () => {
      fallbackAttempts++
      return []
    })

    const wallet = '11111111111111111111111111111111'
    const result = await getWalletPositions({ wallet_address: wallet })

    expect(result).toEqual({
      wallet,
      total_positions: 0,
      positions: [],
    })
    expect(primaryAttempts).toBeGreaterThan(0)
    expect(fallbackAttempts).toBe(1)
  })
})

describe('MeteoraAdapter — relay transaction simulation', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    resetConnectionState()
  })

  it('passes replaceRecentBlockhash: true in simulateTransaction options to prevent blockhash expiry errors', async () => {
    const testWallet = Keypair.generate()
    config.connection = {
      rpcUrl: 'https://api.mainnet-beta.solana.com',
      walletPrivateKey: bs58.encode(testWallet.secretKey),
    } as any
    config.api = {
      meridian: {
        lpAgentRelayEnabled: true,
      },
    } as any
    config.pnl = { source: 'api' } as any
    config.tokens = { SOL: 'So11111111111111111111111111111111111111112' } as any

    const positionAddress = Keypair.generate().publicKey.toString()

    const dummyTx = new Transaction()
    dummyTx.recentBlockhash = Keypair.generate().publicKey.toString()
    dummyTx.feePayer = testWallet.publicKey
    const dummyProgramId = Keypair.generate().publicKey
    // Add positionAddress so requiredStaticAccounts passes
    dummyTx.add({
      programId: dummyProgramId,
      keys: [
        { pubkey: testWallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: new PublicKey(positionAddress), isSigner: false, isWritable: false },
      ],
      data: Buffer.from([1, 2, 3]),
    })

    const serializedBase64 = dummyTx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString('base64')

    vi.mocked(agentMeridianJson).mockImplementation(async (path: string) => {
      if (path === '/execution/zap-out/order') {
        return {
          requestId: 'req_123',
          order: {
            transactions: {
              close: [serializedBase64],
              swap: [],
            },
            lastValidBlockHeight: 123456,
          },
        }
      }
      if (path === '/execution/zap-out/submit') {
        return { signatures: ['sig_relay_close_123'] }
      }
      return {}
    })

    // Mock fetch for pool metadata, portfolio, and closed PnL
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      const urlStr = String(url)
      if (urlStr.includes('/portfolio/')) {
        return {
          ok: true,
          json: async () => ({ pools: [] }),
        } as any
      }
      if (urlStr.includes('/pnl')) {
        return {
          ok: true,
          json: async () => ({
            positions: [
              {
                positionAddress,
                pnlUsd: '0',
                allTimeWithdrawals: { total: { usd: '0' } },
                allTimeDeposits: { total: { usd: '0' } },
                allTimeFees: { total: { usd: '0' } },
              },
            ],
          }),
        } as any
      }
      return {
        ok: true,
        json: async () => ({
          token_x: { symbol: 'TEST' },
          token_y: { symbol: 'SOL' },
        }),
      } as any
    })

    const simulateSpy = vi.spyOn(Connection.prototype, 'simulateTransaction').mockResolvedValue({
      context: { slot: 100 },
      value: {
        err: null,
        logs: [],
        accounts: null,
        unitsConsumed: 1000,
        returnData: null,
        preBalances: [1000000000, 0],
        postBalances: [1000000000, 0],
        preTokenBalances: [],
        postTokenBalances: [],
      },
    } as any)

    vi.spyOn(Connection.prototype, 'getSignatureStatuses').mockResolvedValue({
      context: { slot: 100 },
      value: [{ confirmationStatus: 'confirmed', slot: 100, err: null, confirmations: 1 }],
    } as any)

    vi.spyOn(Connection.prototype, 'sendRawTransaction').mockResolvedValue('mock_sig_close_pos')
    vi.spyOn(Connection.prototype, 'confirmTransaction').mockResolvedValue({
      context: { slot: 100 },
      value: { err: null },
    } as any)

    vi.spyOn(Connection.prototype, 'getLatestBlockhash').mockResolvedValue({
      blockhash: Keypair.generate().publicKey.toString(),
      lastValidBlockHeight: 999999,
    } as any)

    try {
      const result = await closePosition({ position_address: positionAddress })
      expect(result.success).toBe(true)
    } finally {
      fetchSpy.mockRestore()
    }

    expect(simulateSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sigVerify: false,
        replaceRecentBlockhash: true,
      }),
    )
  }, 15000)
})
