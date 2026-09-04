/**
 * @file Daemon.ts
 * @description Long-running background daemon managing autonomous cron cycles, REPL prompt, Telegram bot, and PnL polling.
 *
 * @features
 * - Orchestrates cron cycles (screening every 30m, management every 10m, health checks)
 * - Manages interactive REPL terminal prompt with cycle countdowns
 * - Initializes Telegram bot polling and HiveMind background sync
 *
 * @dependencies node-cron, Config, Adapters, TelegramAdapter, HivemindAdapter
 * @sideEffects Long-running process, background cron jobs, and socket/polling listeners
 */

import dotenv from 'dotenv'

dotenv.config({ override: true })

import fs from 'node:fs'
import path from 'node:path'
import * as readline from 'node:readline'
import {
  type AgentLoopDeps,
  type AgentMessage,
  agentLoop,
  briefing,
  computeDeployAmount,
  config,
  confirmPeak,
  DECISION_LOG_FILENAME,
  DEFAULT_ENTRY_SOURCE,
  DEV_BLOCKLIST_FILENAME,
  dataPath,
  desktop,
  domain,
  getDataDir,
  getLastBriefingDate,
  getTrackedPosition,
  getTrackedPositions,
  hivemind,
  isPnlSuspect,
  loadJsonFile,
  loadJsonFileWithInfo,
  log,
  meteora,
  registerExitSignal,
  repoPath,
  SHARED_STRATEGY_LIB_FILENAME,
  SMART_WALLETS_FILENAME,
  STATE_FILENAME,
  STRATEGY_LIB_FILENAME,
  saveJsonFile,
  screening,
  setLastBriefingDate,
  setPositionInstruction,
  sharedConfigPath,
  sharedDataPath,
  strategyLibraryPath,
  TELEGRAM_QUEUE_FILENAME,
  TOKEN_BLACKLIST_FILENAME,
  telegram,
  token,
  toolExecutor,
  tools,
  USER_CONFIG_PATH,
  updatePnlAndCheckExits,
  wallet,
} from '@etemaro/core'
import cron from 'node-cron'
// These will be injected or resolved at runtime by the adapter layer.

export interface DaemonAdapters {
  meteora: {
    getMyPositions: (opts?: {
      force?: boolean
      silent?: boolean
    }) => Promise<{ positions: any[]; total_positions: number }>
    closePosition: (opts: { position_address: string }) => Promise<any>
    getActiveBin: (opts: { pool_address: string }) => Promise<any>
  }
  wallet: {
    getWalletBalances: () => Promise<any>
    getSolPrice?: (opts?: { force?: boolean }) => Promise<number | null>
  }
  screening: {
    getTopCandidates: (opts: { limit: number }) => Promise<any>
    degenScore: (pool: any, opts?: any) => number
    getPoolDetail: (opts: any) => Promise<any>
  }
  toolExecutor: {
    executeTool: (name: string, args: Record<string, unknown>) => Promise<any>
    registerCronRestarter: (fn: () => void) => void
  }
  telegram: {
    startPolling: (handler: (msg: any) => Promise<void>) => void
    stopPolling: () => void
    sendMessage: (text: string) => Promise<any>
    sendMessageWithButtons: (text: string, buttons: any[]) => Promise<any>
    editMessage: (text: string, messageId: number) => Promise<any>
    editMessageWithButtons: (text: string, messageId: number, buttons: any[]) => Promise<any>
    answerCallbackQuery: (queryId: string, text?: string) => Promise<any>
    notifyOutOfRange: (data: { pair: string; minutesOOR: number }) => Promise<any>
    notifyTransactionError?: (data: {
      type: 'deploy' | 'close' | 'claim' | 'swap' | 'confirm'
      pair?: string
      position?: string
      tx?: string
      reason: string
    }) => Promise<any>
    isEnabled: () => boolean
    createLiveMessage: (title: string, body: string) => Promise<any>
  }
  desktop?: {
    startServer: (handler: (msg: any) => Promise<any>, port?: number) => void
    stopServer: () => void
    isEnabled: () => boolean
    sendMessage: (text: string) => Promise<any>
    createLiveMessage: (title: string, body: string) => Promise<any>
  }
  briefing: {
    generateBriefing: (opts?: { solPrice?: number }) => Promise<string>
  }
  hivemind: {
    bootstrapHiveMind: () => Promise<any>
    ensureAgentId: () => string
    getHiveMindPullMode: () => string
    isHiveMindEnabled: () => boolean
    pullHiveMindLessons: (hours: number) => Promise<any>
    pullHiveMindPresets: () => Promise<any>
    registerHiveMindAgent: (opts: any) => Promise<any>
    startHiveMindBackgroundSync: () => void
  }
  domain: {
    validateActiveStrategy: () => void
    getActiveStrategy: () => any
    listStrategies?: () => Record<string, unknown>
    recordPositionSnapshot: (pool: string, position: any) => void
    recallForPool: (pool: string) => string | null
    addPoolNote: (pool: string, note: string) => void
    checkSmartWalletsOnPool: (opts: { pool_address: string }) => Promise<any>
    getTokenNarrative: (opts: { mint: string }) => Promise<any>
    getTokenInfo: (opts: { query: string }) => Promise<any>
    stageSignals: (pool: string, signals: Record<string, unknown>) => void
    getWeightsSummary: () => string
    appendDecision: (entry: any) => void
    parseRejectedCandidates?: (content: string) => string[]
  }
  agentLoopDeps: AgentLoopDeps
}

// ─── Deterministic Close Rule ───────────────────────────────────

interface DeterministicCloseResult {
  action: 'CLOSE'
  rule: number
  reason: string
}

export function getDeterministicCloseRule(
  position: any,
  managementConfig: typeof config.management,
): DeterministicCloseResult | null {
  const tracked = getTrackedPosition(position.position)
  const pnlSuspect = isPnlSuspect(position, tracked?.amount_sol)

  if (!pnlSuspect && position.pnl_pct != null && position.pnl_pct <= managementConfig.stopLossPct) {
    return {
      action: 'CLOSE',
      rule: 1,
      reason: `stop loss (pnl=${position.pnl_pct.toFixed(2)}% threshold=${managementConfig.stopLossPct}%)`,
    }
  }
  // Rule 2: Take Profit.
  // Take-Profit Inversion Protection: When pnl_pct triggers on estimated bin/fee ratios,
  // ensure the position's dollar PnL (pnl_usd) is not negative. This prevents premature
  // exits during micro-fluctuations where on-chain withdrawal slippage / price drops would
  // turn an estimated +0.2% into a net loss (e.g. HeeHaw-SOL -$0.74, OTC-SOL -$0.14).
  if (
    !pnlSuspect &&
    position.pnl_pct != null &&
    position.pnl_pct >= managementConfig.takeProfitPct &&
    (position.pnl_usd == null || position.pnl_usd > 0)
  ) {
    return {
      action: 'CLOSE',
      rule: 2,
      reason: `take profit (pnl=${position.pnl_pct.toFixed(2)}% threshold=${managementConfig.takeProfitPct}%)`,
    }
  }
  if (
    position.active_bin != null &&
    position.upper_bin != null &&
    position.active_bin > position.upper_bin + managementConfig.outOfRangeBinsToClose
  ) {
    return {
      action: 'CLOSE',
      rule: 3,
      reason: `pumped far above range (active_bin=${position.active_bin} upper_bin=${position.upper_bin} threshold=+${managementConfig.outOfRangeBinsToClose} bins)`,
    }
  }
  if (
    position.active_bin != null &&
    position.upper_bin != null &&
    position.active_bin > position.upper_bin &&
    (position.minutes_out_of_range ?? 0) >= managementConfig.outOfRangeWaitMinutes
  ) {
    return {
      action: 'CLOSE',
      rule: 4,
      reason: `OOR (active_bin=${position.active_bin} upper_bin=${position.upper_bin} oor_minutes=${position.minutes_out_of_range ?? 0} threshold=${managementConfig.outOfRangeWaitMinutes}m)`,
    }
  }
  if (
    position.fee_per_tvl_24h != null &&
    position.fee_per_tvl_24h < managementConfig.minFeePerTvl24h &&
    (position.age_minutes ?? 0) >= 60
  ) {
    return {
      action: 'CLOSE',
      rule: 5,
      reason: `low yield (fee/tvl_24h=${position.fee_per_tvl_24h.toFixed(2)}% threshold=${managementConfig.minFeePerTvl24h}% age=${position.age_minutes ?? '?'}m min_age=${managementConfig.minAgeBeforeYieldCheck ?? 60}m)`,
    }
  }
  return null
}

// ─── Helper Functions ───────────────────────────────────────────

/** Strip <think>...</think> reasoning blocks that some models leak into output */
function stripThink(text: string | null | undefined): string {
  if (!text) return text ?? ''
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

function sanitizeUntrustedPromptText(text: unknown, maxLen = 500): string | null {
  if (!text) return null
  const cleaned = String(text)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[<>`]/g, '')
    .trim()
    .slice(0, maxLen)
  return cleaned ? JSON.stringify(cleaned) : null
}

function fmtPct(value: unknown): string {
  const n = Number(value)
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : '?'
}

function computeBinsBelow(volatility: unknown): number {
  const parsedVolatility = Number(volatility)
  if (!Number.isFinite(parsedVolatility) || parsedVolatility <= 0) {
    throw new Error(`Invalid volatility ${volatility ?? 'unknown'} — refusing volatility-scaled deploy.`)
  }
  const lo = config.strategy.minBinsBelow
  const hi = config.strategy.maxBinsBelow
  return Math.max(lo, Math.min(hi, Math.round(lo + (parsedVolatility / 5) * (hi - lo))))
}

function parseConfigValue(raw: string): unknown {
  const value = String(raw ?? '').trim()
  if (!value.length) return ''
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true'
  if (/^null$/i.test(value)) return null
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  if ((value.startsWith('[') && value.endsWith(']')) || (value.startsWith('{') && value.endsWith('}'))) {
    return JSON.parse(value)
  }
  return value
}

// ─── Daemon Class ───────────────────────────────────────────────

export class Daemon {
  private adapters: DaemonAdapters // Dependency injection container for blockchain, messaging, and system adapters

  // Race condition guards
  private managementBusy = false // Guards position management cycle & PnL exit executions from concurrency
  private screeningBusy = false // Guards token screening & evaluation cycles from overlapping
  private screeningLastTriggered = 0 // Epoch timestamp (ms) of last screening; enforces post-management cooldown
  private pnlPollBusy = false // Guards high-frequency PnL poller ticks to prevent parallel on-chain queries
  private opportunityPollBusy = false // Guards background opportunity/smart-wallet detection polling cycles
  private busy = false // Guards interactive REPL terminal commands and free-form LLM chat sessions
  private shuttingDown = false // Set on SIGINT/SIGTERM or /stop; suppresses new cycles & aborts queue processing
  private draining = false // Single-flight guard ensuring only one loop drains the Telegram queue at a time
  private cronStarted = false // Tracks whether autonomous cron schedules and poller timers are running

  // Cron tasks
  private cronTasks: cron.ScheduledTask[] = []
  private pnlPollInterval: ReturnType<typeof setInterval> | null = null
  private opportunityPollInterval: ReturnType<typeof setInterval> | null = null

  // Cycle timers
  private managementLastRun: number | null = null
  private screeningLastRun: number | null = null

  // Telegram queue
  private telegramQueue: any[] = []
  private telegramDrainInterval: ReturnType<typeof setInterval> | null = null
  private readonly MAX_TELEGRAM_QUEUE = 5

  // REPL
  private ttyInterface: readline.Interface | null = null
  private sessionHistory: AgentMessage[] = []
  private readonly MAX_HISTORY = 20

  // Latest candidates cache
  private latestCandidates: any[] = []
  private latestCandidatesAt: string | null = null

  /**
   * Synchronous atomic check-and-set lock acquisition for daemon async cycles.
   * Prevents overlapping timer ticks or event-loop delays from entering guarded sections concurrently.
   */
  private acquireLock(lockName: 'management' | 'screening' | 'pnlPoll' | 'opportunityPoll'): boolean {
    if (this.shuttingDown) return false
    switch (lockName) {
      case 'management':
        if (this.managementBusy || this.pnlPollBusy) return false
        this.managementBusy = true
        return true
      case 'screening':
        if (this.screeningBusy) return false
        this.screeningBusy = true
        return true
      case 'pnlPoll':
        if (this.managementBusy || this.screeningBusy || this.pnlPollBusy) return false
        this.pnlPollBusy = true
        return true
      case 'opportunityPoll':
        if (this.screeningBusy || this.managementBusy || this.pnlPollBusy || this.opportunityPollBusy) return false
        this.opportunityPollBusy = true
        return true
    }
  }

  /**
   * Synchronous lock release helper.
   */
  private releaseLock(lockName: 'management' | 'screening' | 'pnlPoll' | 'opportunityPoll'): void {
    switch (lockName) {
      case 'management':
        this.managementBusy = false
        break
      case 'screening':
        this.screeningBusy = false
        break
      case 'pnlPoll':
        this.pnlPollBusy = false
        break
      case 'opportunityPoll':
        this.opportunityPollBusy = false
        break
    }
    this.drainTelegramQueue().catch((err: any) => {
      log('telegram_warn', `Failed to drain telegram queue after releasing ${lockName} lock: ${err?.message || err}`)
    })
  }

  // Countdown timer
  private countdownInterval: ReturnType<typeof setInterval> | null = null

  constructor(adapters: DaemonAdapters) {
    this.adapters = adapters
  }

  // ─── Lifecycle ─────────────────────────────────────────────────

  async start(options: { tty?: boolean } = {}): Promise<void> {
    log('startup', 'DLMM LP Agent starting...')
    log('startup', `Repo: ${process.cwd()}`)

    // === Config Source & Mode ===
    const dataDir = getDataDir()
    const dataDirSource = process.env.ETEMARO_DATA_DIR
      ? 'ETEMARO_DATA_DIR'
      : process.env.DATA_DIR
        ? 'DATA_DIR'
        : 'default <repo>/data'

    // Config file source - single source of truth from config system
    const configSource = process.env.USER_CONFIG_PATH ? 'USER_CONFIG_PATH env var' : 'default'
    log('startup', `Config: ${USER_CONFIG_PATH} (source: ${configSource})`)

    // Active strategy info
    const configuredStrategyId = config.strategy?.activeStrategyId
    const activeStrategy = this.adapters.domain.getActiveStrategy()
    const strategyStatus = activeStrategy
      ? configuredStrategyId && activeStrategy.id === configuredStrategyId
        ? 'found'
        : 'resolved fallback'
      : configuredStrategyId
        ? `not found for ID '${configuredStrategyId}'`
        : 'none configured'
    log(
      'startup',
      `Strategy: ${activeStrategy?.name || configuredStrategyId || 'none'} (ID: ${activeStrategy?.id || configuredStrategyId || 'none'}, status: ${strategyStatus})`,
    )

    // Entry source and opportunity poller status
    const entrySource = config.screening?.entrySource || DEFAULT_ENTRY_SOURCE
    const opportunityEnabled = config.opportunity?.enabled ?? false
    log('startup', `Entry source: ${entrySource}`)
    log('startup', `Opportunity poller: ${opportunityEnabled ? 'enabled' : 'disabled'}`)

    log('startup', `Data: ${dataDir} (${dataDirSource})`)
    log('startup', `Mode: ${config.connection.dryRun ? 'DRY RUN' : 'LIVE'}`)
    log('startup', `Model: ${config.llm.defaultModel}`)

    // === Resolved Data Paths & Counts ===
    const smartWalletsPath = sharedConfigPath(SMART_WALLETS_FILENAME)
    const smartWalletsInfo = loadJsonFileWithInfo<{ wallets?: unknown[] }>(smartWalletsPath, { wallets: [] })
    const smartWalletsLoaded = smartWalletsInfo.loadedFrom === 'file'
    const smartWalletsCount = smartWalletsInfo.data.wallets?.length || 0
    log(
      'startup',
      `${SMART_WALLETS_FILENAME}: ${smartWalletsPath} (${smartWalletsLoaded ? 'found' : 'fallback/created'}, ${smartWalletsCount} wallets)`,
    )

    // Strategy libraries (Chapter 7: global shared knowledge in config/shared/)
    const privateLibPath = sharedConfigPath(STRATEGY_LIB_FILENAME)
    const privateLibInfo = loadJsonFileWithInfo<{ strategies?: Record<string, unknown> }>(privateLibPath, {
      strategies: {},
    })
    const privateCount = Object.keys(privateLibInfo.data.strategies || {}).length
    const privateLoaded = privateLibInfo.loadedFrom === 'file'

    let sharedLibPath = sharedConfigPath(SHARED_STRATEGY_LIB_FILENAME)
    let sharedLibInfo = loadJsonFileWithInfo<{ strategies?: Record<string, unknown> }>(sharedLibPath, {
      strategies: {},
    })
    if (sharedLibInfo.loadedFrom !== 'file') {
      const localShared = strategyLibraryPath(SHARED_STRATEGY_LIB_FILENAME)
      if (fs.existsSync(localShared)) {
        sharedLibPath = localShared
        sharedLibInfo = loadJsonFileWithInfo<{ strategies?: Record<string, unknown> }>(localShared, { strategies: {} })
      }
    }
    const sharedCount = Object.keys(sharedLibInfo.data.strategies || {}).length
    const sharedLoaded = sharedLibInfo.loadedFrom === 'file'

    const allStrategies = this.adapters.domain.listStrategies ? (this.adapters.domain.listStrategies() as any) : null
    const totalCount = allStrategies?.count ?? privateCount + (sharedLoaded ? sharedCount : 10)

    log(
      'startup',
      `${STRATEGY_LIB_FILENAME}: ${privateLibPath} (${privateLoaded ? 'found' : 'none'}, ${privateCount} strategies)`,
    )
    log(
      'startup',
      `${SHARED_STRATEGY_LIB_FILENAME}: ${sharedLibPath} (${sharedLoaded ? 'found' : 'defaults'}, ${sharedCount || 10} strategies) [total available: ${totalCount}]`,
    )

    const tokenBlacklistPath = sharedConfigPath(TOKEN_BLACKLIST_FILENAME)
    const tokenBlacklistInfo = loadJsonFileWithInfo<Record<string, unknown>>(tokenBlacklistPath, {})
    const tokenBlacklistLoaded = tokenBlacklistInfo.loadedFrom === 'file'
    const tokenBlacklistCount = Object.keys(tokenBlacklistInfo.data || {}).length
    log(
      'startup',
      `${TOKEN_BLACKLIST_FILENAME}: ${tokenBlacklistPath} (${tokenBlacklistLoaded ? 'found' : 'fallback'}, ${tokenBlacklistCount} items)`,
    )

    const devBlocklistPath = sharedConfigPath(DEV_BLOCKLIST_FILENAME)
    const devBlocklistInfo = loadJsonFileWithInfo<Record<string, unknown>>(devBlocklistPath, {})
    const devBlocklistLoaded = devBlocklistInfo.loadedFrom === 'file'
    const devBlocklistCount = Object.keys(devBlocklistInfo.data || {}).length
    log(
      'startup',
      `${DEV_BLOCKLIST_FILENAME}: ${devBlocklistPath} (${devBlocklistLoaded ? 'found' : 'fallback'}, ${devBlocklistCount} items)`,
    )

    const statePath = dataPath(STATE_FILENAME)
    log('startup', `State log: ${statePath}`)

    const decisionLogPath = dataPath(DECISION_LOG_FILENAME)
    log('startup', `Decision log: ${decisionLogPath}`)

    // === Warnings for Missing Resources ===
    if (
      smartWalletsCount === 0 &&
      (entrySource === 'smart_wallets' || (config.opportunity?.smartWalletScoreBonus ?? 0) > 0)
    ) {
      const warningMsg =
        'WARNING: Smart wallet list resolves to 0 wallets, but strategy specifies smart-wallets or high score bonus'
      log('startup_warn', warningMsg)
      if (this.adapters.telegram?.isEnabled?.()) {
        this.adapters.telegram.sendMessage(warningMsg).catch((err: any) => {
          log('telegram_warn', `Failed to send startup warning: ${err?.message || err}`)
        })
      }
    }

    this.adapters.hivemind.ensureAgentId()

    this.adapters.domain.validateActiveStrategy()

    this.adapters.hivemind
      .bootstrapHiveMind()
      .catch((error: any) => log('hivemind_warn', `Bootstrap failed: ${error.message}`))
    this.adapters.hivemind.startHiveMindBackgroundSync()

    // Load any persisted Telegram messages from previous session
    this.loadTelegramQueue()
    this.startTelegramDrainTimer()

    // Register cron restarter
    this.adapters.toolExecutor.registerCronRestarter(() => {
      if (this.cronStarted) this.startCronJobs()
    })

    if (this.adapters.desktop) {
      this.adapters.desktop.startServer((msg: any) => this.desktopHandler(msg))
    }

    if (options.tty) {
      await this.startTTY()
    } else {
      log('startup', 'Non-TTY mode — starting cron cycles immediately.')
      this.startCronJobs()
      this.maybeRunMissedBriefing().catch((err: any) => {
        log('cron_error', `Failed to check missed briefing on startup: ${err?.message || err}`)
      })
      this.adapters.telegram.startPolling((msg: any) => this.telegramHandler(msg))
      this.drainTelegramQueue().catch((err: any) => {
        log('telegram_warn', `Initial telegram queue drain failed: ${err?.message || err}`)
      })
      try {
        await this.runScreeningCycle({ silent: false })
      } catch (e: any) {
        log('startup_error', e.message)
      }
    }
  }

  async stop(): Promise<void> {
    await this.shutdown('manual')
  }

  private async shutdown(signal: string): Promise<void> {
    if (this.shuttingDown) {
      log('shutdown', `Received ${signal} while shutdown is already in progress.`)
      return
    }
    this.shuttingDown = true

    log('shutdown', `Received ${signal}. Shutting down...`)
    this.stopTelegramDrainTimer()
    this.telegramQueue = []
    this.saveTelegramQueue()
    this.adapters.telegram.stopPolling()
    if (this.adapters.desktop) {
      this.adapters.desktop.stopServer()
    }
    this.stopCronJobs()

    const positions = await this.withTimeout(
      this.adapters.meteora.getMyPositions({ force: true, silent: true }).catch((error: any) => {
        log('shutdown', `Position snapshot failed during shutdown: ${error.message}`)
        return null
      }),
      5000,
    )
    if (positions) {
      log('shutdown', `Open positions at shutdown: ${positions.total_positions}`)
    } else {
      log('shutdown', 'Open position snapshot skipped during shutdown timeout')
    }
    process.exit(0)
  }

  // ─── Cycle Timers ──────────────────────────────────────────────

  private nextRunIn(lastRun: number | null, intervalMin: number): number {
    if (!lastRun) return intervalMin * 60
    const elapsed = (Date.now() - lastRun) / 1000
    return Math.max(0, intervalMin * 60 - elapsed)
  }

  private formatCountdown(seconds: number): string {
    if (seconds <= 0) return 'now'
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return m > 0 ? `${m}m ${s}s` : `${s}s`
  }

  private buildPrompt(): string {
    const mgmt = this.formatCountdown(this.nextRunIn(this.managementLastRun, config.schedule.managementIntervalMin))
    const scrn = this.formatCountdown(this.nextRunIn(this.screeningLastRun, config.schedule.screeningIntervalMin))
    return `etemaro [manage: ${mgmt} | screen: ${scrn}] > `
  }

  // ─── Cron Definitions ──────────────────────────────────────────

  stopCronJobs(): void {
    for (const task of this.cronTasks) task.stop()
    if (this.pnlPollInterval) clearInterval(this.pnlPollInterval)
    if (this.opportunityPollInterval) clearInterval(this.opportunityPollInterval)
    this.stopTelegramDrainTimer()
    this.cronTasks = []
    this.pnlPollInterval = null
    this.opportunityPollInterval = null
    if (this.countdownInterval) clearInterval(this.countdownInterval)
    this.countdownInterval = null
  }

  startCronJobs(): void {
    this.stopCronJobs() // stop any running tasks before (re)starting
    this.startTelegramDrainTimer()
    this.adapters.domain.validateActiveStrategy()

    const mgmtTask = cron.schedule(`*/${Math.max(1, config.schedule.managementIntervalMin)} * * * *`, () =>
      this.runManagementCycle(),
    )

    const screenTask = cron.schedule(`*/${Math.max(1, config.schedule.screeningIntervalMin)} * * * *`, () =>
      this.runScreeningCycle(),
    )

    const healthTask = cron.schedule('0 * * * *', async () => {
      if (!this.acquireLock('management')) return
      log('cron', 'Starting health check')
      try {
        await agentLoop(
          `
HEALTH CHECK

Summarize the current portfolio health, total fees earned, and performance of all open positions. Recommend any high-level adjustments if needed.
        `,
          config.llm.maxSteps,
          [],
          'MANAGER',
          null,
          null,
          { deps: this.adapters.agentLoopDeps },
        )
      } catch (error: any) {
        log('cron_error', `Health check failed: ${error.message}`)
      } finally {
        this.releaseLock('management')
      }
    })

    // Morning Briefing at 8:00 AM UTC+7 (1:00 AM UTC)
    const briefingTask = cron.schedule(
      '0 1 * * *',
      async () => {
        await this.runBriefing()
      },
      { timezone: 'UTC' },
    )

    // Every 6h — catch up if briefing was missed (agent restart, crash, etc.)
    const briefingWatchdog = cron.schedule(
      '0 */6 * * *',
      async () => {
        await this.maybeRunMissedBriefing()
      },
      { timezone: 'UTC' },
    )

    // Fast PnL poller — the real-time exit path between management cycles, no LLM.
    const pnlPollMs = Math.max(1, Number(config.pnl.pollIntervalSec ?? 15)) * 1000
    const confirmTicks = Math.max(1, Number(config.pnl.confirmTicks ?? 2))

    // TODO for interval review of shoulduse semaphore
    this.pnlPollInterval = setInterval(async () => {
      if (getTrackedPositions(true).length === 0) return
      if (!this.acquireLock('pnlPoll')) return
      try {
        const result = await this.adapters.meteora.getMyPositions({ force: true, silent: true }).catch((err: any) => {
          log('cron_error', `PnL poller failed to fetch positions: ${err?.message || err}`)
          return null
        })
        if (!result?.positions?.length) return
        for (const p of result.positions) {
          confirmPeak(p.position, p.pnl_pct, confirmTicks)

          // Detect an exit signal this tick (rule-based exits, then deterministic close rules).
          const exit = updatePnlAndCheckExits(p.position, p, config.management)
          const closeRule = exit ? null : getDeterministicCloseRule(p, config.management)
          let signal: string | null = null,
            reason: string | null = null,
            rule: string | number = 'exit'
          if (exit) {
            signal = exit.action
            reason = exit.reason
          } else if (closeRule) {
            signal = `RULE_${closeRule.rule}`
            reason = closeRule.reason
            rule = closeRule.rule
          }

          // Require N consecutive confirming ticks before acting.
          const { fire } = registerExitSignal(p.position, signal, confirmTicks)
          if (!signal || !fire) continue

          const pollSource = (result as any).source === 'rpc' ? 'Solana RPC' : 'Meteora Datapi'
          log(
            'state',
            `[PnL poll via ${pollSource}] ${signal} confirmed (${confirmTicks} ticks): ${p.pair} — ${reason} — closing directly`,
          )
          // Hold the management lock so the cron cycle can't double-act on this position.
          const wasManagementBusy = this.managementBusy
          this.managementBusy = true
          try {
            const actMap = new Map([[p.position, { action: 'CLOSE', rule, reason }]])
            const { report: rpt } = await this.executeManagementActions([p], actMap, {})
            log('state', `[PnL poll] ${p.pair}: ${rpt || 'closed'}`)
          } catch (e: any) {
            log('cron_error', `Poll-triggered close failed: ${e.message}`)
          } finally {
            this.managementBusy = wasManagementBusy
          }
          break // one action per tick
        }
      } catch (e: any) {
        log('cron_error', `PnL poll failed: ${e.message}`)
      } finally {
        this.releaseLock('pnlPoll')
      }
    }, pnlPollMs)

    // Opportunity poller
    if (config.opportunity.enabled && config.screening.entrySource !== 'smart_wallets') {
      const oppMs = Math.max(15, Number(config.opportunity.pollIntervalSec ?? 45)) * 1000
      const oppCooldownMs = 5 * 60 * 1000

      this.opportunityPollInterval = setInterval(async () => {
        if (!this.acquireLock('opportunityPoll')) return
        try {
          if (Date.now() - this.screeningLastTriggered < oppCooldownMs) return
          const positions = await this.adapters.meteora.getMyPositions({ silent: true }).catch((err: any) => {
            log('cron_error', `Opportunity poller failed to fetch positions: ${err?.message || err}`)
            return null
          })
          if (!positions || (positions.total_positions ?? 0) >= config.risk.maxPositions) return

          const top = await this.adapters.screening
            .getTopCandidates({ limit: config.opportunity.limit })
            .catch((err: any) => {
              log('cron_error', `Opportunity poller failed to fetch top candidates: ${err?.message || err}`)
              return null
            })
          const candidates = (top?.candidates || [])
            .slice()
            .sort(
              (a: any, b: any) =>
                this.adapters.screening.degenScore(b, config.opportunity) -
                this.adapters.screening.degenScore(a, config.opportunity),
            )
          if (!candidates.length) return

          const minScore = config.opportunity.minScore
          const bonus = Number(config.opportunity.smartWalletScoreBonus ?? 0)
          const floor = minScore - bonus

          let trigger: { c: any; s: number; smart: any[] } | null = null
          for (const c of candidates) {
            const s = this.adapters.screening.degenScore(c, config.opportunity)
            if (s < floor) break
            if (s >= minScore) {
              trigger = { c, s, smart: [] }
              break
            }
            if (bonus <= 0) continue
            const smart =
              (
                await this.adapters.domain.checkSmartWalletsOnPool({ pool_address: c.pool }).catch((err: any) => {
                  log('screening', `Opportunity poller failed smart wallet check for ${c.pool}: ${err?.message || err}`)
                  return null
                })
              )?.in_pool || []
            if (smart.length > 0) {
              trigger = { c, s, smart }
              break
            }
          }
          if (!trigger) return

          if (!config.connection.dryRun) {
            const balance = await this.adapters.wallet.getWalletBalances().catch((err: any) => {
              log('cron_error', `Opportunity poller failed to fetch wallet balances: ${err?.message || err}`)
              return null
            })
            const minRequired = config.management.deployAmountSol + config.management.gasReserve
            if (!balance || balance.sol < minRequired) {
              log(
                'cron',
                `[Opportunity] ${trigger.c.name} triggered (degen ${trigger.s.toFixed(1)}) but insufficient SOL (${balance?.sol ?? 0} < ${minRequired}) — skipping deploy`,
              )
              return
            }
          }

          const smartTag = trigger.smart.length
            ? ` + smart wallet [${trigger.smart.map((w: any) => w.name || w.address?.slice(0, 4)).join(', ')}] (bar lowered ${minScore}→${floor})`
            : ''
          log(
            'cron',
            `[Opportunity] ${trigger.c.name} degen ${trigger.s.toFixed(1)} >= ${trigger.smart.length ? floor : minScore}${smartTag} — triggering screening deploy decision`,
          )
          this.runScreeningCycle({ silent: true }).catch((e: any) =>
            log('cron_error', `Opportunity-triggered screening failed: ${e.message}`),
          )
        } catch (e: any) {
          log('cron_error', `Opportunity poll failed: ${e.message}`)
        } finally {
          this.releaseLock('opportunityPoll')
        }
      }, oppMs)
    }

    this.cronTasks = [mgmtTask, screenTask, healthTask, briefingTask, briefingWatchdog]
    log(
      'cron',
      `Cycles started — management every ${config.schedule.managementIntervalMin}m, screening every ${config.schedule.screeningIntervalMin}m${config.opportunity.enabled ? `, opportunity poll every ${config.opportunity.pollIntervalSec}s` : ''}`,
    )
  }

  // ─── Briefing ──────────────────────────────────────────────────

  private async getBriefingWithSolPrice(): Promise<string> {
    let solPrice: number | undefined
    try {
      if (this.adapters.wallet.getSolPrice) {
        const p = await this.adapters.wallet.getSolPrice()
        if (p && p > 0) {
          solPrice = p
        }
      }
    } catch {
      // Best-effort: fall back to deriving SOL price inside the briefing adapter
    }
    return this.adapters.briefing.generateBriefing({ solPrice })
  }

  async runBriefing(): Promise<void> {
    log('cron', 'Starting briefing generation')
    try {
      const briefing = await this.getBriefingWithSolPrice()
      if (this.adapters.telegram.isEnabled()) {
        const res = await this.adapters.telegram.sendMessage(briefing)
        if (res && res.ok !== false) {
          setLastBriefingDate()
        } else {
          log('cron_error', 'Briefing telegram delivery failed — last briefing date not updated to allow retry')
        }
      } else {
        setLastBriefingDate()
      }
    } catch (error: any) {
      log('cron_error', `Briefing failed: ${error.message}`)
    }
  }

  async maybeRunMissedBriefing(): Promise<void> {
    const todayUtc = new Date().toISOString().slice(0, 10)
    const lastSent = getLastBriefingDate()

    if (lastSent === todayUtc) return

    const nowUtc = new Date()
    const briefingHourUtc = 1
    if (nowUtc.getUTCHours() < briefingHourUtc) return

    log('cron', `Missed briefing detected (last sent: ${lastSent || 'never'}) — sending now`)
    await this.runBriefing()
  }

  // ─── Management Cycle ──────────────────────────────────────────

  async executeManagementActions(
    actionPositions: any[],
    actionMap: Map<string, any>,
    { liveMessage = null as any, cur = '$' } = {},
  ): Promise<{ report: string; closedCount: number }> {
    const lines: string[] = []
    const instructionPositions: any[] = []
    let closedCount = 0

    const mechanical = actionPositions.filter((p: any) => actionMap.get(p.position).action !== 'INSTRUCTION')
    if (mechanical.length) {
      log('cron', `Management: executing ${mechanical.length} mechanical action(s) — no LLM`)
    }

    for (const p of actionPositions) {
      const act = actionMap.get(p.position)
      if (act.action === 'INSTRUCTION') {
        instructionPositions.push(p)
        continue
      }

      if (act.action === 'CLOSE') {
        const reason = act.reason || (act.rule ? `Rule ${act.rule}` : 'rule close')
        await liveMessage?.toolStart('close_position')
        const res = await this.adapters.toolExecutor
          .executeTool('close_position', { position_address: p.position, reason })
          .catch((e: any) => ({ error: e.message }))
        const ok = res?.success !== false && !res?.error && !res?.blocked
        if (ok) closedCount++
        await liveMessage?.toolFinish('close_position', res, ok)
        lines.push(
          `${p.pair}: ${ok ? `closed (${reason})` : `close FAILED — ${res?.error || res?.reason || 'unknown'}`}`,
        )
      } else if (act.action === 'CLAIM') {
        await liveMessage?.toolStart('claim_fees')
        const res = await this.adapters.toolExecutor
          .executeTool('claim_fees', { position_address: p.position })
          .catch((e: any) => ({ error: e.message }))
        const ok = res?.success !== false && !res?.error && !res?.blocked
        await liveMessage?.toolFinish('claim_fees', res, ok)
        lines.push(`${p.pair}: ${ok ? 'fees claimed' : `claim FAILED — ${res?.error || res?.reason || 'unknown'}`}`)
      }
    }

    // INSTRUCTION positions need the LLM to evaluate the free-text condition.
    if (instructionPositions.length > 0) {
      log(
        'cron',
        `Management: ${instructionPositions.length} instruction position(s) — invoking LLM [model: ${config.llm.managementModel}]`,
      )
      const actionBlocks = instructionPositions
        .map((p: any) =>
          [
            `POSITION: ${p.pair} (${p.position})`,
            `  pool: ${p.pool}`,
            `  pnl_pct: ${p.pnl_pct}% | unclaimed_fees: ${cur}${p.unclaimed_fees_usd} | value: ${cur}${p.total_value_usd} | fee_per_tvl_24h: ${p.fee_per_tvl_24h ?? '?'}%`,
            `  bins: lower=${p.lower_bin} upper=${p.upper_bin} active=${p.active_bin} | oor_minutes: ${p.minutes_out_of_range ?? 0}`,
            `  instruction: "${p.instruction}"`,
          ].join('\n'),
        )
        .join('\n\n')

      const { content } = await agentLoop(
        `
INSTRUCTION EVALUATION — ${instructionPositions.length} position(s)

${actionBlocks}

For each position, evaluate the instruction condition against the live data:
- If the condition is MET → call close_position (it claims fees internally; do NOT call claim_fees first).
- If NOT met → HOLD, do nothing.

After evaluating, write a brief one-line result per position.
      `,
        config.llm.maxSteps,
        [],
        'MANAGER',
        config.llm.managementModel,
        2048,
        {
          deps: this.adapters.agentLoopDeps,
          onToolStart: async ({ name }: any) => {
            await liveMessage?.toolStart(name)
          },
          onToolFinish: async ({ name, result, success }: any) => {
            if (name === 'close_position' && success !== false && !result?.error && !result?.blocked) {
              closedCount++
            }
            await liveMessage?.toolFinish(name, result, success)
          },
        },
      )
      if (content) lines.push(content)
    }

    return { report: lines.join('\n'), closedCount }
  }

  async runManagementCycle({ silent = false } = {}): Promise<string | null> {
    if (this.shuttingDown || !this.acquireLock('management')) return null
    this.managementLastRun = Date.now()
    log('cron', 'Starting management cycle')
    let mgmtReport: string | null = null
    let positions: any[] = []
    let liveMessage: any = null
    const screeningCooldownMs = 5 * 60 * 1000

    try {
      if (!silent && this.adapters.telegram.isEnabled()) {
        liveMessage = await this.adapters.telegram.createLiveMessage('🔄 Management Cycle', 'Evaluating positions...')
      }
      const livePositions = await this.adapters.meteora.getMyPositions({ force: true }).catch((err: any) => {
        log('cron_error', `Failed to fetch live positions in management cycle: ${err?.message || err}`)
        return null
      })
      positions = livePositions?.positions || []

      if (positions.length === 0) {
        log('cron', 'No open positions — checking screening trigger')
        mgmtReport = 'No open positions.'
        if (Date.now() - this.screeningLastTriggered > screeningCooldownMs) {
          this.screeningLastTriggered = Date.now()
          log('cron', 'Triggering screening cycle')
          this.runScreeningCycle().catch((e: any) => log('cron_error', `Triggered screening failed: ${e.message}`))
        } else {
          log('cron', 'Screening skipped — cooldown active')
        }
        return mgmtReport
      }

      // Snapshot + load pool memory
      const positionData = positions.map((p: any) => {
        this.adapters.domain.recordPositionSnapshot(p.pool, p)
        return { ...p, recall: this.adapters.domain.recallForPool(p.pool) }
      })

      // JS exit checks
      const exitMap = new Map<string, string>()
      for (const p of positionData) {
        confirmPeak(p.position, p.pnl_pct, 1)
        const exit = updatePnlAndCheckExits(p.position, p, config.management)
        if (exit) {
          exitMap.set(p.position, exit.reason)
          log('state', `Exit alert for ${p.pair}: ${exit.reason}`)
        }
      }

      // ── Deterministic rule checks (no LLM) ──────────────────────────
      const actionMap = new Map<string, any>()
      for (const p of positionData) {
        if (exitMap.has(p.position)) {
          actionMap.set(p.position, { action: 'CLOSE', rule: 'exit', reason: exitMap.get(p.position) })
          continue
        }
        if (p.instruction) {
          actionMap.set(p.position, { action: 'INSTRUCTION' })
          continue
        }

        const closeRule = getDeterministicCloseRule(p, config.management)
        if (closeRule) {
          actionMap.set(p.position, closeRule)
          continue
        }
        if ((p.unclaimed_fees_usd ?? 0) >= config.management.minClaimAmount) {
          actionMap.set(p.position, { action: 'CLAIM' })
          continue
        }
        actionMap.set(p.position, { action: 'STAY' })
      }

      // ── Build JS report ──────────────────────────────────────────────
      const totalValue = positionData.reduce((s: number, p: any) => s + (p.total_value_usd ?? 0), 0)
      const totalUnclaimed = positionData.reduce((s: number, p: any) => s + (p.unclaimed_fees_usd ?? 0), 0)

      const reportLines = positionData.map((p: any) => {
        const act = actionMap.get(p.position)
        const inRange = p.in_range ? '🟢 IN' : `🔴 OOR ${p.minutes_out_of_range ?? 0}m`
        const val = config.management.solMode ? `◎${p.total_value_usd ?? '?'}` : `$${p.total_value_usd ?? '?'}`
        const unclaimed = config.management.solMode
          ? `◎${p.unclaimed_fees_usd ?? '?'}`
          : `$${p.unclaimed_fees_usd ?? '?'}`
        const statusLabel = act.action === 'INSTRUCTION' ? 'HOLD (instruction)' : act.action
        let line = `**${p.pair}** | Age: ${p.age_minutes ?? '?'}m | Val: ${val} | Unclaimed: ${unclaimed} | PnL: ${p.pnl_pct ?? '?'}% | Yield: ${p.fee_per_tvl_24h ?? '?'}% | ${inRange} | ${statusLabel}`
        if (p.instruction) line += `\nNote: "${p.instruction}"`
        if (act.action === 'CLOSE' && act.rule === 'exit') line += `\n⚡ Trailing TP: ${act.reason}`
        if (act.action === 'CLOSE' && act.rule && act.rule !== 'exit') line += `\nRule ${act.rule}: ${act.reason}`
        if (act.action === 'CLAIM') line += '\n→ Claiming fees'
        return line
      })

      const needsAction = [...actionMap.values()].filter((a: any) => a.action !== 'STAY')
      const actionSummary =
        needsAction.length > 0
          ? needsAction
              .map((a: any) =>
                a.action === 'INSTRUCTION' ? 'EVAL instruction' : `${a.action}${a.reason ? ` (${a.reason})` : ''}`,
              )
              .join(', ')
          : 'no action'

      const cur = config.management.solMode ? '◎' : '$'
      mgmtReport =
        reportLines.join('\n\n') +
        `\n\nSummary: 💼 ${positions.length} positions | ${cur}${totalValue.toFixed(4)} | fees: ${cur}${totalUnclaimed.toFixed(4)} | ${actionSummary}`

      // ── Call LLM only if action needed ──────────────────────────────
      const actionPositions = positionData.filter((p: any) => {
        const a = actionMap.get(p.position)
        return a.action !== 'STAY'
      })

      let closedCount = 0
      if (actionPositions.length > 0) {
        const { report: execReport, closedCount: closed } = await this.executeManagementActions(
          actionPositions,
          actionMap,
          {
            liveMessage,
            cur,
          },
        )
        closedCount = closed
        if (execReport) mgmtReport += `\n\n${execReport}`
      } else {
        log('cron', 'Management: all positions STAY — skipping')
        await liveMessage?.note('No tool actions needed.')
      }

      // Trigger screening after management if positions slots are available
      const remainingCount = Math.max(0, positions.length - closedCount)
      if (remainingCount < config.risk.maxPositions && Date.now() - this.screeningLastTriggered > screeningCooldownMs) {
        log('cron', `Post-management: ${remainingCount}/${config.risk.maxPositions} positions — triggering screening`)
        this.runScreeningCycle().catch((e: any) => log('cron_error', `Triggered screening failed: ${e.message}`))
      }
    } catch (error: any) {
      log('cron_error', `Management cycle failed: ${error.message}`)
      mgmtReport = `Management cycle failed: ${error.message}`
    } finally {
      this.releaseLock('management')
      if (!silent && this.adapters.telegram.isEnabled()) {
        if (mgmtReport) {
          if (liveMessage)
            await liveMessage.finalize(stripThink(mgmtReport)).catch((err: any) => {
              log('telegram_warn', `Failed to finalize management live message: ${err?.message || err}`)
            })
          else
            this.adapters.telegram.sendMessage(`🔄 Management Cycle\n\n${stripThink(mgmtReport)}`).catch((err: any) => {
              log('telegram_warn', `Failed to send management report: ${err?.message || err}`)
            })
        }
        for (const p of positions) {
          if (!p.in_range && p.minutes_out_of_range >= config.management.outOfRangeWaitMinutes) {
            this.adapters.telegram
              .notifyOutOfRange({ pair: p.pair, minutesOOR: p.minutes_out_of_range })
              .catch((err: any) => {
                log('telegram_warn', `Failed to send out of range notification for ${p.pair}: ${err?.message || err}`)
              })
          }
        }
      }
    }
    return mgmtReport
  }

  // ─── Screening Cycle ───────────────────────────────────────────

  private getLoneCandidateSkipReason(context: { pool?: any; sw?: any; n?: any; ti?: any } = {}): string | null {
    const { pool, sw, n, ti } = context
    if (!pool) return 'missing candidate data'
    const tokenInfo = ti || {}
    const hasNarrative = !!n?.narrative
    const degen = this.adapters.screening.degenScore(pool, config.opportunity)
    const degenStrong = degen >= (config.screening.loneCandidateMinDegen ?? 50)
    const globalFeesSol = Number(tokenInfo.global_fees_sol ?? pool.gmgn_total_fee_sol)
    const top10Pct = Number(
      tokenInfo.audit?.top_holders_pct ?? pool.gmgn_token_info_top10_pct ?? pool.gmgn_top10_holder_pct,
    )
    const botPct = Number(tokenInfo.audit?.bot_holders_pct ?? pool.gmgn_bot_degen_pct)

    // Hard fundamental gates — no override.
    if (Number.isFinite(globalFeesSol) && globalFeesSol < config.screening.minTokenFeesSol) {
      return `token fees ${globalFeesSol} SOL below minimum ${config.screening.minTokenFeesSol} SOL`
    }
    if (Number.isFinite(top10Pct) && top10Pct > config.screening.maxTop10Pct) {
      return `top10 concentration ${top10Pct}% above maximum ${config.screening.maxTop10Pct}%`
    }
    if (Number.isFinite(botPct) && botPct > config.screening.maxBotHoldersPct) {
      return `bot holders ${botPct}% above maximum ${config.screening.maxBotHoldersPct}%`
    }

    // PVP conflict needs strong conviction (degen) to deploy solo.
    if (pool.is_pvp && !degenStrong) {
      return `PVP symbol conflict without strong degen conviction (degen ${degen.toFixed(1)} < ${config.screening.loneCandidateMinDegen ?? 50})`
    }
    // Conviction: a solo deploy needs a narrative OR a strong degen score.
    if (!hasNarrative && !degenStrong) {
      return `only candidate has no narrative and weak degen score (${degen.toFixed(1)} < ${config.screening.loneCandidateMinDegen ?? 50})`
    }
    return null
  }

  async runScreeningCycle({ silent = false } = {}): Promise<string | null> {
    if (this.shuttingDown || !this.acquireLock('screening')) {
      log('cron', 'Screening skipped — previous cycle still running')
      return null
    }
    this.screeningLastTriggered = Date.now()

    let prePositions: any, preBalance: any
    let liveMessage: any = null
    let screenReport: string | null = null
    try {
      prePositions = await this.adapters.meteora.getMyPositions({ force: true })
      if (prePositions.total_positions >= config.risk.maxPositions) {
        log(
          'cron',
          `Screening skipped — max positions reached (${prePositions.total_positions}/${config.risk.maxPositions})`,
        )
        screenReport = `Screening skipped — max positions reached (${prePositions.total_positions}/${config.risk.maxPositions}).`
        this.adapters.domain.appendDecision({
          type: 'skip',
          actor: 'SCREENER',
          summary: 'Screening skipped',
          reason: `Max positions reached (${prePositions.total_positions}/${config.risk.maxPositions})`,
        })
        return screenReport
      }
      const minRequired = config.management.deployAmountSol + config.management.gasReserve
      const isDryRun = config.connection.dryRun
      if (!isDryRun) {
        preBalance = await this.adapters.wallet.getWalletBalances()
        if (preBalance.sol < minRequired) {
          log(
            'cron',
            `Screening skipped — insufficient SOL (${preBalance.sol.toFixed(3)} < ${minRequired.toFixed(3)} needed for deploy + gas)`,
          )
          screenReport = `Screening skipped — insufficient SOL (${preBalance.sol.toFixed(3)} < ${minRequired.toFixed(3)} needed for deploy + gas).`
          this.adapters.domain.appendDecision({
            type: 'skip',
            actor: 'SCREENER',
            summary: 'Screening skipped',
            reason: `Insufficient SOL (${preBalance.sol.toFixed(3)} < ${minRequired.toFixed(3)})`,
          })
          return screenReport
        }
      } else {
        preBalance = { sol: Math.max(config.management.deployAmountSol, 1), tokens: [] }
      }

      if (!silent && this.adapters.telegram.isEnabled()) {
        liveMessage = await this.adapters.telegram.createLiveMessage('🔍 Screening Cycle', 'Scanning candidates...')
      }
      this.screeningLastRun = Date.now()

      if (config.screening.entrySource === 'smart_wallets') {
        try {
          screenReport = await this.runSmartWalletScreening({
            liveMessage,
            deployAmount: computeDeployAmount(preBalance.sol),
          })
        } catch (e: any) {
          log('cron_error', `Smart wallet screening failed: ${e.message}`)
          screenReport = `Smart wallet screening failed: ${e.message}`
        }
        return screenReport
      }

      log('cron', `Starting screening cycle [model: ${config.llm.screeningModel}]`)
      const currentBalance = preBalance
      const deployAmount = computeDeployAmount(currentBalance.sol)
      log('cron', `Computed deploy amount: ${deployAmount} SOL (wallet: ${currentBalance.sol} SOL)`)

      const activeStrategy = this.adapters.domain.getActiveStrategy()
      const deployStrategy = config.strategy.strategyMeteora
      const strategyBlock =
        `DEPLOY STRATEGY: ${deployStrategy} (from config) | bins_above: 0 (FIXED — never change) | deposit: SOL only (amount_y, amount_x=0)` +
        (activeStrategy
          ? `\nSTRATEGY CONTEXT: ${activeStrategy.name} — entry: ${activeStrategy.entry?.condition || 'n/a'} | exit: ${activeStrategy.exit?.notes || 'n/a'} | best for: ${activeStrategy.bestFor}`
          : '')

      await liveMessage?.toolStart('get_top_candidates')
      const topCandidates = await this.adapters.screening.getTopCandidates({ limit: 10 }).catch(async (error: any) => {
        await liveMessage?.toolFinish('get_top_candidates', { error: error?.message || 'failed' }, false)
        return null
      })
      if (topCandidates) {
        await liveMessage?.toolFinish('get_top_candidates', topCandidates, true)
      }
      const candidates = (topCandidates?.candidates || topCandidates?.pools || []).slice(0, 10)
      const earlyFilteredExamples = topCandidates?.filtered_examples || []

      const allCandidates: any[] = []
      for (const pool of candidates) {
        const mint = pool.base?.mint
        const [smartWallets, narrative, tokenInfo] = await Promise.allSettled([
          this.adapters.domain.checkSmartWalletsOnPool({ pool_address: pool.pool }),
          mint ? this.adapters.domain.getTokenNarrative({ mint }) : Promise.resolve(null),
          mint ? this.adapters.domain.getTokenInfo({ query: mint }) : Promise.resolve(null),
        ])
        allCandidates.push({
          pool,
          sw: smartWallets.status === 'fulfilled' ? smartWallets.value : null,
          n: narrative.status === 'fulfilled' ? narrative.value : null,
          ti: tokenInfo.status === 'fulfilled' ? tokenInfo.value?.results?.[0] : null,
          mem: this.adapters.domain.recallForPool(pool.pool),
        })
        await new Promise((r) => setTimeout(r, 150))
      }

      // Hard filters after token recon
      const filteredOut: Array<{ name: string; reason: string }> = []
      const passing = allCandidates.filter(({ pool, ti }: any) => {
        const launchpad = ti?.launchpad ?? null
        if (
          launchpad &&
          config.screening.allowedLaunchpads?.length > 0 &&
          !config.screening.allowedLaunchpads.includes(launchpad)
        ) {
          log('screening', `Skipping ${pool.name} — launchpad ${launchpad} not in allow-list`)
          filteredOut.push({ name: pool.name, reason: `launchpad ${launchpad} not in allow-list` })
          return false
        }
        if (launchpad && config.screening.blockedLaunchpads.includes(launchpad)) {
          log('screening', `Skipping ${pool.name} — blocked launchpad (${launchpad})`)
          filteredOut.push({ name: pool.name, reason: `blocked launchpad (${launchpad})` })
          return false
        }
        const botPct = ti?.audit?.bot_holders_pct
        const maxBotHoldersPct = config.screening.maxBotHoldersPct
        if (botPct != null && maxBotHoldersPct != null && botPct > maxBotHoldersPct) {
          log('screening', `Bot-holder filter: dropped ${pool.name} — bots ${botPct}% > ${maxBotHoldersPct}%`)
          filteredOut.push({ name: pool.name, reason: `bot holders ${botPct}% > ${maxBotHoldersPct}%` })
          return false
        }
        return true
      })

      if (passing.length === 0) {
        const combined = filteredOut.length > 0 ? filteredOut : earlyFilteredExamples
        const combinedExamples = combined
          .slice(0, 3)
          .map((entry: any) => `- ${entry.name}: ${entry.reason}`)
          .join('\n')
        screenReport = combinedExamples
          ? `No candidates available.\nFiltered examples:\n${combinedExamples}`
          : 'No candidates available (all filtered by launchpad / holder-quality rules).'
        this.adapters.domain.appendDecision({
          type: 'no_deploy',
          actor: 'SCREENER',
          summary: 'No candidates available',
          reason: combinedExamples || 'All candidates filtered before deploy',
          rejected: combined.slice(0, 5).map((entry: any) => `${entry.name}: ${entry.reason}`),
        })
        return screenReport
      }

      if (passing.length === 1) {
        const skipReason = this.getLoneCandidateSkipReason(passing[0])
        if (skipReason) {
          const candidateName = passing[0].pool?.name || 'unknown'
          screenReport = [
            '⛔ NO DEPLOY',
            '',
            'Cycle finished with no valid entry.',
            '',
            'BEST LOOKING CANDIDATE',
            candidateName,
            '',
            'WHY SKIPPED',
            `Only one candidate survived filtering, but it was not worth deploying: ${skipReason}.`,
            '',
            'REJECTED',
            `- ${candidateName}: ${skipReason}`,
          ].join('\n')
          this.adapters.domain.appendDecision({
            type: 'no_deploy',
            actor: 'SCREENER',
            summary: 'Single candidate skipped',
            reason: skipReason,
            pool: passing[0].pool?.pool,
            pool_name: candidateName,
          })
          return screenReport
        }
      }

      // Pre-fetch active_bin for all passing candidates in parallel
      const activeBinResults = await Promise.allSettled(
        passing.map(({ pool }: any) => this.adapters.meteora.getActiveBin({ pool_address: pool.pool })),
      )

      // Build compact candidate blocks
      const candidateBlocks = passing.map(({ pool, sw, n, ti, mem }: any, i: number) => {
        const botPct = ti?.audit?.bot_holders_pct ?? '?'
        const top10Pct = ti?.audit?.top_holders_pct ?? '?'
        const feesSol = ti?.global_fees_sol ?? '?'
        const launchpad = ti?.launchpad ?? null
        const priceChange = ti?.stats_1h?.price_change
        const netBuyers = ti?.stats_1h?.net_buyers
        const activeBin =
          activeBinResults[i]?.status === 'fulfilled'
            ? (activeBinResults[i] as PromiseFulfilledResult<any>).value?.binId
            : null

        const pvpLine = pool.is_pvp
          ? `  pvp: HIGH — rival ${pool.pvp_rival_name || pool.pvp_symbol} (${pool.pvp_rival_mint?.slice(0, 8)}...) has pool ${pool.pvp_rival_pool?.slice(0, 8)}..., tvl=$${pool.pvp_rival_tvl}, holders=${pool.pvp_rival_holders}, fees=${pool.pvp_rival_fees}SOL`
          : null

        const block = [
          `POOL: ${pool.name} (${pool.pool})`,
          `  metrics: bin_step=${pool.bin_step}, fee_pct=${pool.fee_pct}%, windowed_fee/TVL(${config.screening.timeframe || 'window'})=${pool.fee_active_tvl_ratio}, vol=$${pool.volume_window}, tvl=$${pool.tvl ?? pool.active_tvl}, volatility_${pool.volatility_timeframe || '30m'}=${pool.volatility}, mcap=$${pool.mcap}, organic=${pool.organic_score}${pool.token_age_hours != null ? `, age=${pool.token_age_hours}h` : ''}`,
          `  audit: top10=${top10Pct}%, bots=${botPct}%, fees=${feesSol}SOL${launchpad ? `, launchpad=${launchpad}` : ''}`,
          pvpLine,
          `  smart_wallets: ${sw?.in_pool?.length ?? 0} present${sw?.in_pool?.length ? ` → CONFIDENCE BOOST (${sw.in_pool.map((w: any) => w.name).join(', ')})` : ''}`,
          activeBin != null ? `  active_bin: ${activeBin}` : null,
          priceChange != null
            ? `  1h: price${priceChange >= 0 ? '+' : ''}${priceChange}%, net_buyers=${netBuyers ?? '?'}`
            : null,
          n?.narrative
            ? `  narrative_untrusted: ${sanitizeUntrustedPromptText(n.narrative, 500)}`
            : '  narrative_untrusted: none',
          mem ? `  memory_untrusted: ${sanitizeUntrustedPromptText(mem, 500)}` : null,
        ]
          .filter(Boolean)
          .join('\n')

        // Stage signals for Darwinian weighting
        if (config.darwin?.enabled) {
          const baseMint = pool.base?.mint || pool.base_mint || ti?.mint || null
          this.adapters.domain.stageSignals(pool.pool, {
            base_mint: baseMint,
            organic_score: pool.organic_score ?? null,
            fee_tvl_ratio: pool.fee_active_tvl_ratio ?? null,
            volume: pool.volume_window ?? null,
            mcap: pool.mcap ?? null,
            holder_count: ti?.holders ?? null,
            smart_wallets_present: (sw?.in_pool?.length ?? 0) > 0,
            narrative_quality: n?.narrative ? 'present' : 'absent',
            volatility: pool.volatility ?? null,
          })
        }

        return block
      })

      const _weightsSummary = config.darwin?.enabled ? this.adapters.domain.getWeightsSummary() : null

      let deployAttempted = false
      let deploySucceeded = false
      const { content } = await agentLoop(
        `
SCREENING CYCLE
${strategyBlock}
Positions: ${prePositions.total_positions}/${config.risk.maxPositions} | SOL: ${currentBalance.sol.toFixed(3)} | Deploy: ${deployAmount} SOL

SCAN: ${topCandidates?.total_screened ?? candidates.length} screened / ${passing.length} shortlisted
PRE-LOADED CANDIDATES (${passing.length} pools):
${candidateBlocks.join('\n\n')}
${
  earlyFilteredExamples.length
    ? `\nREJECTED DURING FETCH (${earlyFilteredExamples.length}):\n${earlyFilteredExamples
        .slice(0, 8)
        .map((entry: any) => `- ${entry.name}: ${entry.reason}`)
        .join('\n')}`
    : ''
}

STEPS:
1. Decide if any candidate is actually worth deploying. One surviving candidate is not automatically good enough.
2. Pick the best candidate based on narrative quality, smart wallets, and pool metrics.
3. Call deploy_position (active_bin is pre-fetched above — no need to call get_active_bin).
   bins_below = round(${config.strategy.minBinsBelow} + (candidate volatility/5)*(${config.strategy.maxBinsBelow - config.strategy.minBinsBelow})) clamped to [${config.strategy.minBinsBelow},${config.strategy.maxBinsBelow}].
   pass deploy_position.volatility = the candidate volatility value.
   For single-side SOL deploys, do not invent upside:
   set amount_y only, keep amount_x = 0, keep bins_above = 0, and let the upper bin stay at the active bin.
4. Report in this exact format (no tables, no extra sections):
   🚀 DEPLOYED

   <pool name>
   <pool address>

   ◎ <deploy amount> SOL | <strategy> | bin <active_bin>
   Range: <minPrice> → <maxPrice>
   Range cover: <downside %> downside | <upside %> upside | <total width %> total

   IMPORTANT:
   - Do NOT calculate the range percentages yourself.
   - Use the actual deploy_position tool result:
     range_coverage.downside_pct
     range_coverage.upside_pct
     range_coverage.width_pct

   MARKET
   Windowed Fee/TVL (${config.screening.timeframe || 'window'}): <x>%
   (Do not confuse this with real-time active-bin fee/TVL from deploy_position blocks.)
   Volume: $<x>
   TVL: $<x>
   Volatility: <x>
   Organic: <x>
   Mcap: $<x>
   Age: <x>h

   AUDIT
   Top10: <x>%
   Bots: <x>%
   Fees paid: <x> SOL
   Smart wallets: <names or none>

   WHY THIS WON
   <2-4 concise sentences on why this pool won, key risks, and why it still beat the alternatives>

   REJECTED
   <short flat list of all other evaluated candidates and why they were not chosen, one per line e.g. "- TOKEN/SOL: reason">
5. If no pool qualifies, report in this exact format instead:
   ⛔ NO DEPLOY

   Cycle finished with no valid entry.

   BEST LOOKING CANDIDATE
   <name or none>

   WHY SKIPPED
   <2-4 concise sentences explaining why nothing was good enough>

   REJECTED
   <short flat list of all evaluated candidate names and why they were skipped, one per line e.g. "- TOKEN/SOL: reason">
IMPORTANT:
- Keep the whole report compact and highly scannable for Telegram.
      `,
        config.llm.maxSteps,
        [],
        'SCREENER',
        config.llm.screeningModel,
        2048,
        {
          deps: this.adapters.agentLoopDeps,
          onToolStart: async ({ name }: any) => {
            if (name === 'deploy_position') deployAttempted = true
            await liveMessage?.toolStart(name)
          },
          onToolFinish: async ({ name, result, success }: any) => {
            if (name === 'deploy_position') {
              deployAttempted = true
              deploySucceeded = Boolean(success && result?.success !== false && !result?.error && !result?.blocked)
            }
            await liveMessage?.toolFinish(name, result, success)
          },
        },
      )
      screenReport = content
      const parsedRejected = this.adapters.domain.parseRejectedCandidates
        ? this.adapters.domain.parseRejectedCandidates(content)
        : []
      const hardFilterRejected = [
        ...earlyFilteredExamples.map((entry: any) => `${entry.name}: ${entry.reason}`),
        ...filteredOut.map((entry: any) => `${entry.name}: ${entry.reason}`),
      ]
      const combinedRejected = Array.from(new Set([...parsedRejected, ...hardFilterRejected]))

      if (/⛔\s*NO DEPLOY/i.test(content)) {
        this.adapters.domain.appendDecision({
          type: 'no_deploy',
          actor: 'SCREENER',
          summary: 'LLM chose no deploy',
          reason: stripThink(content).slice(0, 2048),
          rejected: combinedRejected,
        })
      } else if (!deploySucceeded) {
        this.adapters.domain.appendDecision({
          type: 'no_deploy',
          actor: 'SCREENER',
          summary: deployAttempted ? 'Deploy attempt did not succeed' : 'No successful deploy in screening cycle',
          reason: stripThink(content).slice(0, 2048),
          rejected: combinedRejected,
        })
      }
    } catch (error: any) {
      log('cron_error', `Screening cycle failed: ${error.message}`)
      screenReport = `Screening cycle failed: ${error.message}`
    } finally {
      this.releaseLock('screening')
      if (!silent && this.adapters.telegram.isEnabled()) {
        if (screenReport) {
          if (liveMessage) {
            await liveMessage.finalize(stripThink(screenReport)).catch((err: any) => {
              log('telegram_warn', `Failed to finalize screening live message: ${err?.message || err}`)
            })
          } else {
            this.adapters.telegram
              .sendMessage(`🔍 Screening Cycle\n\n${stripThink(screenReport)}`)
              .catch((err: any) => {
                log('telegram_warn', `Failed to send screening report: ${err?.message || err}`)
              })
          }
        }
      }
    }
    return screenReport
  }

  // ─── Deterministic Screen (for /screen command) ────────────────

  private setLatestCandidates(candidates: any[] = []): void {
    this.latestCandidates = Array.isArray(candidates) ? candidates : []
    this.latestCandidatesAt = new Date().toISOString()
  }

  private getLatestCandidatesMeta(): { candidates: any[]; count: number; updatedAt: string | null } {
    return {
      candidates: this.latestCandidates,
      count: this.latestCandidates.length,
      updatedAt: this.latestCandidatesAt,
    }
  }

  async runSmartWalletScreening({
    liveMessage,
    deployAmount,
  }: {
    liveMessage: any
    deployAmount: number
  }): Promise<string> {
    log('cron', '[SmartWallets] Starting smart wallet screening cycle...')

    // 1. Load smart wallets
    const trackedWallets = domain.listSmartWallets().wallets.filter((w: any) => !w.type || w.type === 'lp')
    if (!trackedWallets.length) {
      log('cron', '[SmartWallets] No smart LP wallets tracked. Skipping.')
      return 'No smart LP wallets tracked.'
    }

    // 2. Load snapshot (with migration fallback from legacy unsuffixed snapshot)
    const snapshotPath = dataPath('.smart-wallets-snapshot.json')
    const legacySnapshotPath = path.join(getDataDir(), '.smart-wallets-snapshot.json')
    let snapshot: domain.SmartWalletSnapshot | null = null
    if (fs.existsSync(snapshotPath)) {
      try {
        snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))
      } catch (e: any) {
        log('cron_error', `[SmartWallets] Failed to load snapshot: ${e.message}`)
      }
    } else if (snapshotPath !== legacySnapshotPath && fs.existsSync(legacySnapshotPath)) {
      try {
        snapshot = JSON.parse(fs.readFileSync(legacySnapshotPath, 'utf8'))
        if (snapshot) {
          saveJsonFile(snapshotPath, snapshot)
          log('cron', `[SmartWallets] Migrated legacy snapshot to agent snapshot: ${snapshotPath}`)
        }
      } catch (e: any) {
        log('cron_error', `[SmartWallets] Failed to load legacy snapshot: ${e.message}`)
      }
    }

    // 3. Fetch positions for each wallet
    const currentPositions: domain.WalletPositionItem[] = []
    for (const w of trackedWallets) {
      try {
        const result = await meteora.getWalletPositions({ wallet_address: w.address })
        for (const p of result.positions || []) {
          if (p.position && p.pool) {
            currentPositions.push({ position: p.position, pool: p.pool })
          }
        }
      } catch (e: any) {
        log('cron_error', `[SmartWallets] Failed to fetch positions for ${w.address}: ${e.message}`)
      }
    }

    // 4. Calculate diff using pure domain helper
    const diff = domain.diffSmartWalletPositions(currentPositions, snapshot)

    if (diff.isFirstRun) {
      saveJsonFile(snapshotPath, diff.nextSnapshot)
      log(
        'cron',
        `[SmartWallets] Smart wallets initialized (baseline snapshot recorded with ${diff.nextSnapshot.positions.length} positions).`,
      )
      return 'Smart wallets initialized (baseline snapshot recorded).'
    }

    if (!diff.newPositions.length) {
      log('cron', '[SmartWallets] No new positions detected by smart wallets.')
      return 'No new positions detected by smart wallets.'
    }

    const maxPositions = config.risk?.maxPositions ?? 3
    const initialOpenCount = getTrackedPositions(true).length
    if (initialOpenCount >= maxPositions) {
      log('cron', `[SmartWallets] Already at max positions cap (${initialOpenCount}/${maxPositions}).`)
      return 'Smart wallet cycle completed. Deployed to 0 new pools (at max positions cap).'
    }

    // 5. Deploy on candidate pools and track resolution
    let deployedCount = 0
    const deployedPools = new Set<string>()
    const processedPositions: { position: string; resolved: boolean }[] = []

    for (const posItem of diff.newPositions) {
      const pool = posItem.pool
      if (!pool) continue

      try {
        const openPositions = getTrackedPositions(true)
        if (initialOpenCount + deployedCount >= maxPositions || openPositions.length + deployedCount >= maxPositions) {
          log(
            'cron',
            `[SmartWallets] Reached max positions cap (${initialOpenCount + deployedCount}/${maxPositions}). Stopping deploy loop.`,
          )
          break
        }

        // Skip if already deployed
        if (openPositions.some((p) => p.pool === pool) || deployedPools.has(pool)) {
          log('cron', `[SmartWallets] Skipped pool ${pool}: Already have an open position.`)
          processedPositions.push({ position: posItem.position, resolved: true })
          continue
        }

        // Fetch pool detail and evaluate veto
        const detail = await screening.getPoolDetail({ pool_address: pool })
        if (!detail) {
          log('cron', `[SmartWallets] Could not fetch pool details for ${pool}.`)
          processedPositions.push({ position: posItem.position, resolved: false })
          continue
        }

        const rejectReason = screening.getRawPoolScreeningRejectReason(detail as any, config.screening)
        if (rejectReason) {
          log('cron', `[SmartWallets] Vetoed ${detail.name || pool}: ${rejectReason}`)
          processedPositions.push({ position: posItem.position, resolved: true })
          continue
        }

        // Deploy
        log('cron', `[SmartWallets] Deploying to ${detail.name || pool} (Smart wallet signal)`)
        if (liveMessage) {
          await this.adapters.telegram
            .editMessageWithButtons(
              `🚀 Smart Wallet Signal: ${detail.name || pool}\nDeploying ${deployAmount} SOL...`,
              liveMessage.message_id,
              [],
            )
            .catch((err: any) => {
              log('telegram_warn', `Failed to edit live message for smart wallet deploy: ${err?.message || err}`)
            })
        }

        const deployRes = await meteora.deployPosition({
          pool_address: pool,
          amount_sol: deployAmount,
          strategy: config.strategy.strategyMeteora,
        })

        domain.recordPositionSnapshot(pool, deployRes.position)
        log('cron', `[SmartWallets] Deployed ${deployRes.position.position} on ${detail.name || pool}`)
        deployedPools.add(pool)
        deployedCount++
        processedPositions.push({ position: posItem.position, resolved: true })
      } catch (e: any) {
        log('cron_error', `[SmartWallets] Deploy failed for pool ${pool}: ${e.message}`)
        processedPositions.push({ position: posItem.position, resolved: false })
      }
    }

    // Save updated snapshot after processing
    const updatedSnapshot = domain.updateSnapshotPositions(diff.nextSnapshot, processedPositions)
    saveJsonFile(snapshotPath, updatedSnapshot)

    return `Smart wallet cycle completed. Deployed to ${deployedCount} new pools.`
  }

  async runDeterministicScreen(limit = 5): Promise<string> {
    const top = await this.adapters.screening.getTopCandidates({ limit })
    const candidates = (top?.candidates || top?.pools || []).slice(0, limit)
    this.setLatestCandidates(candidates)
    if (candidates.length > 0) {
      const lines = candidates.map((pool: any, i: number) => {
        const feeTvl = pool.fee_active_tvl_ratio ?? pool.fee_tvl_ratio ?? '?'
        const vol = pool.volume_window ?? pool.volume_24h ?? '?'
        return `${i + 1}. ${pool.name} | ${pool.pool}\n   windowed fee/TVL ${feeTvl}% | vol $${vol} | organic ${pool.organic_score ?? '?'}`
      })
      return `Top candidates (${candidates.length})\n\n${lines.join('\n')}`
    }
    const examples = (top?.filtered_examples || [])
      .slice(0, 3)
      .map((entry: any) => `- ${entry.name}: ${entry.reason}`)
      .join('\n')
    return examples ? `No candidates available.\nFiltered examples:\n${examples}` : 'No candidates available right now.'
  }

  // ─── Deploy Latest Candidate ───────────────────────────────────

  async deployLatestCandidate(
    index: number,
  ): Promise<{ result: any; candidate: any; deployAmount: number; binsBelow: number }> {
    const candidate = this.latestCandidates[index]
    if (!candidate) {
      throw new Error('Invalid candidate index. Run /screen first.')
    }
    if (this.latestCandidates.length === 1) {
      const mint = candidate.base?.mint || candidate.base_mint || null
      const [smartWallets, narrative, tokenInfo] = await Promise.allSettled([
        this.adapters.domain.checkSmartWalletsOnPool({ pool_address: candidate.pool }),
        mint ? this.adapters.domain.getTokenNarrative({ mint }) : Promise.resolve(null),
        mint ? this.adapters.domain.getTokenInfo({ query: mint }) : Promise.resolve(null),
      ])
      const context = {
        pool: candidate,
        sw: smartWallets.status === 'fulfilled' ? smartWallets.value : null,
        n: narrative.status === 'fulfilled' ? narrative.value : null,
        ti: tokenInfo.status === 'fulfilled' ? tokenInfo.value?.results?.[0] : null,
      }
      const skipReason = this.getLoneCandidateSkipReason(context)
      if (skipReason) {
        this.adapters.domain.appendDecision({
          type: 'no_deploy',
          actor: 'SCREENER',
          summary: 'Single cached candidate skipped',
          reason: skipReason,
          pool: candidate.pool,
          pool_name: candidate.name,
        })
        throw new Error(`NO DEPLOY: only cached candidate ${candidate.name} is not worth deploying — ${skipReason}`)
      }
    }
    const deployAmount = computeDeployAmount((await this.adapters.wallet.getWalletBalances()).sol)
    const binsBelow = computeBinsBelow(candidate.volatility)
    const result = await this.adapters.toolExecutor.executeTool('deploy_position', {
      pool_address: candidate.pool,
      amount_y: deployAmount,
      strategy: config.strategy.strategyMeteora,
      bins_below: binsBelow,
      bins_above: 0,
      pool_name: candidate.name,
      base_mint: candidate.base?.mint || candidate.base_mint || null,
      bin_step: candidate.bin_step,
      base_fee: candidate.base_fee,
      volatility: candidate.volatility,
      fee_tvl_ratio: candidate.fee_active_tvl_ratio ?? candidate.fee_tvl_ratio,
      organic_score: candidate.organic_score,
      initial_value_usd: candidate.tvl ?? candidate.active_tvl ?? null,
    })
    if (result?.success === false || result?.error) {
      throw new Error(result.error || 'Deploy failed')
    }
    return { result, candidate, deployAmount, binsBelow }
  }

  // ─── Settings Menu ─────────────────────────────────────────────

  private settingValue(key: string): unknown {
    const values: Record<string, unknown> = {
      solMode: config.management.solMode,
      lpAgentRelayEnabled: config.api.meridian.lpAgentRelayEnabled,
      chartIndicatorsEnabled: config.indicators.enabled,
      trailingTakeProfit: config.management.trailingTakeProfit,
      blockPvpSymbols: config.screening.blockPvpSymbols,
      strategy: config.strategy.strategyMeteora,
      minBinsBelow: config.strategy.minBinsBelow,
      maxBinsBelow: config.strategy.maxBinsBelow,
      defaultBinsBelow: config.strategy.defaultBinsBelow,
      deployAmountSol: config.management.deployAmountSol,
      gasReserve: config.management.gasReserve,
      maxPositions: config.risk.maxPositions,
      maxDeployAmount: config.risk.maxDeployAmount,
      takeProfitPct: config.management.takeProfitPct,
      stopLossPct: config.management.stopLossPct,
      trailingTriggerPct: config.management.trailingTriggerPct,
      trailingDropPct: config.management.trailingDropPct,
      repeatDeployCooldownEnabled: config.management.repeatDeployCooldownEnabled,
      repeatDeployCooldownTriggerCount: config.management.repeatDeployCooldownTriggerCount,
      repeatDeployCooldownHours: config.management.repeatDeployCooldownHours,
      repeatDeployCooldownMinFeeEarnedPct: config.management.repeatDeployCooldownMinFeeEarnedPct,
      managementIntervalMin: config.schedule.managementIntervalMin,
      screeningIntervalMin: config.schedule.screeningIntervalMin,
      indicatorEntryPreset: config.indicators.entryPreset,
      indicatorExitPreset: config.indicators.exitPreset,
      rsiLength: config.indicators.rsiLength,
      indicatorIntervals: config.indicators.intervals,
      requireAllIntervals: config.indicators.requireAllIntervals,
    }
    return values[key]
  }

  private fmtSettingValue(value: unknown): string {
    if (Array.isArray(value)) return value.join(',')
    if (typeof value === 'boolean') return value ? 'on' : 'off'
    return String(value)
  }

  private settingButton(label: string, data: string): { text: string; callback_data: string } {
    return { text: label, callback_data: data }
  }

  private toggleButton(key: string, label: string): { text: string; callback_data: string } {
    return this.settingButton(`${label}: ${this.fmtSettingValue(this.settingValue(key))}`, `cfg:toggle:${key}`)
  }

  private stepButtons(
    key: string,
    label: string,
    step: number,
    { digits = 2 } = {},
  ): Array<{ text: string; callback_data: string }> {
    const value = Number(this.settingValue(key))
    const shown = Number.isFinite(value) ? value.toFixed(digits).replace(/\.?0+$/, '') : '?'
    return [
      this.settingButton(`- ${label}`, `cfg:step:${key}:${-step}`),
      this.settingButton(`${label}: ${shown}`, 'cfg:noop'),
      this.settingButton(`+ ${label}`, `cfg:step:${key}:${step}`),
    ]
  }

  renderSettingsMenu(page = 'main'): { text: string; keyboard: Array<Array<{ text: string; callback_data: string }>> } {
    const title = page === 'main' ? 'Settings menu' : `Settings: ${page}`
    const summary = [
      title,
      '',
      `Mode: ${config.management.solMode ? 'SOL' : 'USD'} | Relay: ${config.api.meridian.lpAgentRelayEnabled ? 'on' : 'off'}`,
      `Strategy: ${config.strategy.strategyMeteora} | bins ${config.strategy.minBinsBelow}-${config.strategy.maxBinsBelow} | deploy ${config.management.deployAmountSol} SOL`,
      `TP/SL: ${config.management.takeProfitPct}% / ${config.management.stopLossPct}% | trailing ${config.management.trailingTakeProfit ? 'on' : 'off'}`,
      `Indicators: ${config.indicators.enabled ? 'on' : 'off'} | entry ${config.indicators.entryPreset} | ${this.fmtSettingValue(config.indicators.intervals)}`,
    ].join('\n')

    const nav = [
      [
        this.settingButton('Main', 'cfg:page:main'),
        this.settingButton('Risk', 'cfg:page:risk'),
        this.settingButton('Screen', 'cfg:page:screen'),
        this.settingButton('Indicators', 'cfg:page:indicators'),
      ],
    ]

    const footer = [[this.settingButton('Refresh', `cfg:page:${page}`), this.settingButton('Close', 'cfg:close')]]

    let rows: Array<Array<{ text: string; callback_data: string }>>
    if (page === 'risk') {
      rows = [
        this.stepButtons('deployAmountSol', 'Deploy', 0.1),
        this.stepButtons('gasReserve', 'Gas', 0.05),
        this.stepButtons('maxPositions', 'Max pos', 1, { digits: 0 }),
        this.stepButtons('maxDeployAmount', 'Max SOL', 1, { digits: 0 }),
        this.stepButtons('takeProfitPct', 'TP %', 1, { digits: 0 }),
        this.stepButtons('stopLossPct', 'SL %', 5, { digits: 0 }),
        [this.toggleButton('trailingTakeProfit', 'Trailing TP')],
        this.stepButtons('trailingTriggerPct', 'Trail trigger', 0.5, { digits: 1 }),
        this.stepButtons('trailingDropPct', 'Trail drop', 0.5, { digits: 1 }),
        [this.toggleButton('repeatDeployCooldownEnabled', 'Repeat cooldown')],
        this.stepButtons('repeatDeployCooldownTriggerCount', 'Repeat count', 1, { digits: 0 }),
        this.stepButtons('repeatDeployCooldownHours', 'Repeat hrs', 1, { digits: 0 }),
        this.stepButtons('repeatDeployCooldownMinFeeEarnedPct', 'Fee earned %', 0.1, { digits: 1 }),
      ]
    } else if (page === 'screen') {
      rows = [
        [this.toggleButton('blockPvpSymbols', 'PVP hard block')],
        [
          this.settingButton('Strategy: spot', 'cfg:set:strategy:spot'),
          this.settingButton('Strategy: bid_ask', 'cfg:set:strategy:bid_ask'),
        ],
        this.stepButtons('minBinsBelow', 'Min bins', 1, { digits: 0 }),
        this.stepButtons('maxBinsBelow', 'Max bins', 1, { digits: 0 }),
        this.stepButtons('defaultBinsBelow', 'Default bins', 1, { digits: 0 }),
        this.stepButtons('managementIntervalMin', 'Manage min', 1, { digits: 0 }),
        this.stepButtons('screeningIntervalMin', 'Screen min', 5, { digits: 0 }),
      ]
    } else if (page === 'indicators') {
      rows = [
        [
          this.toggleButton('chartIndicatorsEnabled', 'Chart indicators'),
          this.toggleButton('requireAllIntervals', 'Require all TF'),
        ],
        [
          this.settingButton('TF: 5m', 'cfg:set:indicatorIntervals:5_MINUTE'),
          this.settingButton('TF: 15m', 'cfg:set:indicatorIntervals:15_MINUTE'),
          this.settingButton('TF: both', 'cfg:set:indicatorIntervals:both'),
        ],
        [
          this.settingButton('Entry: ST', 'cfg:set:indicatorEntryPreset:supertrend_break'),
          this.settingButton('Entry: RSI', 'cfg:set:indicatorEntryPreset:rsi_reversal'),
          this.settingButton('Entry: ST/RSI', 'cfg:set:indicatorEntryPreset:supertrend_or_rsi'),
        ],
        [
          this.settingButton('Exit: ST', 'cfg:set:indicatorExitPreset:supertrend_break'),
          this.settingButton('Exit: RSI', 'cfg:set:indicatorExitPreset:rsi_reversal'),
          this.settingButton('Exit: BB+RSI', 'cfg:set:indicatorExitPreset:bb_plus_rsi'),
        ],
        this.stepButtons('rsiLength', 'RSI len', 1, { digits: 0 }),
      ]
    } else {
      rows = [
        [this.toggleButton('solMode', 'SOL mode'), this.toggleButton('lpAgentRelayEnabled', 'LPAgent relay')],
        [
          this.toggleButton('chartIndicatorsEnabled', 'Chart indicators'),
          this.toggleButton('trailingTakeProfit', 'Trailing TP'),
        ],
        [this.settingButton('Risk / deploy', 'cfg:page:risk'), this.settingButton('Screening', 'cfg:page:screen')],
        [this.settingButton('Indicators', 'cfg:page:indicators'), this.settingButton('Show config', 'cfg:show')],
      ]
    }

    return { text: summary, keyboard: [...nav, ...rows, ...footer] }
  }

  private async showSettingsMenu({ messageId = null, page = 'main' } = {}): Promise<void> {
    const menu = this.renderSettingsMenu(page)
    if (messageId) {
      await this.adapters.telegram.editMessageWithButtons(menu.text, messageId, menu.keyboard)
    } else {
      await this.adapters.telegram.sendMessageWithButtons(menu.text, menu.keyboard)
    }
  }

  private normalizeMenuValue(key: string, raw: string): unknown {
    if (key === 'indicatorIntervals') {
      if (raw === 'both') return ['5_MINUTE', '15_MINUTE']
      return [raw]
    }
    return parseConfigValue(raw)
  }

  private async applySettingsMenuCallback(msg: any): Promise<void> {
    const data = msg.callbackData || msg.text || ''
    const parts = data.split(':')
    const action = parts[1]

    if (action === 'noop') {
      await this.adapters.telegram.answerCallbackQuery(msg.callbackQueryId)
      return
    }
    if (action === 'close') {
      await this.adapters.telegram.answerCallbackQuery(msg.callbackQueryId, 'Closed')
      await this.adapters.telegram.editMessage('Settings menu closed.', msg.messageId)
      return
    }
    if (action === 'show') {
      await this.adapters.telegram.answerCallbackQuery(msg.callbackQueryId)
      await this.adapters.telegram.editMessageWithButtons(this.formatConfigSnapshot(), msg.messageId, [
        [this.settingButton('Back', 'cfg:page:main')],
      ])
      return
    }
    if (action === 'page') {
      const page = parts[2] || 'main'
      await this.adapters.telegram.answerCallbackQuery(msg.callbackQueryId)
      await this.showSettingsMenu({ messageId: msg.messageId, page })
      return
    }

    const key = parts[2]
    let value: unknown
    if (action === 'toggle') {
      value = !this.settingValue(key)
    } else if (action === 'step') {
      const current = Number(this.settingValue(key))
      const delta = Number(parts[3])
      if (!Number.isFinite(current) || !Number.isFinite(delta)) {
        await this.adapters.telegram.answerCallbackQuery(msg.callbackQueryId, 'Invalid setting')
        return
      }
      value = Number((current + delta).toFixed(4))
      if (key === 'maxPositions') value = Math.max(1, Math.round(value as number))
      if (key === 'rsiLength') value = Math.max(2, Math.round(value as number))
      if (key === 'repeatDeployCooldownTriggerCount') value = Math.max(1, Math.round(value as number))
      if (key === 'repeatDeployCooldownHours') value = Math.max(0, Math.round(value as number))
      if (key === 'repeatDeployCooldownMinFeeEarnedPct') value = Math.max(0, value as number)
      if (['minBinsBelow', 'maxBinsBelow', 'defaultBinsBelow'].includes(key))
        value = Math.max(35, Math.round(value as number))
      if (['deployAmountSol', 'gasReserve', 'maxDeployAmount'].includes(key)) value = Math.max(0, value as number)
    } else if (action === 'set') {
      value = this.normalizeMenuValue(key, parts.slice(3).join(':'))
    } else {
      await this.adapters.telegram.answerCallbackQuery(msg.callbackQueryId, 'Unknown action')
      return
    }

    const result = await this.adapters.toolExecutor.executeTool('update_config', {
      changes: { [key]: value },
      reason: 'Telegram settings menu',
    })
    if (!result?.success) {
      await this.adapters.telegram.answerCallbackQuery(msg.callbackQueryId, 'Config update failed')
      return
    }
    const targetPage =
      key.startsWith('indicator') ||
      key === 'chartIndicatorsEnabled' ||
      key === 'rsiLength' ||
      key === 'requireAllIntervals'
        ? 'indicators'
        : [
              'blockPvpSymbols',
              'strategy',
              'minBinsBelow',
              'maxBinsBelow',
              'defaultBinsBelow',
              'managementIntervalMin',
              'screeningIntervalMin',
            ].includes(key)
          ? 'screen'
          : 'risk'
    await this.adapters.telegram.answerCallbackQuery(msg.callbackQueryId, `Updated ${key}`)
    await this.showSettingsMenu({ messageId: msg.messageId, page: targetPage })
  }

  private formatConfigSnapshot(): string {
    return [
      'Config snapshot',
      '',
      `Strategy: ${config.strategy.strategyMeteora} | binsBelow: ${config.strategy.minBinsBelow}-${config.strategy.maxBinsBelow} | default ${config.strategy.defaultBinsBelow}`,
      `Deploy: ${config.management.deployAmountSol} SOL | gasReserve: ${config.management.gasReserve} | maxPositions: ${config.risk.maxPositions}`,
      `Stop loss: ${config.management.stopLossPct}% | take profit: ${config.management.takeProfitPct}%`,
      `Trailing: ${config.management.trailingTakeProfit ? 'on' : 'off'} | trigger ${config.management.trailingTriggerPct}% | drop ${config.management.trailingDropPct}%`,
      `OOR: ${config.management.outOfRangeWaitMinutes}m | cooldown ${config.management.oorCooldownTriggerCount}x / ${config.management.oorCooldownHours}h`,
      `Repeat deploy cooldown: ${config.management.repeatDeployCooldownEnabled ? 'on' : 'off'} | ${config.management.repeatDeployCooldownTriggerCount}x / ${config.management.repeatDeployCooldownHours}h | min fee earned ${config.management.repeatDeployCooldownMinFeeEarnedPct}% | ${config.management.repeatDeployCooldownScope}`,
      `Yield floor: ${config.management.minFeePerTvl24h}% | min age ${config.management.minAgeBeforeYieldCheck}m`,
      `Screening: ${config.screening.category} / ${config.screening.timeframe} | TVL ${config.screening.minTvl}-${config.screening.maxTvl}`,
      `Intervals: manage ${config.schedule.managementIntervalMin}m | screen ${config.schedule.screeningIntervalMin}m`,
      `HiveMind: ${this.adapters.hivemind.isHiveMindEnabled() ? 'enabled' : 'disabled'}${config.hiveMind.agentId ? ` | ${config.hiveMind.agentId}` : ''}`,
    ].join('\n')
  }

  // ─── Telegram Handler ──────────────────────────────────────────

  private async sendTelegramSafe(text: string): Promise<any> {
    if (!this.adapters.telegram?.isEnabled?.()) return null
    try {
      return await this.adapters.telegram.sendMessage(text)
    } catch (err: any) {
      log('telegram_warn', `Failed to send Telegram message: ${err?.message || err}`)
      return null
    }
  }

  private async telegramHandler(msg: any): Promise<void> {
    if (this.shuttingDown) return
    const text = msg?.text?.trim()
    if (!text) return
    if (msg?.isCallback && text.startsWith('cfg:')) {
      try {
        await this.applySettingsMenuCallback(msg)
      } catch (e: any) {
        await this.adapters.telegram.answerCallbackQuery(msg.callbackQueryId, e.message).catch((err: any) => {
          log('telegram_warn', `Failed to answer callback query: ${err?.message || err}`)
        })
      }
      return
    }
    if (text === '/settings' || text === '/menu' || text === '/configmenu') {
      await this.showSettingsMenu().catch(async (e: any) => {
        log('telegram_warn', `Failed to show settings menu: ${e.message}`)
        await this.sendTelegramSafe(`Settings error: ${e.message}`)
      })
      return
    }
    if (this.managementBusy || this.screeningBusy || this.pnlPollBusy || this.opportunityPollBusy || this.busy) {
      if (this.telegramQueue.length < this.MAX_TELEGRAM_QUEUE) {
        this.telegramQueue.push(msg)
        this.saveTelegramQueue()
        await this.sendTelegramSafe(`⏳ Queued (${this.telegramQueue.length} in queue): "${text.slice(0, 60)}"`)
      } else {
        await this.sendTelegramSafe('Queue is full (5 messages). Wait for the agent to finish.')
      }
      return
    }

    if (text === '/briefing') {
      try {
        const briefing = await this.getBriefingWithSolPrice()
        await this.sendTelegramSafe(briefing)
      } catch (e: any) {
        await this.sendTelegramSafe(`Error: ${e.message}`)
      }
      return
    }

    if (text === '/help') {
      await this.sendTelegramSafe(this.formatHelpText())
      return
    }

    if (text === '/wallet' || text === '/status') {
      try {
        const [wallet, positions] = await Promise.all([
          this.adapters.wallet.getWalletBalances(),
          this.adapters.meteora.getMyPositions({ force: true }),
        ])
        const suffix =
          text === '/status' && positions.total_positions ? '\n\nUse /positions for the numbered list.' : ''
        await this.sendTelegramSafe(`${this.formatWalletStatus(wallet, positions)}${suffix}`)
      } catch (e: any) {
        await this.sendTelegramSafe(`Error: ${e.message}`)
      }
      return
    }

    if (text === '/config') {
      await this.sendTelegramSafe(this.formatConfigSnapshot())
      return
    }

    if (text === '/positions') {
      try {
        const { positions, total_positions } = await this.adapters.meteora.getMyPositions({ force: true })
        if (total_positions === 0) {
          await this.sendTelegramSafe('No open positions.')
          return
        }
        const cur = config.management.solMode ? '◎' : '$'
        const lines = positions.map((p: any, i: number) => {
          const pnl = p.pnl_usd >= 0 ? `+${cur}${p.pnl_usd}` : `-${cur}${Math.abs(p.pnl_usd)}`
          const age = p.age_minutes != null ? `${p.age_minutes}m` : '?'
          const oor = !p.in_range ? ' ⚠️OOR' : ''
          return `${i + 1}. ${p.pair} | ${cur}${p.total_value_usd} | PnL: ${pnl} | fees: ${cur}${p.unclaimed_fees_usd} | ${age}${oor}`
        })
        await this.sendTelegramSafe(
          `📊 Open Positions (${total_positions}):\n\n${lines.join('\n')}\n\n/close <n> to close | /set <n> <note> to set instruction`,
        )
      } catch (e: any) {
        await this.sendTelegramSafe(`Error: ${e.message}`)
      }
      return
    }

    const poolMatch = text.match(/^\/pool\s+(\d+)$/i)
    if (poolMatch) {
      try {
        const idx = parseInt(poolMatch[1], 10) - 1
        const { positions } = await this.adapters.meteora.getMyPositions({ force: true })
        if (idx < 0 || idx >= positions.length) {
          await this.sendTelegramSafe('Invalid number. Use /positions first.')
          return
        }
        const pos = positions[idx]
        await this.sendTelegramSafe(
          [
            `${idx + 1}. ${pos.pair}`,
            `Pool: ${pos.pool}`,
            `Position: ${pos.position}`,
            `Range: ${pos.lower_bin} → ${pos.upper_bin} | active ${pos.active_bin}`,
            `PnL: ${pos.pnl_pct ?? '?'}% | fees: ${config.management.solMode ? '◎' : '$'}${pos.unclaimed_fees_usd ?? '?'}`,
            `Value: ${config.management.solMode ? '◎' : '$'}${pos.total_value_usd ?? '?'}`,
            `Age: ${pos.age_minutes ?? '?'}m | ${pos.in_range ? 'IN RANGE' : `OOR ${pos.minutes_out_of_range ?? 0}m`}`,
            pos.instruction ? `Note: ${pos.instruction}` : null,
          ]
            .filter(Boolean)
            .join('\n'),
        )
      } catch (e: any) {
        await this.sendTelegramSafe(`Error: ${e.message}`)
      }
      return
    }

    const closeMatch = text.match(/^\/close\s+(\d+)(\s+--skip-swap)?$/i)
    if (closeMatch) {
      try {
        const idx = parseInt(closeMatch[1], 10) - 1
        const skipSwap = Boolean(closeMatch[2])
        const { positions } = await this.adapters.meteora.getMyPositions({ force: true })
        if (idx < 0 || idx >= positions.length) {
          await this.sendTelegramSafe('Invalid number. Use /positions first.')
          return
        }
        const pos = positions[idx]
        await this.sendTelegramSafe(`Closing ${pos.pair}${skipSwap ? ' (skipping auto-swap)' : ''}...`)
        const result = await this.adapters.toolExecutor.executeTool('close_position', {
          position_address: pos.position,
          skip_swap: skipSwap,
          reason: 'Telegram /close command',
        })
        if (result.success) {
          const closeTxs = result.close_txs?.length ? result.close_txs : result.txs
          const claimNote = result.claim_txs?.length ? `\nClaim txs: ${result.claim_txs.join(', ')}` : ''
          const swapNote = result.auto_swapped
            ? `\nAuto-swapped base token → ${result.sol_received ? `◎${result.sol_received.toFixed(4)} SOL` : 'SOL'}`
            : ''
          await this.sendTelegramSafe(
            `✅ Closed ${pos.pair}\nPnL: ${config.management.solMode ? '◎' : '$'}${result.pnl_usd ?? '?'}${swapNote} | close txs: ${closeTxs?.join(', ') || 'n/a'}${claimNote}`,
          )
        } else {
          await this.sendTelegramSafe(`❌ Close failed: ${result.error || JSON.stringify(result)}`)
        }
      } catch (e: any) {
        await this.sendTelegramSafe(`Error: ${e.message}`)
      }
      return
    }

    if (text === '/closeall' || text === '/closeall --skip-swap') {
      try {
        const skipSwap = text.includes('--skip-swap')
        const { positions } = await this.adapters.meteora.getMyPositions({ force: true })
        if (!positions.length) {
          await this.sendTelegramSafe('No open positions.')
          return
        }
        await this.sendTelegramSafe(`Closing ${positions.length} position(s)...`)
        const results: string[] = []
        for (const pos of positions) {
          try {
            const result = await this.adapters.toolExecutor.executeTool('close_position', {
              position_address: pos.position,
              skip_swap: skipSwap,
              reason: 'Telegram /closeall command',
            })
            const swapStatus = result.auto_swapped ? ' (swapped to SOL)' : ''
            results.push(
              `${pos.pair}: ${result.success ? `closed${swapStatus}` : `failed (${result.error || 'unknown'})`}`,
            )
          } catch (error: any) {
            results.push(`${pos.pair}: failed (${error.message})`)
          }
        }
        await this.sendTelegramSafe(`Close-all finished.\n\n${results.join('\n')}`)
      } catch (e: any) {
        await this.sendTelegramSafe(`Error: ${e.message}`)
      }
      return
    }

    const setMatch = text.match(/^\/set\s+(\d+)\s+(.+)$/i)
    if (setMatch) {
      try {
        const idx = parseInt(setMatch[1], 10) - 1
        const note = setMatch[2].trim()
        const { positions } = await this.adapters.meteora.getMyPositions({ force: true })
        if (idx < 0 || idx >= positions.length) {
          await this.sendTelegramSafe('Invalid number. Use /positions first.')
          return
        }
        const pos = positions[idx]
        setPositionInstruction(pos.position, note)
        await this.sendTelegramSafe(`✅ Note set for ${pos.pair}:\n"${note}"`)
      } catch (e: any) {
        await this.sendTelegramSafe(`Error: ${e.message}`)
      }
      return
    }

    const setCfgMatch = text.match(/^\/setcfg\s+([A-Za-z0-9_]+)\s+(.+)$/i)
    if (setCfgMatch) {
      try {
        const key = setCfgMatch[1]
        const value = parseConfigValue(setCfgMatch[2])
        const result = await this.adapters.toolExecutor.executeTool('update_config', {
          changes: { [key]: value },
          reason: 'Telegram slash command /setcfg',
        })
        if (!result?.success) {
          await this.sendTelegramSafe(`Config update failed.\nUnknown: ${(result?.unknown || []).join(', ') || 'none'}`)
          return
        }
        await this.sendTelegramSafe(`✅ Updated ${key} = ${JSON.stringify(value)}`)
      } catch (e: any) {
        await this.sendTelegramSafe(`Error: ${e.message}`)
      }
      return
    }

    if (text === '/screen') {
      try {
        await this.sendTelegramSafe(await this.runDeterministicScreen(5))
      } catch (e: any) {
        await this.sendTelegramSafe(`Error: ${e.message}`)
      }
      return
    }

    if (text === '/candidates') {
      await this.sendTelegramSafe(this.describeLatestCandidates(5))
      return
    }

    const deployMatch = text.match(/^\/deploy\s+(\d+)$/i)
    if (deployMatch) {
      try {
        const idx = parseInt(deployMatch[1], 10) - 1
        const { candidate, result, deployAmount, binsBelow } = await this.deployLatestCandidate(idx)
        const coverage = result.range_coverage
          ? `Range: ${fmtPct(result.range_coverage.downside_pct)} downside | ${fmtPct(result.range_coverage.upside_pct)} upside`
          : `Strategy: ${config.strategy.strategyMeteora} | binsBelow: ${binsBelow}`
        await this.sendTelegramSafe(
          [
            `✅ Deployed ${candidate.name}`,
            `Pool: ${candidate.pool}`,
            `Amount: ${deployAmount} SOL`,
            coverage,
            `Position: ${result.position || 'n/a'}`,
            result.txs?.length ? `Tx: ${result.txs[0]}` : null,
          ]
            .filter(Boolean)
            .join('\n'),
        )
      } catch (e: any) {
        await this.sendTelegramSafe(`Error: ${e.message}`)
      }
      return
    }

    if (text === '/pause') {
      this.stopCronJobs()
      this.cronStarted = false
      await this.sendTelegramSafe(
        '⏸ Paused autonomous cycles. Telegram control still works. Use /resume to start again.',
      )
      return
    }

    if (text === '/stop') {
      await this.sendTelegramSafe('🛑 Shutting down agent...')
      await this.shutdown('telegram /stop')
      return
    }

    if (text === '/resume') {
      if (!this.cronStarted) {
        this.cronStarted = true
        this.managementLastRun = Date.now()
        this.screeningLastRun = Date.now()
        this.startCronJobs()
        await this.sendTelegramSafe('▶️ Autonomous cycles resumed.')
      } else {
        await this.sendTelegramSafe('Autonomous cycles are already running.')
      }
      return
    }

    if (text === '/hive' || text === '/hive pull') {
      try {
        const enabled = this.adapters.hivemind.isHiveMindEnabled()
        const agentId = this.adapters.hivemind.ensureAgentId()
        if (!enabled) {
          await this.sendTelegramSafe(`HiveMind: disabled\nAgent ID: ${agentId}\nSet hiveMindApiKey to connect.`)
          return
        }
        const isManualPull = text === '/hive pull'
        const pullMode = this.adapters.hivemind.getHiveMindPullMode()
        const [registerResult, lessons, presets] = await Promise.all([
          this.adapters.hivemind.registerHiveMindAgent({ reason: isManualPull ? 'telegram_pull' : 'telegram_status' }),
          pullMode === 'auto' || isManualPull ? this.adapters.hivemind.pullHiveMindLessons(12) : Promise.resolve(null),
          pullMode === 'auto' || isManualPull ? this.adapters.hivemind.pullHiveMindPresets() : Promise.resolve(null),
        ])
        await this.sendTelegramSafe(
          [
            'HiveMind: enabled',
            `Agent ID: ${agentId}`,
            `URL: ${config.hiveMind.url}`,
            `Pull mode: ${pullMode}`,
            `Register: ${registerResult ? 'ok' : 'warn'}`,
            `Shared lessons: ${Array.isArray(lessons) ? lessons.length : pullMode === 'manual' ? 'manual' : 0}`,
            `Presets: ${Array.isArray(presets) ? presets.length : pullMode === 'manual' ? 'manual' : 0}`,
            isManualPull ? 'Manual pull: completed' : null,
          ].join('\n'),
        )
      } catch (e: any) {
        await this.sendTelegramSafe(`HiveMind error: ${e.message}`)
      }
      return
    }

    // Free-form chat
    this.busy = true
    let liveMessage: any = null
    try {
      log('telegram', `Incoming: ${text}`)
      const hasCloseIntent = /\bclose\b|\bsell\b|\bexit\b|\bwithdraw\b/i.test(text)
      const isDeployRequest =
        !hasCloseIntent && /\bdeploy\b|\bopen position\b|\blp into\b|\badd liquidity\b/i.test(text)
      const agentRole = isDeployRequest ? 'SCREENER' : 'GENERAL'
      const agentModel = agentRole === 'SCREENER' ? config.llm.screeningModel : config.llm.generalModel
      liveMessage = await this.adapters.telegram.createLiveMessage('🤖 Live Update', `Request: ${text.slice(0, 240)}`)
      const { content } = await agentLoop(text, config.llm.maxSteps, this.sessionHistory, agentRole, agentModel, null, {
        deps: this.adapters.agentLoopDeps,
        interactive: true,
        onToolStart: async ({ name }: any) => {
          await liveMessage?.toolStart(name)
        },
        onToolFinish: async ({ name, result, success }: any) => {
          await liveMessage?.toolFinish(name, result, success)
        },
      })
      this.appendHistory(text, content)
      if (liveMessage) await liveMessage.finalize(stripThink(content))
      else await this.sendTelegramSafe(stripThink(content))
    } catch (e: any) {
      if (liveMessage) {
        await liveMessage.fail(e.message).catch((err: any) => {
          log('telegram_warn', `Failed to send live message failure update: ${err?.message || err}`)
        })
      } else {
        await this.sendTelegramSafe(`Error: ${e.message}`)
      }
    } finally {
      this.busy = false
      this.refreshPrompt()
      this.drainTelegramQueue().catch((err: any) => {
        log('telegram_warn', `Failed to drain telegram queue: ${err?.message || err}`)
      })
    }
  }

  // ─── Desktop Handler ───────────────────────────────────────────

  private async desktopHandler(msg: { text: string }): Promise<string> {
    const text = msg?.text?.trim()
    if (!text) return 'Empty message'

    // Quick Command Handlers
    if (text === '/help' || text === '/start') {
      return this.formatHelpText()
    }
    if (text === '/wallet') {
      try {
        const [w, p] = await Promise.all([
          this.adapters.wallet.getWalletBalances(),
          this.adapters.meteora.getMyPositions({ silent: true }),
        ])
        return this.formatWalletStatus(w, p)
      } catch (e: any) {
        return `Wallet error: ${e.message}`
      }
    }
    if (text === '/screen') {
      try {
        return await this.runDeterministicScreen(5)
      } catch (e: any) {
        return `Screen error: ${e.message}`
      }
    }
    if (text === '/candidates') {
      return this.describeLatestCandidates(5)
    }
    if (text === '/config') {
      return this.formatConfigSnapshot()
    }
    if (text === '/briefing') {
      try {
        return await this.adapters.briefing.generateBriefing()
      } catch (e: any) {
        return `Briefing error: ${e.message}`
      }
    }

    // Free-form LLM chat via agentLoop
    this.busy = true
    let liveMessage: any = null
    try {
      log('desktop_chat', `Incoming desktop chat: ${text}`)
      const hasCloseIntent = /\bclose\b|\bsell\b|\bexit\b|\bwithdraw\b/i.test(text)
      const isDeployRequest =
        !hasCloseIntent && /\bdeploy\b|\bopen position\b|\blp into\b|\badd liquidity\b/i.test(text)
      const agentRole = isDeployRequest ? 'SCREENER' : 'GENERAL'
      const agentModel = agentRole === 'SCREENER' ? config.llm.screeningModel : config.llm.generalModel

      if (this.adapters.desktop) {
        liveMessage = await this.adapters.desktop.createLiveMessage(
          '🤖 Desktop Agent Update',
          `Request: ${text.slice(0, 240)}`,
        )
      }

      const { content } = await agentLoop(text, config.llm.maxSteps, this.sessionHistory, agentRole, agentModel, null, {
        deps: this.adapters.agentLoopDeps,
        interactive: true,
        onToolStart: async ({ name }: any) => {
          await liveMessage?.toolStart(name)
        },
        onToolFinish: async ({ name, result, success }: any) => {
          await liveMessage?.toolFinish(name, result, success)
        },
      })

      this.appendHistory(text, content)
      const cleanContent = stripThink(content)
      if (liveMessage) await liveMessage.finalize(cleanContent)
      return cleanContent
    } catch (e: any) {
      if (liveMessage) await liveMessage.fail(e.message).catch(() => {})
      return `Error: ${e.message}`
    } finally {
      this.busy = false
      this.refreshPrompt()
      this.drainTelegramQueue().catch((err: any) => {
        log('telegram_warn', `Failed to drain telegram queue: ${err?.message || err}`)
      })
    }
  }

  // ─── Helper Formatters ─────────────────────────────────────────

  private formatHelpText(): string {
    return [
      'Telegram commands',
      '',
      '/help — show commands',
      '/status — wallet + positions snapshot',
      '/wallet — wallet, deploy amount, HiveMind status',
      '/positions — list open positions',
      '/pool <n> — detailed info for one open position',
      '/close <n> — close one position by index',
      '/closeall — close all open positions',
      '/set <n> <note> — set note/instruction on position',
      '/config — show important runtime config',
      '/settings — button menu for common config',
      '/setcfg <key> <value> — update persisted config',
      '/screen — refresh deterministic candidate list',
      '/candidates — show latest cached candidates',
      '/deploy <n> — deploy candidate by cached index',
      '/briefing — morning briefing',
      '/hive — HiveMind sync status',
      '/hive pull — manual HiveMind pull now',
      '/pause — stop cron cycles',
      '/resume — start cron cycles again',
      '/stop — shut down agent',
    ].join('\n')
  }

  private formatWalletStatus(wallet: any, positions: any): string {
    const deployAmount = computeDeployAmount(wallet.sol)
    const hive = this.adapters.hivemind.isHiveMindEnabled() ? 'on' : 'off'
    return [
      `Wallet: ${wallet.sol} SOL ($${wallet.sol_usd})`,
      `SOL price: $${wallet.sol_price}`,
      `Open positions: ${positions.total_positions}/${config.risk.maxPositions}`,
      `Next deploy amount: ${deployAmount} SOL`,
      `Dry run: ${config.connection.dryRun ? 'yes' : 'no'}`,
      `HiveMind: ${hive}`,
    ].join('\n')
  }

  private describeLatestCandidates(limit = 5): string {
    if (!this.latestCandidates.length) return 'No cached candidates yet. Run /screen first.'
    const lines = this.latestCandidates.slice(0, limit).map((pool: any, i: number) => {
      const feeTvl = pool.fee_active_tvl_ratio ?? pool.fee_tvl_ratio ?? '?'
      const vol = pool.volume_window ?? pool.volume_24h ?? '?'
      const active = pool.active_pct ?? '?'
      const organic = pool.organic_score ?? '?'
      return `${i + 1}. ${pool.name} | windowed fee/TVL ${feeTvl}% | vol $${vol} | in-range ${active}% | organic ${organic}`
    })
    const age = this.latestCandidatesAt
      ? new Date(this.latestCandidatesAt).toLocaleString('en-US', { hour12: false })
      : 'unknown'
    return `Latest candidates (${this.latestCandidates.length}) — updated ${age}\n\n${lines.join('\n')}`
  }

  private formatCandidates(candidates: any[]): string {
    if (!candidates.length) return '  No eligible pools found right now.'

    const lines = candidates.map((p: any, i: number) => {
      const name = (p.name || 'unknown').padEnd(20)
      const ftvl = `${p.fee_active_tvl_ratio ?? p.fee_tvl_ratio}%`.padStart(8)
      const vol = `$${((p.volume_window || 0) / 1000).toFixed(1)}k`.padStart(8)
      const active = `${p.active_pct}%`.padStart(6)
      const org = String(p.organic_score).padStart(4)
      return `  [${i + 1}]  ${name}  windowed fee/TVL:${ftvl}  vol:${vol}  in-range:${active}  organic:${org}`
    })

    return [
      '  #   pool                  windowed fee/TVL  vol    in-range  organic',
      `  ${'─'.repeat(68)}`,
      ...lines,
    ].join('\n')
  }

  // ─── Session History ───────────────────────────────────────────

  private appendHistory(userMsg: string, assistantMsg: string): void {
    this.sessionHistory.push({ role: 'user', content: userMsg })
    this.sessionHistory.push({ role: 'assistant', content: assistantMsg })
    if (this.sessionHistory.length > this.MAX_HISTORY) {
      this.sessionHistory.splice(0, this.sessionHistory.length - this.MAX_HISTORY)
    }
  }

  // ─── REPL ──────────────────────────────────────────────────────

  private refreshPrompt(): void {
    if (!this.ttyInterface) return
    this.ttyInterface.setPrompt(this.buildPrompt())
    this.ttyInterface.prompt(true)
  }

  private getTelegramQueuePath(): string {
    return sharedDataPath(TELEGRAM_QUEUE_FILENAME)
  }

  private isSafeStartupTelegramCommand(text: string): boolean {
    const trimmed = text.trim().toLowerCase()
    return (
      trimmed === '/help' ||
      trimmed === '/status' ||
      trimmed === '/wallet' ||
      trimmed === '/positions' ||
      trimmed === '/config' ||
      trimmed === '/briefing' ||
      trimmed === '/candidates' ||
      trimmed === '/screen' ||
      /^\/pool\s+\d+$/i.test(trimmed)
    )
  }

  /**
   * Loads persisted Telegram queue from disk on startup, filtering out unsafe or stale mutating commands.
   *
   * @returns {void}
   */
  private loadTelegramQueue(): void {
    if (!this.adapters.telegram?.isEnabled?.()) {
      this.telegramQueue = []
      return
    }
    try {
      const queuePath = this.getTelegramQueuePath()
      const loaded = loadJsonFile<unknown[]>(queuePath, [])
      if (Array.isArray(loaded)) {
        const validItems: any[] = []
        for (const item of loaded) {
          const rawText = typeof item === 'string' ? item : (item as any)?.text
          if (typeof rawText !== 'string' || !rawText.trim()) continue
          const text = rawText.trim()
          if (this.isSafeStartupTelegramCommand(text)) {
            validItems.push(typeof item === 'string' ? { text } : item)
          } else {
            log(
              'startup_warn',
              `Discarded unsafe/stale command "${text.slice(0, 40)}" from persisted telegram queue on restart`,
            )
          }
        }
        this.telegramQueue = validItems.slice(0, this.MAX_TELEGRAM_QUEUE)
        if (this.telegramQueue.length > 0) {
          log('startup', `Restored ${this.telegramQueue.length} safe queued Telegram message(s) from ${queuePath}`)
        }
        this.saveTelegramQueue()
      }
    } catch (err: any) {
      log('telegram_warn', `Failed to load persisted telegram queue: ${err?.message || err}`)
      this.telegramQueue = []
    }
  }

  /**
   * Persists the in-memory Telegram queue to disk when the Telegram adapter is enabled.
   *
   * @returns {void}
   */
  private saveTelegramQueue(): void {
    if (!this.adapters.telegram?.isEnabled?.()) return
    try {
      const queuePath = this.getTelegramQueuePath()
      saveJsonFile(queuePath, this.telegramQueue)
    } catch (err: any) {
      log('telegram_warn', `Failed to persist telegram queue: ${err?.message || err}`)
    }
  }

  /**
   * Starts a 5-second recurring interval timer to autonomously drain queued Telegram commands when idle.
   *
   * @returns {void}
   */
  private startTelegramDrainTimer(): void {
    if (!this.adapters.telegram?.isEnabled?.()) return
    if (this.telegramDrainInterval) return
    this.telegramDrainInterval = setInterval(() => {
      this.drainTelegramQueue().catch((err: any) => {
        log('telegram_warn', `Periodic telegram queue drain error: ${err?.message || err}`)
      })
    }, 5000)
  }

  /**
   * Clears and nullifies the recurring Telegram drain interval timer.
   *
   * @returns {void}
   */
  private stopTelegramDrainTimer(): void {
    if (this.telegramDrainInterval) {
      clearInterval(this.telegramDrainInterval)
      this.telegramDrainInterval = null
    }
  }

  /**
   * Sequentially drains queued Telegram messages while the daemon is not running busy cycles.
   *
   * @returns {Promise<void>}
   */
  private async drainTelegramQueue(): Promise<void> {
    if (!this.adapters.telegram?.isEnabled?.() || this.draining || this.shuttingDown) return
    this.draining = true
    try {
      while (
        this.telegramQueue.length > 0 &&
        !this.managementBusy &&
        !this.screeningBusy &&
        !this.pnlPollBusy &&
        !this.opportunityPollBusy &&
        !this.busy &&
        !this.shuttingDown
      ) {
        const stopIdx = this.telegramQueue.findIndex((m: any) => {
          const t = (typeof m === 'string' ? m : m?.text)?.trim()
          return t === '/stop'
        })
        const queued = stopIdx !== -1 ? this.telegramQueue.splice(stopIdx, 1)[0] : this.telegramQueue.shift()
        this.saveTelegramQueue()
        await this.telegramHandler(queued)
      }
    } finally {
      this.draining = false
    }
  }

  private withTimeout(promise: Promise<any>, ms: number): Promise<any> {
    let timer: ReturnType<typeof setTimeout> | null = null
    return Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), ms)
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer)
    })
  }

  private async startTTY(): Promise<void> {
    const DEPLOY = config.management.deployAmountSol

    process.on('SIGINT', () => this.shutdown('SIGINT'))
    process.on('SIGTERM', () => this.shutdown('SIGTERM'))

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.buildPrompt(),
    })
    this.ttyInterface = rl

    // Update prompt countdown every 10 seconds
    this.countdownInterval = setInterval(() => {
      if (!this.busy) {
        rl.setPrompt(this.buildPrompt())
        rl.prompt(true)
      }
    }, 10_000)

    const launchCron = () => {
      if (!this.cronStarted) {
        this.cronStarted = true
        this.managementLastRun = Date.now()
        this.screeningLastRun = Date.now()
        this.startCronJobs()
        console.log('Autonomous cycles are now running.\n')
        rl.setPrompt(this.buildPrompt())
        rl.prompt(true)
      }
    }

    const runBusy = async (fn: () => Promise<void>) => {
      if (this.busy || this.managementBusy || this.screeningBusy || this.pnlPollBusy || this.opportunityPollBusy) {
        console.log('Agent is busy, please wait...')
        rl.prompt()
        return
      }
      this.busy = true
      rl.pause()
      try {
        await fn()
      } catch (e: any) {
        console.error(`Error: ${e.message}`)
      } finally {
        this.busy = false
        rl.setPrompt(this.buildPrompt())
        rl.resume()
        rl.prompt()
        this.drainTelegramQueue().catch((err: any) => {
          log('telegram_warn', `Failed to drain telegram queue: ${err?.message || err}`)
        })
      }
    }

    // ── Startup: show wallet + top candidates ──
    console.log(`
╔═══════════════════════════════════════════╗
║         DLMM LP Agent — Ready             ║
╚═══════════════════════════════════════════╝
`)

    console.log('Fetching wallet and top pool candidates...\n')

    this.busy = true
    try {
      const [wallet, positions, { candidates, total_eligible, total_screened }] = await Promise.all([
        this.adapters.wallet.getWalletBalances(),
        this.adapters.meteora.getMyPositions({ force: true }),
        this.adapters.screening.getTopCandidates({ limit: 5 }),
      ])

      this.setLatestCandidates(candidates)

      console.log(`Wallet:    ${wallet.sol} SOL  ($${wallet.sol_usd})  |  SOL price: $${wallet.sol_price}`)
      console.log(`Positions: ${positions.total_positions} open\n`)

      if (positions.total_positions > 0) {
        console.log('Open positions:')
        for (const p of positions.positions) {
          const status = p.in_range ? 'in-range ✓' : 'OUT OF RANGE ⚠'
          console.log(`  ${p.pair.padEnd(16)} ${status}  fees: $${p.unclaimed_fees_usd}`)
        }
        console.log()
      }

      console.log(`Top pools (${total_eligible} eligible from ${total_screened} screened):\n`)
      console.log(this.formatCandidates(candidates))
    } catch (e: any) {
      console.error(`Startup fetch failed: ${e.message}`)
    } finally {
      this.busy = false
    }

    // Always start autonomous cycles on launch
    launchCron()
    this.maybeRunMissedBriefing().catch(() => {})

    this.adapters.telegram.startPolling((msg: any) => this.telegramHandler(msg))

    console.log(`
Commands:
  1 / 2 / 3 ...  Deploy ${DEPLOY} SOL into that pool
  auto           Let the agent pick and deploy automatically
  /status        Refresh wallet + positions
  /candidates    Refresh top pool list
  /briefing      Show morning briefing (last 24h)
  /learn         Study top LPers from the best current pool and save lessons
  /learn <addr>  Study top LPers from a specific pool address
  /thresholds    Show current screening thresholds + performance stats
  /evolve        Manually trigger threshold evolution from performance data
  /stop          Shut down

Interactive REPL is active. Type a command or question at the prompt below and press Enter:
`)

    rl.prompt()

    rl.on('line', async (line: string) => {
      const input = line.trim()
      if (!input) {
        rl.prompt()
        return
      }

      // ── Number pick: deploy into pool N ─────
      const pick = parseInt(input, 10)
      const latest = this.getLatestCandidatesMeta().candidates
      if (!Number.isNaN(pick) && pick >= 1 && pick <= latest.length) {
        await runBusy(async () => {
          const pool = latest[pick - 1]
          console.log(`\nDeploying ${DEPLOY} SOL into ${pool.name}...\n`)
          const { content: reply } = await agentLoop(
            `Deploy ${DEPLOY} SOL into pool ${pool.pool} (${pool.name}). Call get_active_bin first then deploy_position. Report result.`,
            config.llm.maxSteps,
            [],
            'SCREENER',
            null,
            null,
            { deps: this.adapters.agentLoopDeps },
          )
          console.log(`\n${reply}\n`)
          launchCron()
        })
        return
      }

      // ── auto: agent picks and deploys ───────
      if (input.toLowerCase() === 'auto') {
        await runBusy(async () => {
          console.log('\nAgent is picking and deploying...\n')
          const { content: reply } = await agentLoop(
            `get_top_candidates and deploy only if a candidate is clearly worth it. If there is only one weak candidate, report NO DEPLOY. For a valid deploy, use amount_y=${DEPLOY}, amount_x=0, bins_above=0, and bins_below from positive volatility. Execute now, don't ask.`,
            config.llm.maxSteps,
            [],
            'SCREENER',
            null,
            null,
            { deps: this.adapters.agentLoopDeps },
          )
          console.log(`\n${reply}\n`)
          launchCron()
        })
        return
      }

      // ── go: start cron without deploying ────
      if (input.toLowerCase() === 'go') {
        launchCron()
        rl.prompt()
        return
      }

      // ── Slash commands ───────────────────────
      if (input === '/stop') {
        await this.shutdown('user command')
        return
      }

      if (input === '/status') {
        await runBusy(async () => {
          const [wallet, positions] = await Promise.all([
            this.adapters.wallet.getWalletBalances(),
            this.adapters.meteora.getMyPositions({ force: true }),
          ])
          console.log(`\nWallet: ${wallet.sol} SOL  ($${wallet.sol_usd})`)
          console.log(`Positions: ${positions.total_positions}`)
          for (const p of positions.positions) {
            const status = p.in_range ? 'in-range ✓' : 'OUT OF RANGE ⚠'
            console.log(
              `  ${p.pair.padEnd(16)} ${status}  fees: ${config.management.solMode ? '◎' : '$'}${p.unclaimed_fees_usd}`,
            )
          }
          console.log()
        })
        return
      }

      if (input === '/briefing') {
        await runBusy(async () => {
          const briefing = await this.getBriefingWithSolPrice()
          console.log(`\n${briefing}\n`)
        })
        return
      }

      if (input === '/candidates') {
        await runBusy(async () => {
          const { candidates, total_eligible, total_screened } = await this.adapters.screening.getTopCandidates({
            limit: 5,
          })
          this.setLatestCandidates(candidates)
          console.log(`\nTop pools (${total_eligible} eligible from ${total_screened} screened):\n`)
          console.log(this.formatCandidates(candidates))
          console.log()
        })
        return
      }

      if (input === '/thresholds') {
        const s = config.screening
        console.log('\nCurrent screening thresholds:')
        console.log(`  minFeeActiveTvlRatio: ${s.minFeeActiveTvlRatio}`)
        console.log(`  minOrganic:           ${s.minOrganic}`)
        console.log(`  minHolders:           ${s.minHolders}`)
        console.log(`  minTvl:               ${s.minTvl}`)
        console.log(`  maxTvl:               ${s.maxTvl}`)
        console.log(`  minVolume:            ${s.minVolume}`)
        console.log(`  minTokenFeesSol:      ${s.minTokenFeesSol}`)
        console.log(`  maxBotHoldersPct:     ${s.maxBotHoldersPct}`)
        console.log(`  maxTop10Pct:          ${s.maxTop10Pct}`)
        console.log(`  timeframe:            ${s.timeframe}`)
        console.log()
        rl.prompt()
        return
      }

      if (input.startsWith('/learn')) {
        await runBusy(async () => {
          const parts = input.split(' ')
          const poolArg = parts[1] || null

          let poolsToStudy: any[]

          if (poolArg) {
            poolsToStudy = [{ pool: poolArg, name: poolArg }]
          } else {
            console.log('\nFetching top pool candidates to study...\n')
            const { candidates } = await this.adapters.screening.getTopCandidates({ limit: 10 })
            if (!candidates.length) {
              console.log('No eligible pools found to study.\n')
              return
            }
            poolsToStudy = candidates.map((c: any) => ({ pool: c.pool, name: c.name }))
          }

          console.log(`\nStudying top LPers across ${poolsToStudy.length} pools...\n`)
          for (const p of poolsToStudy) console.log(`  • ${p.name || p.pool}`)
          console.log()

          const poolList = poolsToStudy.map((p: any, i: number) => `${i + 1}. ${p.name} (${p.pool})`).join('\n')

          const { content: reply } = await agentLoop(
            `Study top LPers across these ${poolsToStudy.length} pools by calling study_top_lpers for each:

${poolList}

For each pool, call study_top_lpers then move to the next. After studying all pools:
1. Identify patterns that appear across multiple pools (hold time, scalping vs holding, win rates).
2. Note pool-specific patterns where behaviour differs significantly.
3. Derive 4-8 concrete, actionable lessons using add_lesson. Prioritize cross-pool patterns — they're more reliable.
4. Summarize what you learned.

Focus on: hold duration, entry/exit timing, what win rates look like, whether scalpers or holders dominate.`,
            config.llm.maxSteps,
            [],
            'GENERAL',
            null,
            null,
            { deps: this.adapters.agentLoopDeps },
          )
          console.log(`\n${reply}\n`)
        })
        return
      }

      // ── Free-form chat ───────────────────────
      await runBusy(async () => {
        log('user', input)
        const { content } = await agentLoop(
          input,
          config.llm.maxSteps,
          this.sessionHistory,
          'GENERAL',
          config.llm.generalModel,
          null,
          {
            deps: this.adapters.agentLoopDeps,
            interactive: true,
          },
        )
        this.appendHistory(input, content)
        console.log(`\n${content}\n`)
      })
    })

    rl.on('close', () => this.shutdown('stdin closed'))
  }
}

// ─── Self-Execution ──────────────────────────────────────────────
function isScriptTarget(filePath: string | undefined): boolean {
  if (!filePath) return false
  const lower = filePath.toLowerCase()
  return lower.endsWith('daemon.ts') || lower.endsWith('daemon.js') || lower.endsWith('daemon.cjs')
}

const isMain =
  isScriptTarget(process.argv[1]) || (process.env.pm_exec_path ? isScriptTarget(process.env.pm_exec_path) : false)

if (isMain) {
  const agentLoopDeps: AgentLoopDeps = {
    executeTool: toolExecutor.executeTool,
    getTools: () => tools,
    getWalletBalances: async () => {
      const bal = await wallet.getWalletBalances()
      return {
        sol: bal.sol,
        usd: bal.sol_usd,
        tokens: bal.tokens.map((t: any) => ({
          mint: t.mint,
          symbol: t.symbol,
          amount: t.amount,
          usd: t.usd,
        })),
      }
    },
    getMyPositions: meteora.getMyPositions,
    getStateSummary: domain.getStateSummary,
    getLessonsForPrompt: (opts: any) => domain.getLessonsForPrompt(opts),
    getPerformanceSummary: () => {
      const summary = domain.getPerformanceSummary()
      return summary ? JSON.stringify(summary) : null
    },
    getDecisionSummary: domain.getDecisionSummary,
    getWeightsSummary: domain.getWeightsSummary,
  }

  const daemon = new Daemon({
    meteora,
    wallet,
    screening,
    toolExecutor,
    telegram,
    desktop,
    briefing,

    hivemind,
    domain: {
      ...domain,
      addPoolNote: (pool: string, note: string) => domain.addPoolNote({ pool_address: pool, note }),
      getTokenNarrative: token.getTokenNarrative,
      getTokenInfo: token.getTokenInfo,
    },
    agentLoopDeps,
  })

  const hasRepl = process.stdout.isTTY && !process.env.PM2_HOME
  daemon.start({ tty: hasRepl }).catch((err) => {
    console.error('Daemon failed to start:', err)
    process.exit(1)
  })
} else if (process.env.pm_exec_path) {
  log('pm2', `Etemaro started as a child process. No REPL available. PID: ${process.pid}`)
}
