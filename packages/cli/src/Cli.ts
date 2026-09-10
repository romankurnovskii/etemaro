/**
 * @file Cli.ts
 * @description Command-line entrypoint executing one-shot agent subcommands with JSON output format.
 *
 * @features
 * - Parses subcommands (balance, positions, candidates, screen, manage, deploy, close, swap)
 * - Outputs structured JSON for CLI automation and agent integration
 * - Writes discovery SKILL.md for local agent tools
 *
 * @dependencies Config, Adapters, ToolExecutor
 * @sideEffects One-shot tool execution and console JSON output
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { stdin as stdinStream, stdout as stdoutStream } from 'node:process'
import nodeReadline from 'node:readline'
import readline from 'node:readline/promises'
import { Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import type { GeneratedWallet } from '@etemaro/core'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'

/**
 * Prompt for a sensitive secret (such as a private key) without echoing input to terminal stdout.
 * Works consistently across both TTY and non-TTY / piped inputs.
 */
async function promptSecret(promptText: string): Promise<string> {
  return new Promise((resolve) => {
    let muted = false
    let resolved = false
    const mutableStdout = new Writable({
      write(chunk, encoding, callback) {
        if (!muted) {
          stdoutStream.write(chunk, encoding)
        }
        callback()
      },
    })

    const isTTY = Boolean((stdinStream as any).isTTY)
    const rl = nodeReadline.createInterface({
      input: stdinStream,
      output: mutableStdout,
      terminal: isTTY,
    })

    stdoutStream.write(promptText)
    muted = true

    rl.question('', (answer) => {
      if (resolved) return
      resolved = true
      muted = false
      if (isTTY) {
        stdoutStream.write('\n')
      }
      rl.close()
      resolve(answer.trim())
    })

    rl.on('close', () => {
      if (resolved) return
      resolved = true
      muted = false
      if (isTTY) {
        stdoutStream.write('\n')
      }
      resolve('')
    })
  })
}

import {
  assessSetup,
  formatInitMessage,
  loadRuntimeDotenv,
  maybePromptSecrets,
  parseEnvFile,
  upsertEnvVars,
  writeRuntimeSkeleton,
} from './firstSetup.js'

// ESM/CJS portable __filename/__dirname
// In CJS builds `__filename`/`__dirname` are real module globals, so prefer them;
// fall back to fileURLToPath for native ESM execution.
declare const __filename: string
declare const __dirname: string
let currentFilePath: string
if (typeof __filename === 'string' && __filename.length > 0) {
  currentFilePath = __filename
} else if (typeof import.meta?.url === 'string' && import.meta.url.startsWith('file:')) {
  currentFilePath = fileURLToPath(import.meta.url)
} else {
  currentFilePath = path.join(process.cwd(), 'dist', 'Cli.cjs')
}
const currentFileDir = path.dirname(currentFilePath)
// Resolve our own package.json relative to the CLI's actual location, not cwd
let pkgVersion = 'unknown'
try {
  pkgVersion = JSON.parse(fs.readFileSync(path.join(currentFileDir, '..', 'package.json'), 'utf8')).version
} catch {
  // ignore: fall back to 'unknown'
}

// Type-only imports to help tsc
type CoreExports = any
type DaemonExports = any

// Lazily populated core exports (set after flag parsing)
let config: CoreExports['config'] = null as any
let _computeDeployAmount: CoreExports['computeDeployAmount'] = null as any
let getTrackedPosition: CoreExports['getTrackedPosition'] = null as any
let _log: CoreExports['log'] = null as any
let dataPath: CoreExports['dataPath'] = null as any
let _getDataDir: CoreExports['getDataDir'] = null as any
let getEtemaroDir: CoreExports['getEtemaroDir'] = null as any
let _USER_CONFIG_PATH: CoreExports['USER_CONFIG_PATH'] = null as any
let _DEFAULT_ENTRY_SOURCE: CoreExports['DEFAULT_ENTRY_SOURCE'] = null as any
let _SMART_WALLETS_FILENAME: CoreExports['SMART_WALLETS_FILENAME'] = null as any
let LESSONS_FILENAME: CoreExports['LESSONS_FILENAME'] = null as any
let _REPO_ROOT: CoreExports['REPO_ROOT'] = null as any
let _DEFAULT_ACTIVE_STRATEGY_ID: CoreExports['DEFAULT_ACTIVE_STRATEGY_ID'] = null as any
let _DEFAULT_STRATEGY_TYPE: CoreExports['DEFAULT_STRATEGY_TYPE'] = null as any
let _strategyLibraryPath: CoreExports['strategyLibraryPath'] = null as any
let meteora: CoreExports['meteora'] = null as any
let wallet: CoreExports['wallet'] = null as any
let screening: CoreExports['screening'] = null as any
let toolExecutor: CoreExports['toolExecutor'] = null as any
let domain: CoreExports['domain'] = null as any
let token: CoreExports['token'] = null as any
let study: CoreExports['study'] = null as any
let telegram: CoreExports['telegram'] = null as any
let desktop: CoreExports['desktop'] = null as any
let briefing: CoreExports['briefing'] = null as any
let hivemind: CoreExports['hivemind'] = null as any
let tools: CoreExports['tools'] = null as any
let defaultUserConfigStr: CoreExports['defaultUserConfigStr'] = null as any
let validateConfigFile: CoreExports['validateConfigFile'] = null as any

// Lazily populated Daemon constructor
let DaemonCtor: DaemonExports['Daemon'] = null as any

/**
 * Load core and daemon modules after environment is prepared.
 * Must be called before using any core functionality.
 */
export async function loadCore(): Promise<void> {
  const [coreMod, daemonMod] = await Promise.all([import('@etemaro/core'), import('@etemaro/daemon')])
  // Assign core exports
  config = coreMod.config
  _computeDeployAmount = coreMod.computeDeployAmount
  getTrackedPosition = coreMod.getTrackedPosition
  _log = coreMod.log
  dataPath = coreMod.dataPath
  _getDataDir = coreMod.getDataDir
  getEtemaroDir = coreMod.getEtemaroDir
  _USER_CONFIG_PATH = coreMod.USER_CONFIG_PATH
  _DEFAULT_ENTRY_SOURCE = coreMod.DEFAULT_ENTRY_SOURCE
  _SMART_WALLETS_FILENAME = coreMod.SMART_WALLETS_FILENAME
  LESSONS_FILENAME = coreMod.LESSONS_FILENAME
  _REPO_ROOT = coreMod.REPO_ROOT
  _DEFAULT_ACTIVE_STRATEGY_ID = coreMod.DEFAULT_ACTIVE_STRATEGY_ID
  _DEFAULT_STRATEGY_TYPE = coreMod.DEFAULT_STRATEGY_TYPE
  _strategyLibraryPath = coreMod.strategyLibraryPath
  meteora = coreMod.meteora
  wallet = coreMod.wallet
  screening = coreMod.screening
  toolExecutor = coreMod.toolExecutor
  domain = coreMod.domain
  token = coreMod.token
  study = coreMod.study
  telegram = coreMod.telegram
  desktop = coreMod.desktop
  briefing = coreMod.briefing
  hivemind = coreMod.hivemind
  tools = coreMod.tools
  defaultUserConfigStr = coreMod.defaultUserConfigStr
  validateConfigFile = (coreMod as any).validateConfigFile
  // Assign Daemon constructor
  DaemonCtor = daemonMod.Daemon
}

// ─── Adapter Imports ────────────────────────────────────────────

export interface CliAdapters {
  meteora: {
    getMyPositions: (opts?: { force?: boolean; silent?: boolean }) => Promise<any>
    closePosition: (opts: { position_address: string }) => Promise<any>
    getActiveBin: (opts: { pool_address: string }) => Promise<any>
    getPositionPnl: (opts: { pool_address: string; position_address: string }) => Promise<any>
    searchPools: (opts: { query: string; limit: number }) => Promise<any>
    getWalletPositions: (opts: { wallet_address: string }) => Promise<any>
  }
  wallet: {
    getWalletBalances: () => Promise<any>
    swapToken: (opts: any) => Promise<any>
    generateNewWallet: (opts?: { label?: string; credentialsDir?: string }) => GeneratedWallet
    importWallet: (opts: { label: string; privateKey?: string; filePath?: string }) => GeneratedWallet
  }
  screening: {
    getTopCandidates: (opts: { limit: number }) => Promise<any>
    getPoolDetail: (opts: any) => Promise<any>
  }
  toolExecutor: {
    executeTool: (name: string, args: Record<string, unknown>) => Promise<any>
  }
  domain: {
    validateActiveStrategy: () => void
    // Structural (the core return type is not part of the prebuilt @etemaro/core declarations)
    validateStrategyFile: (filePath: string, opts?: Record<string, unknown>) => any
    validateConfigFile: (filePath: string, opts?: Record<string, unknown>) => any
    getActiveStrategy: () => any
    recallForPool: (pool: string) => string | null
    addPoolNote: (pool: string, note: string) => void
    checkSmartWalletsOnPool: (opts: { listId: string; pool_address: string }) => Promise<any>
    getTokenNarrative: (opts: { mint: string }) => Promise<any>
    getTokenInfo: (opts: { query: string }) => Promise<any>
    getTokenHolders: (opts: { mint: string; limit: number; smartWalletListId?: string }) => Promise<any>
    studyTopLPers: (opts: { pool_address: string; limit: number }) => Promise<any>
    listLessons: (opts: { limit: number }) => any
    addLesson: (text: string, tags: string[], opts: any) => void
    getPoolMemory: (opts: { pool_address: string }) => any
    evolveThresholds: (perf: any[], cfg: any) => any
    addToBlacklist: (opts: { mint: string; reason: string }) => any
    listBlacklist: () => any
    getPerformanceHistory: (opts: { hours: number; limit: number }) => any
    getPerformanceSummary: () => any
  }
  daemon?: {
    start?: (options?: { tty?: boolean }) => Promise<void>
    stop?: () => Promise<void>
    runScreeningCycle: (opts?: { silent?: boolean }) => Promise<string | null>
    runManagementCycle: (opts?: { silent?: boolean }) => Promise<string | null>
    startCronJobs: () => void
  }
  token?: {
    getTokenInfo: (opts: { query: string }) => Promise<any>
    getTokenHolders: (opts: { mint: string; limit: number }) => Promise<any>
    getTokenNarrative: (opts: { mint: string }) => Promise<any>
  }
}

// ─── SKILL.md ───────────────────────────────────────────────────

const SKILL_MD = `# etemaro — Solana DLMM LP Agent CLI

Data dir: ~/.config/etemaro/

## Commands

### etemaro balance
Returns wallet SOL and token balances.
\`\`\`
Output: { wallet, sol, sol_usd, usdc, tokens: [{mint, symbol, balance, usd_value}], total_usd }
\`\`\`

### etemaro positions
Returns all open DLMM positions.
\`\`\`
Output: { positions: [{position, pool, pair, in_range, age_minutes, ...}], total_positions }
\`\`\`

### etemaro pnl <position_address>
Returns PnL for a specific position.
\`\`\`
Output: { pnl_pct, pnl_usd, unclaimed_fee_usd, all_time_fees_usd, current_value_usd, lower_bin, upper_bin, active_bin }
\`\`\`

### etemaro screen [--dry-run] [--silent]
Runs one AI screening cycle to find and deploy new positions.
\`\`\`
Output: { done: true, report: "..." }
\`\`\`

### etemaro manage [--dry-run] [--silent]
Runs one AI management cycle over open positions.
\`\`\`
Output: { done: true, report: "..." }
\`\`\`

### etemaro deploy --pool <addr> --amount <sol> [--bins-below 69] [--bins-above 0] [--strategy bid_ask|spot] [--dry-run]
Deploys a new LP position. All safety checks apply.
\`\`\`
Output: { success, position, pool_name, txs, price_range, bin_step }
\`\`\`

### etemaro claim --position <addr>
Claims accumulated swap fees for a position.
\`\`\`
Output: { success, position, txs, base_mint }
\`\`\`

### etemaro close --position <addr> [--skip-swap] [--dry-run]
Closes a position. Auto-swaps base token to SOL unless --skip-swap.
\`\`\`
Output: { success, pnl_pct, pnl_usd, txs, base_mint }
\`\`\`

### etemaro swap --from <mint> --to <mint> --amount <n> [--dry-run]
Swaps tokens via Jupiter. Use "SOL" as mint shorthand.
\`\`\`
Output: { success, tx, input_amount, output_amount }
\`\`\`

### etemaro candidates [--limit 5]
Returns top pool candidates fully enriched: pool metrics, token audit, holders, smart wallets, narrative, active bin, pool memory.
\`\`\`
Output: { candidates: [{name, pool, bin_step, fee_pct, volume, tvl, organic_score, active_bin, smart_wallets, token: {holders, audit, global_fees_sol, ...}, holders, narrative, pool_memory}] }
\`\`\`

### etemaro study --pool <addr> [--limit 4]
Studies top LPers on a pool. Returns behaviour patterns, hold times, win rates, strategies.
\`\`\`
Output: { pool, patterns: {top_lper_count, avg_hold_hours, avg_win_rate, ...}, lpers: [{owner, summary, positions}] }
\`\`\`

### etemaro token-info --query <mint_or_symbol>
Returns token audit, mcap, launchpad, price stats, fee data.
\`\`\`
Output: { results: [{mint, symbol, mcap, launchpad, audit, stats_1h, global_fees_sol, ...}] }
\`\`\`

### etemaro token-holders --mint <addr> [--limit 20]
Returns holder distribution, bot %, top holder concentration.
\`\`\`
Output: { mint, holders, top_10_real_holders_pct, bundlers_pct_in_top_100, global_fees_sol, ... }
\`\`\`

### etemaro token-narrative --mint <addr>
Returns AI-generated narrative about the token.
\`\`\`
Output: { mint, narrative }
\`\`\`

### etemaro pool-detail --pool <addr> [--timeframe 5m]
Returns detailed pool metrics for a specific pool.
\`\`\`
Output: { pool, name, bin_step, fee_pct, volume, tvl, volatility, ... }
\`\`\`

### etemaro search-pools --query <name_or_symbol> [--limit 10]
Searches pools by name or token symbol.
\`\`\`
Output: { pools: [{pool, name, bin_step, fee_pct, tvl, volume, ...}] }
\`\`\`

### etemaro active-bin --pool <addr>
Returns the current active bin for a pool.
\`\`\`
Output: { pool, binId, price }
\`\`\`

### etemaro wallet-positions --wallet <addr>
Returns DLMM positions for any wallet address.
\`\`\`
Output: { wallet, positions: [...], total_positions }
\`\`\`

> Repo clone (no global `etemaro`)? Prefix commands with `npm run cli --` (keep the `--`), e.g. `npm run cli -- wallet import --name <alias> --prompt`.

### etemaro wallet generate [--name <alias>] [--show-private-key]
Generates a new Solana keypair and stores it in the local keystore (~/.config/etemaro/.credentials/wallets/<alias>.json, mode 0600). Encrypted with AES-256-GCM when ETEMARO_KEYSTORE_PASSPHRASE is set; plaintext otherwise. The private key is only printed when --show-private-key is passed.
\`\`\`
Output: { success, publicKey, createdAt, label, savedTo }
\`\`\`

### etemaro wallet import --name <alias> [--private-key <key>] [--file <path>] [--prompt]
Imports an existing wallet. Prefer --prompt or --file: --private-key exposes the secret in shell history and process listings.
\`\`\`
Output: { success, publicKey, createdAt, label, savedTo }
\`\`\`

### etemaro wallet list
Lists saved wallets with alias, public key, encryption status, and path.
\`\`\`
Output: [{ alias, publicKey, encrypted, path }]
\`\`\`

### etemaro wallet export --name <alias>
Decrypts and prints the private key (interactive TTY confirmation required).
\`\`\`
Output: { alias, publicKey, privateKey, warning }
\`\`\`

### etemaro wallet remove --name <alias> [--yes]
Permanently deletes a saved wallet from the keystore. Requires --yes when stdout is not a TTY.
\`\`\`
Output: { success, removed, paths }
\`\`\`

### etemaro strategy validate <file...> [--json] [--strict]
Validates strategy JSON (a library or a single strategy object) against the canonical Strategy schema.
Reports unknown and legacy fields the runtime will ignore, and checks smartWalletListId wiring against the loaded config.

### etemaro config get
Returns the full runtime config.

### etemaro config set <key> <value>
Updates a config key. Parses value as JSON when possible.
\`\`\`
Valid keys: minTvl, maxTvl, minVolume, maxPositions, deployAmountSol, managementIntervalMin, screeningIntervalMin, managementModel, screeningModel, generalModel, autoSwapAfterClaim, autoSwapRetryAttempts, autoSwapRetryDelayMs, autoSwapInterSwapDelayMs, minClaimAmount, outOfRangeWaitMinutes
\`\`\`

### etemaro lessons [--limit 50]
Lists all lessons from lessons.json. Shows rule, tags, pinned status, outcome, role.
\`\`\`
Output: { total, lessons: [{id, rule, tags, outcome, pinned, role, created_at}] }
\`\`\`

### etemaro lessons add <text>
Adds a manual lesson with outcome=manual, role=null (applies to all roles).
\`\`\`
Output: { saved: true, rule, outcome, role }
\`\`\`

### etemaro pool-memory --pool <addr>
Returns deploy history for a specific pool from pool-memory.json.
\`\`\`
Output: { pool_address, known, name, total_deploys, win_rate, avg_pnl_pct, last_outcome, notes, history }
\`\`\`

### etemaro evolve
Runs evolveThresholds() over all closed position data and updates user-config.json.
\`\`\`
Output: { evolved, changes, rationale }
\`\`\`

### etemaro blacklist add --mint <addr> --reason <text>
Permanently blacklists a token mint so it is never deployed into.
\`\`\`
Output: { blacklisted, mint, reason }
\`\`\`

### etemaro blacklist list
Lists all blacklisted token mints with reasons and timestamps.
\`\`\`
Output: { count, blacklist: [{mint, symbol, reason, addedAt}] }
\`\`\`

### etemaro performance [--limit 200]
Shows all closed position performance history with summary stats.
\`\`\`
Output: { summary: { total_positions_closed, total_pnl_usd, avg_pnl_pct, win_rate_pct, total_lessons }, count, positions: [...] }
\`\`\`

### etemaro init [--dir <path>]
First-time setup (~1 minute). Creates runtime files and checks wallet + LLM keys.

### etemaro new-agent [--name <name>] [--desc <description>] [--id <agentId>]
Creates a new agent configuration under config/instances/<agentId>.json and initializes data/instances/<agentId>/.
In interactive mode, prompts for Name, optional Description, and Agent ID (auto-suggested from Name).

### etemaro start [--dry-run]
Starts the autonomous agent with cron jobs (management + screening).

### etemaro serve [--port <port>] [--open]
Starts the agent headlessly and serves the browser web UI on the IPC port (default 8765).
Open the printed http://127.0.0.1:<port>/ URL to view positions, logs, chat, and run any tool.

### etemaro attach [--agent <id>] [--port <port>]
Opens the interactive terminal dashboard (Ink TUI) that attaches to a running agent.

## Flags
--dry-run     Skip all on-chain transactions
--silent      Suppress Telegram notifications for this run
--port <port> IPC port for serve/attach (default 8765)
--open        Open the browser after 'etemaro serve' starts
--config <path>  Path to user-config.json (alias: -c). Overrides USER_CONFIG_PATH env var.
--data-dir <path>  Data directory (alias: -d). Overrides ETEMARO_DATA_DIR/DATA_DIR env vars.
`

// ─── Output Helpers ─────────────────────────────────────────────

function out(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`)
  process.exit(0)
}

function die(msg: string, extra: Record<string, unknown> = {}): never {
  process.stderr.write(`${JSON.stringify({ error: msg, ...extra })}\n`)
  process.exit(1)
}

// ─── CLI Class ──────────────────────────────────────────────────

export class Cli {
  private adapters: CliAdapters
  private etemaroDir: string

  constructor(adapters: CliAdapters) {
    this.adapters = adapters
    this.etemaroDir = typeof getEtemaroDir === 'function' ? getEtemaroDir() : defaultEtemaroHome()
  }

  // ─── Lifecycle ─────────────────────────────────────────────────

  async run(argv: string[] = process.argv.slice(2)): Promise<void> {
    // Write SKILL.md for agent discovery
    this.writeSkillMd()

    // Parse args
    const subcommand = argv.find((a) => !a.startsWith('-'))
    const sub2 = argv.filter((a) => !a.startsWith('-'))[1]

    if (!subcommand || subcommand === 'help' || argv.includes('--help')) {
      process.stdout.write(SKILL_MD)
      process.exit(0)
    }

    // One-shot commands must keep stdout machine-readable (JSON via out()). Core
    // log()/logStructured() write to stdout and would corrupt it, so mute them for
    // everything except the long-running daemon/TUI commands.
    if (!['start', 'serve', 'web', 'attach'].includes(subcommand)) {
      const { setStdoutMuted } = await import('@etemaro/core')
      setStdoutMuted(true)
    }

    // Parse flags
    const { values: flags } = parseArgs({
      args: argv,
      options: {
        pool: { type: 'string' },
        amount: { type: 'string' },
        position: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        strategy: { type: 'string' },
        query: { type: 'string' },
        mint: { type: 'string' },
        wallet: { type: 'string' },
        timeframe: { type: 'string' },
        reason: { type: 'string' },
        'bins-below': { type: 'string' },
        'bins-above': { type: 'string' },
        'amount-x': { type: 'string' },
        'amount-y': { type: 'string' },
        bps: { type: 'string' },
        'no-claim': { type: 'boolean' },
        'skip-swap': { type: 'boolean' },
        'dry-run': { type: 'boolean' },
        silent: { type: 'boolean' },
        json: { type: 'boolean' },
        strict: { type: 'boolean' },
        active: { type: 'boolean' },
        'env-optional': { type: 'boolean' },
        limit: { type: 'string' },
        dir: { type: 'string' },
        label: { type: 'string' },
        name: { type: 'string' },
        'private-key': { type: 'string' },
        file: { type: 'string' },
        prompt: { type: 'boolean' },
        'show-private-key': { type: 'boolean' },
        description: { type: 'string' },
        desc: { type: 'string' },
        id: { type: 'string' },
        'agent-id': { type: 'string' },
        agent: { type: 'string' },
        port: { type: 'string' },
        token: { type: 'string' },
        socket: { type: 'string' },
        force: { type: 'boolean' },
        yes: { type: 'boolean' },
        version: { type: 'boolean' },
        headless: { type: 'boolean' },
        open: { type: 'boolean' },
      },
      allowPositionals: true,
      strict: false,
    })

    applyCliRuntimeFlags(flags as Record<string, unknown>, process.env)

    switch (subcommand) {
      case 'new-agent':
      case 'create-agent':
        return this.handleNewAgent(flags)
      case 'agent':
        switch (sub2) {
          case 'new':
          case 'create':
            return this.handleNewAgent(flags)
          default:
            die(`Unknown agent subcommand: ${sub2}. Use: new, create`)
        }
        break
      case 'generate-wallet':
      case 'new-wallet':
        return this.handleGenerateWallet(flags)
      case 'wallet':
        switch (sub2) {
          case 'generate':
          case 'new':
            return this.handleGenerateWallet(flags)
          case 'import':
            return this.handleWalletImport(flags)
          case 'list':
            return this.handleWalletList()
          case 'export':
            return this.handleWalletExport(flags)
          case 'remove':
          case 'delete':
            return this.handleWalletRemove(flags)
          case 'swap-all':
            return this.handleSwapAllTokensToSol(flags)
          default:
            return this.handleBalance()
        }
      case 'balance':
        return this.handleBalance()
      case 'positions':
        return this.handlePositions()
      case 'pnl':
        return this.handlePnl(argv, flags)
      case 'candidates':
        return this.handleCandidates(flags)
      case 'token-info':
        return this.handleTokenInfo(argv, flags)
      case 'token-holders':
        return this.handleTokenHolders(argv, flags)
      case 'token-narrative':
        return this.handleTokenNarrative(argv, flags)
      case 'pool-detail':
        return this.handlePoolDetail(flags)
      case 'search-pools':
        return this.handleSearchPools(argv, flags)
      case 'active-bin':
        return this.handleActiveBin(flags)
      case 'wallet-positions':
        return this.handleWalletPositions(argv, flags)
      case 'deploy':
        return this.handleDeploy(argv, flags)
      case 'claim':
        return this.handleClaim(flags)
      case 'close':
        return this.handleClose(flags)
      case 'swap':
        return this.handleSwap(flags)
      case 'sweep':
      case 'swap-all':
        return this.handleSweep(flags)
      case 'liquidations':
        return this.handleLiquidations(flags)
      case 'screen':
        return this.handleScreen(flags)
      case 'manage':
        return this.handleManage(flags)
      case 'config':
        return this.handleConfig(argv, sub2, flags)
      case 'strategy':
        return this.handleStrategy(argv, sub2, flags)
      case 'study':
        return this.handleStudy(flags)
      case 'start':
        return this.handleStart(flags)
      case 'lessons':
        return this.handleLessons(argv, sub2, flags)
      case 'pool-memory':
        return this.handlePoolMemory(flags)
      case 'evolve':
        return this.handleEvolve()
      case 'blacklist':
        return this.handleBlacklist(argv, sub2, flags)
      case 'performance':
        return this.handlePerformance(flags)
      case 'init':
        return this.handleInit(flags)
      case 'attach':
        return this.handleAttach(flags)
      case 'serve':
      case 'web':
        return this.handleServe(flags)
      default:
        die(`Unknown command: ${subcommand}. Run 'etemaro help' for usage.`)
    }
  }

  // ─── SKILL.md ──────────────────────────────────────────────────

  private writeSkillMd(): void {
    fs.mkdirSync(this.etemaroDir, { recursive: true })
    fs.writeFileSync(path.join(this.etemaroDir, 'SKILL.md'), SKILL_MD)
  }

  // ─── Command Handlers ──────────────────────────────────────────

  private async handleInit(flags: Record<string, any>): Promise<void> {
    const targetDir =
      typeof flags.dir === 'string' && flags.dir.trim().length > 0 ? path.resolve(flags.dir) : this.etemaroDir
    const skeleton = writeRuntimeSkeleton(targetDir, {
      defaultUserConfigStr,
      sharedStrategyJson: fs.readFileSync(_strategyLibraryPath('strategy-library.shared.json'), 'utf8'),
    })
    this.writeSkillMd()

    const envFile = skeleton.env.path
    const fileEnv = fs.existsSync(envFile) ? parseEnvFile(fs.readFileSync(envFile, 'utf8')) : {}
    let status = assessSetup({ ...fileEnv, ...process.env })

    const interactive = process.stdin.isTTY === true && flags.yes !== true
    const updates = await maybePromptSecrets({
      interactive,
      status,
      ask: askTty,
    })
    if (Object.keys(updates).length > 0) {
      const next = upsertEnvVars(fs.readFileSync(envFile, 'utf8'), updates)
      fs.writeFileSync(envFile, next)
      for (const [key, value] of Object.entries(updates)) process.env[key] = value
      status = assessSetup({ ...parseEnvFile(next), ...process.env })
    }

    const text = formatInitMessage({
      directory: targetDir,
      firstRun: skeleton.env.created || skeleton.config.created,
      status,
    })
    process.stdout.write(`${text}\n`)
    if (typeof flags.dir === 'string' && flags.dir.trim()) {
      process.stdout.write(`\nCustom dir: export ETEMARO_HOME="${targetDir}" before etemaro start\n`)
    }
    process.exit(status.readyForDryRun ? 0 : 1)
  }

  private async handleNewAgent(flags: Record<string, any>): Promise<void> {
    const isInteractive = Boolean(process.stdin.isTTY && !process.env.CI)

    let name = (flags.name as string | undefined)?.trim()
    let description = ((flags.description || flags.desc) as string | undefined)?.trim()
    let agentId = ((flags.id || flags['agent-id']) as string | undefined)?.trim()

    // Determine config directory root (repo-first, else CLI etemaroDir)
    const repoConfigDir = _REPO_ROOT ? path.join(_REPO_ROOT, 'config') : path.join(this.etemaroDir, 'config')
    const instancesDir = path.join(repoConfigDir, 'instances')

    // Interactive prompt if missing fields in a TTY environment
    if (isInteractive && (!name || description === undefined || !agentId)) {
      const rl = readline.createInterface({ input: stdinStream, output: stdoutStream })
      try {
        if (!name) {
          const inputName = await rl.question('? Agent Name (e.g. Sol Scalper Alpha): ')
          name = inputName.trim()
        }
        if (description === undefined) {
          const inputDesc = await rl.question('? Description (optional): ')
          description = inputDesc.trim() || undefined
        }
        if (!agentId) {
          const baseSlug =
            (name || 'agent')
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '') || 'agent'

          let candidateId = baseSlug
          let counter = 1
          while (fs.existsSync(path.join(instancesDir, `${candidateId}.json`))) {
            candidateId = `${baseSlug}-${counter}`
            counter++
          }

          const inputId = (await rl.question(`? Agent ID [${candidateId}]: `)).trim()
          agentId = inputId || candidateId
        }
      } finally {
        rl.close()
      }
    }

    if (!name) {
      name = 'New Agent'
    }

    if (!agentId) {
      const baseSlug =
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'agent'

      let candidateId = baseSlug
      let counter = 1
      while (fs.existsSync(path.join(instancesDir, `${candidateId}.json`))) {
        candidateId = `${baseSlug}-${counter}`
        counter++
      }
      agentId = candidateId
    }

    // Validate agentId format: alphanumeric, hyphens, underscores
    if (!/^[a-zA-Z0-9_-]+$/.test(agentId)) {
      die(`Invalid agentId: "${agentId}". Must contain only alphanumeric characters, hyphens, and underscores.`)
    }

    const targetConfigFile = path.join(instancesDir, `${agentId}.json`)
    if (fs.existsSync(targetConfigFile) && !flags.force && !flags.yes) {
      die(`Agent configuration already exists at ${targetConfigFile}. Use --force to overwrite.`)
    }

    // Load template: prefer templates/user-config.example.json, fallback to instances/agent-default.json, then defaultUserConfigStr
    const templateCandidates = [
      path.join(repoConfigDir, 'templates', 'user-config.example.json'),
      path.join(repoConfigDir, 'instances', 'agent-default.json'),
      path.join(repoConfigDir, 'user-config.json'),
    ]

    let templateContent: Record<string, any> | null = null
    for (const candidate of templateCandidates) {
      if (fs.existsSync(candidate)) {
        try {
          templateContent = JSON.parse(fs.readFileSync(candidate, 'utf8'))
          break
        } catch {
          // ignore
        }
      }
    }

    const finalTemplateContent: Record<string, any> =
      templateContent ?? (defaultUserConfigStr ? JSON.parse(defaultUserConfigStr) : {})

    // Populate metadata
    finalTemplateContent.name = name
    if (description) {
      finalTemplateContent.description = description
    } else {
      delete finalTemplateContent.description
    }
    finalTemplateContent.agentId = agentId

    // Target data directory
    const baseDataDir = typeof _getDataDir === 'function' ? _getDataDir() : path.join(this.etemaroDir, 'data')
    const targetDataDir = path.join(baseDataDir, 'instances', agentId)

    // Create directories and write file
    fs.mkdirSync(instancesDir, { recursive: true })
    fs.writeFileSync(targetConfigFile, `${JSON.stringify(finalTemplateContent, null, 2)}\n`, 'utf8')

    fs.mkdirSync(path.join(targetDataDir, 'logs'), { recursive: true })

    out({
      success: true,
      agentId,
      name,
      description: description || null,
      configFile: targetConfigFile,
      dataDir: targetDataDir,
      message: `Created agent "${name}" (${agentId})`,
    })
  }

  private handleGenerateWallet(flags: Record<string, any>): void {
    const alias = flags.name || flags.label || 'default'
    const result = wallet.generateNewWallet({ label: alias })
    const payload: Record<string, unknown> = {
      success: true,
      publicKey: result.publicKey,
      createdAt: result.createdAt,
      label: result.label,
      savedTo: result.savedTo ?? path.join(this.etemaroDir, '.credentials', 'wallets', `${alias}.json`),
      message: `New Solana wallet generated and saved as "${alias}"`,
    }
    if (flags['show-private-key'] === true) {
      payload.privateKey = result.privateKey
      payload.warning = 'Private key printed to stdout — it may persist in terminal scrollback or CI logs.'
    } else {
      payload.note =
        'Private key not printed. Retrieve it with "etemaro wallet export --name <alias>" (interactive TTY only).'
    }
    out(payload)
  }

  private async handleWalletImport(flags: Record<string, any>): Promise<void> {
    const alias = flags.name || flags.label
    if (!alias) die('Usage: etemaro wallet import --name <alias> [--file <path> | --prompt]')

    let privateKey: string | undefined = flags['private-key']
    if (!privateKey && flags.file) {
      // File import handled by wallet.importWallet
    } else if (!privateKey && flags.prompt) {
      privateKey = await promptSecret('Enter Base58 private key: ')
    }

    const result = wallet.importWallet({
      label: alias,
      privateKey,
      filePath: flags.file,
    })

    const payload: Record<string, unknown> = {
      success: true,
      publicKey: result.publicKey,
      createdAt: result.createdAt,
      label: result.label,
      savedTo: result.savedTo,
      message: `Wallet imported as "${alias}"`,
    }
    if (typeof flags['private-key'] === 'string' && flags['private-key'].length > 0) {
      payload.warning =
        'The private key was passed on the command line and may persist in shell history / process listings. Prefer --prompt or --file.'
    }
    out(payload)
  }

  private async handleWalletList(): Promise<void> {
    const walletsMap = new Map<string, { alias: string; publicKey?: string; encrypted?: boolean; path: string }>()

    const searchDirs = [
      path.join(getEtemaroDir(), '.credentials', 'wallets'),
      path.join(_REPO_ROOT, 'config', '.credentials', 'wallets'),
    ]

    for (const dir of searchDirs) {
      if (fs.existsSync(dir)) {
        try {
          const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
          for (const f of files) {
            const alias = path.basename(f, '.json')
            const fullPath = path.join(dir, f)
            try {
              const raw = JSON.parse(fs.readFileSync(fullPath, 'utf8'))
              let pubKey: string | undefined
              let encrypted = false
              if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
                encrypted = raw.encrypted === true
                if (typeof raw.publicKey === 'string' && raw.publicKey.trim().length > 0) {
                  pubKey = raw.publicKey.trim()
                } else if (!encrypted && typeof raw.privateKey === 'string' && raw.privateKey.trim().length > 0) {
                  pubKey = Keypair.fromSecretKey(bs58.decode(raw.privateKey.trim())).publicKey.toBase58()
                }
              }
              if (!walletsMap.has(alias)) {
                walletsMap.set(alias, { alias, publicKey: pubKey, encrypted, path: fullPath })
              }
            } catch {
              if (!walletsMap.has(alias)) {
                walletsMap.set(alias, { alias, path: fullPath })
              }
            }
          }
        } catch {
          /* ignore */
        }
      }
    }

    out(Array.from(walletsMap.values()))
  }

  private async handleWalletRemove(flags: Record<string, any>): Promise<void> {
    const alias = flags.name || flags.label
    if (!alias) die('Usage: etemaro wallet remove --name <alias> [--yes]')

    const credDirs = [
      path.join(getEtemaroDir(), '.credentials', 'wallets'),
      path.join(_REPO_ROOT, 'config', '.credentials', 'wallets'),
    ]
    const targets = credDirs.map((dir) => path.join(dir, `${alias}.json`)).filter((f) => fs.existsSync(f))
    if (targets.length === 0) die(`Wallet alias not found: ${alias}`)

    // Deleting a wallet is irreversible. Require --yes, or an explicit YES on a TTY.
    if (flags.yes !== true) {
      if (!process.stdout.isTTY) {
        die('Refusing to delete a wallet without confirmation. Re-run with --yes for non-interactive use.')
      }
      const rl = readline.createInterface({ input: stdinStream, output: stdoutStream })
      try {
        const answer = await rl.question(
          `Delete wallet "${alias}" from ${targets.length} location(s)? This cannot be undone. Type YES to confirm: `,
        )
        if (answer.trim() !== 'YES') {
          console.error('Cancelled.')
          process.exit(1)
        }
      } finally {
        rl.close()
      }
    }

    for (const target of targets) {
      try {
        fs.unlinkSync(target)
      } catch (err: any) {
        die(`Failed to delete ${target}: ${err?.message || err}`)
      }
    }

    out({ success: true, removed: alias, paths: targets })
  }

  private async handleWalletExport(flags: Record<string, any>): Promise<void> {
    const alias = flags.name || flags.label
    if (!alias) die('Usage: etemaro wallet export --name <alias>')

    // Security: only allow export from an interactive TTY
    if (!process.stdout.isTTY) {
      die('wallet export requires an interactive terminal (stdout must be a TTY)')
    }

    const rl = readline.createInterface({ input: stdinStream, output: stdoutStream })
    let confirmed = false
    try {
      const answer = await rl.question(
        `WARNING: This will print the private key for "${alias}" to your terminal.\nType YES to confirm: `,
      )
      confirmed = answer.trim() === 'YES'
    } finally {
      rl.close()
    }
    if (!confirmed) {
      console.error('Export cancelled.')
      return
    }

    // Check secure keystore (.credentials/wallets/<alias>.json) — decrypts when needed.
    const { readKeystoreFile } = (await import('@etemaro/core')) as any
    let foundPub: string | undefined
    let foundPriv: string | undefined
    let readError: string | undefined

    const credDirs = [
      path.join(getEtemaroDir(), '.credentials', 'wallets'),
      path.join(_REPO_ROOT, 'config', '.credentials', 'wallets'),
    ]
    for (const dir of credDirs) {
      const credFile = path.join(dir, `${alias}.json`)
      if (!fs.existsSync(credFile)) continue
      try {
        const keystore = readKeystoreFile(credFile)
        foundPriv = keystore.privateKey
        foundPub = keystore.publicKey || Keypair.fromSecretKey(bs58.decode(keystore.privateKey)).publicKey.toBase58()
        break
      } catch (err: any) {
        readError = err?.message || String(err)
      }
    }

    if (!foundPriv) {
      die(readError ? `Failed to read wallet "${alias}": ${readError}` : `Wallet alias not found: ${alias}`)
    }

    out({
      alias,
      publicKey: foundPub,
      privateKey: foundPriv,
      warning: 'Private key exposed - handle with care!',
    })
  }

  private async handleBalance(): Promise<void> {
    out(await this.adapters.wallet.getWalletBalances())
  }

  private async handlePositions(): Promise<void> {
    out(await this.adapters.meteora.getMyPositions({ force: true }))
  }

  private async handlePnl(argv: string[], flags: Record<string, any>): Promise<void> {
    const posAddr = argv.find((a, i) => !a.startsWith('-') && i > 0 && argv[i - 1] !== '--position' && a !== 'pnl')
    const positionAddress = flags.position || posAddr
    if (!positionAddress) die('Usage: etemaro pnl <position_address>')

    let poolAddress: string
    const tracked = getTrackedPosition(positionAddress)
    if (tracked?.pool) {
      poolAddress = tracked.pool
    } else {
      const pos = await this.adapters.meteora.getMyPositions({ force: true })
      const found = pos.positions?.find((p: any) => p.position === positionAddress)
      if (!found) die('Position not found', { position: positionAddress })
      poolAddress = found.pool
    }

    const pnl = await this.adapters.meteora.getPositionPnl({
      pool_address: poolAddress,
      position_address: positionAddress,
    })
    if (tracked?.strategy) pnl.strategy = tracked.strategy
    if (tracked?.instruction) pnl.instruction = tracked.instruction
    out(pnl)
  }

  private async handleCandidates(flags: Record<string, any>): Promise<void> {
    const limit = parseInt(flags.limit || '5', 10)
    const raw = await this.adapters.screening.getTopCandidates({ limit })
    const pools = raw.candidates || raw.pools || []
    // Smart-wallet enrichment is optional in market mode; only the wallet-list tools require it.
    const smartWalletListId = this.adapters.domain.getActiveStrategy()?.smartWalletListId

    const enriched = []
    for (const pool of pools) {
      const mint = pool.base?.mint
      const [activeBin, smartWallets, tokenInfo, holders, narrative] = await Promise.allSettled([
        this.adapters.meteora.getActiveBin({ pool_address: pool.pool }),
        smartWalletListId
          ? this.adapters.domain.checkSmartWalletsOnPool({ listId: smartWalletListId, pool_address: pool.pool })
          : Promise.resolve(null),
        mint ? this.adapters.domain.getTokenInfo({ query: mint }) : Promise.resolve(null),
        mint ? this.adapters.domain.getTokenHolders({ mint, limit: 20, smartWalletListId }) : Promise.resolve(null),
        mint ? this.adapters.domain.getTokenNarrative({ mint }) : Promise.resolve(null),
      ])
      const ti = tokenInfo.status === 'fulfilled' ? tokenInfo.value?.results?.[0] : null
      enriched.push({
        pool: pool.pool,
        name: pool.name,
        bin_step: pool.bin_step,
        fee_pct: pool.fee_pct,
        fee_active_tvl_ratio: pool.fee_active_tvl_ratio,
        volume: pool.volume_window,
        tvl: pool.tvl ?? pool.active_tvl,
        volatility: pool.volatility,
        mcap: pool.mcap,
        organic_score: pool.organic_score,
        active_pct: pool.active_pct,
        price_change_pct: pool.price_change_pct,
        active_bin: activeBin.status === 'fulfilled' ? activeBin.value?.binId : null,
        smart_wallets:
          smartWallets.status === 'fulfilled' ? (smartWallets.value?.in_pool || []).map((w: any) => w.name) : [],
        token: {
          mint,
          symbol: pool.base?.symbol,
          holders: pool.holders,
          mcap: ti?.mcap,
          launchpad: ti?.launchpad,
          global_fees_sol: ti?.global_fees_sol,
          price_change_1h: ti?.stats_1h?.price_change,
          net_buyers_1h: ti?.stats_1h?.net_buyers,
          audit: {
            top10_pct: ti?.audit?.top_holders_pct,
            bots_pct: ti?.audit?.bot_holders_pct,
          },
        },
        holders: holders.status === 'fulfilled' ? holders.value : null,
        narrative: narrative.status === 'fulfilled' ? narrative.value?.narrative : null,
        pool_memory: this.adapters.domain.recallForPool(pool.pool) || null,
      })
      await new Promise((r) => setTimeout(r, 150))
    }

    out({ candidates: enriched, total_screened: raw.total_screened })
  }

  private async handleTokenInfo(argv: string[], flags: Record<string, any>): Promise<void> {
    const query = flags.query || flags.mint || argv.find((a, i) => !a.startsWith('-') && i > 0 && a !== 'token-info')
    if (!query) die('Usage: etemaro token-info --query <mint_or_symbol>')
    out(await this.adapters.domain.getTokenInfo({ query }))
  }

  private async handleTokenHolders(argv: string[], flags: Record<string, any>): Promise<void> {
    const mint = flags.mint || argv.find((a, i) => !a.startsWith('-') && i > 0 && a !== 'token-holders')
    if (!mint) die('Usage: etemaro token-holders --mint <addr>')
    const limit = flags.limit ? parseInt(flags.limit, 10) : 20
    out(await this.adapters.domain.getTokenHolders({ mint, limit }))
  }

  private async handleTokenNarrative(argv: string[], flags: Record<string, any>): Promise<void> {
    const mint = flags.mint || argv.find((a, i) => !a.startsWith('-') && i > 0 && a !== 'token-narrative')
    if (!mint) die('Usage: etemaro token-narrative --mint <addr>')
    out(await this.adapters.domain.getTokenNarrative({ mint }))
  }

  private async handlePoolDetail(flags: Record<string, any>): Promise<void> {
    if (!flags.pool) die('Usage: etemaro pool-detail --pool <addr> [--timeframe 5m]')
    out(
      await this.adapters.screening.getPoolDetail({
        pool_address: flags.pool,
        timeframe: flags.timeframe || '5m',
      }),
    )
  }

  private async handleSearchPools(argv: string[], flags: Record<string, any>): Promise<void> {
    const query = flags.query || argv.find((a, i) => !a.startsWith('-') && i > 0 && a !== 'search-pools')
    if (!query) die('Usage: etemaro search-pools --query <name_or_symbol>')
    const limit = flags.limit ? parseInt(flags.limit, 10) : 10
    out(await this.adapters.meteora.searchPools({ query, limit }))
  }

  private async handleActiveBin(flags: Record<string, any>): Promise<void> {
    if (!flags.pool) die('Usage: etemaro active-bin --pool <addr>')
    out(await this.adapters.meteora.getActiveBin({ pool_address: flags.pool }))
  }

  private async handleWalletPositions(argv: string[], flags: Record<string, any>): Promise<void> {
    const wallet = flags.wallet || argv.find((a, i) => !a.startsWith('-') && i > 0 && a !== 'wallet-positions')
    if (!wallet) die('Usage: etemaro wallet-positions --wallet <addr>')
    out(await this.adapters.meteora.getWalletPositions({ wallet_address: wallet }))
  }

  private async handleDeploy(argv: string[], flags: Record<string, any>): Promise<void> {
    if (!flags.pool) die('Usage: etemaro deploy --pool <addr> --amount <sol>')
    const amountX = flags['amount-x'] ? parseFloat(flags['amount-x']) : undefined
    if (!flags.amount && !amountX) die('--amount or --amount-x is required')

    out(
      await this.adapters.toolExecutor.executeTool('deploy_position', {
        pool_address: flags.pool,
        amount_y: flags.amount ? parseFloat(flags.amount) : undefined,
        amount_x: amountX,
        strategy: flags.strategy,
        single_sided_x: argv.includes('--single-sided-x'),
        bins_below: flags['bins-below'] ? parseInt(flags['bins-below'], 10) : undefined,
        bins_above: flags['bins-above'] ? parseInt(flags['bins-above'], 10) : undefined,
        allow_duplicate_pool: argv.includes('--allow-duplicate-pool'),
      }),
    )
  }

  private async handleClaim(flags: Record<string, any>): Promise<void> {
    if (!flags.position) die('Usage: etemaro claim --position <addr>')
    out(await this.adapters.toolExecutor.executeTool('claim_fees', { position_address: flags.position }))
  }

  private async handleClose(flags: Record<string, any>): Promise<void> {
    if (flags.all) {
      out(
        await this.adapters.toolExecutor.executeTool('close_all_positions', {
          skipSwap: flags['skip-swap'] ?? false,
        }),
      )
      return
    }
    if (!flags.position) die('Usage: etemaro close --position <addr> or etemaro close --all')
    out(
      await this.adapters.toolExecutor.executeTool('close_position', {
        position_address: flags.position,
        skip_swap: flags['skip-swap'] ?? false,
      }),
    )
  }

  private async handleSwapAllTokensToSol(flags: Record<string, any>): Promise<void> {
    const skipMints = typeof flags.skip === 'string' ? flags.skip.split(',') : []
    out(
      await this.adapters.toolExecutor.executeTool('swap_all_tokens_to_sol', {
        skipMints,
      }),
    )
  }

  private async handleSweep(flags: Record<string, any>): Promise<void> {
    const skipMints = typeof flags.skip === 'string' ? flags.skip.split(',') : []
    out(
      await this.adapters.toolExecutor.executeTool('sweep_unsold_tokens', {
        skipMints,
      }),
    )
  }

  private async handleLiquidations(flags: Record<string, any>): Promise<void> {
    out(
      await this.adapters.toolExecutor.executeTool('get_pending_liquidations', {
        status: flags.status,
      }),
    )
  }

  private async handleSwap(flags: Record<string, any>): Promise<void> {
    if (!flags.from || !flags.to || !flags.amount) die('Usage: etemaro swap --from <mint> --to <mint> --amount <n>')
    out(
      await this.adapters.toolExecutor.executeTool('swap_token', {
        input_mint: flags.from,
        output_mint: flags.to,
        amount: parseFloat(flags.amount),
      }),
    )
  }

  private async handleScreen(flags: Record<string, any>): Promise<void> {
    if (!this.adapters.daemon) die('Screen command requires daemon adapter')
    this.adapters.domain.validateActiveStrategy()
    const report = await this.adapters.daemon.runScreeningCycle({ silent: flags.silent })
    out({ done: true, report: report || 'No action taken' })
  }

  private async handleManage(flags: Record<string, any>): Promise<void> {
    if (!this.adapters.daemon) die('Manage command requires daemon adapter')
    this.adapters.domain.validateActiveStrategy()
    const report = await this.adapters.daemon.runManagementCycle({ silent: flags.silent })
    out({ done: true, report: report || 'No action taken' })
  }

  private async handleStrategy(argv: string[], sub2: string | undefined, flags: Record<string, any>): Promise<void> {
    if (sub2 !== 'validate') die('Usage: etemaro strategy validate <file...> [--json] [--strict] [--active]')
    const files = argv.filter((a) => !a.startsWith('-')).slice(2)
    if (files.length === 0) die('Usage: etemaro strategy validate <file...> [--json] [--strict] [--active]')

    const smartWalletsPath = _strategyLibraryPath('smart-wallets.json')
    let knownSmartWalletListIds: string[] | null = null
    if (fs.existsSync(smartWalletsPath)) {
      try {
        const sw = JSON.parse(fs.readFileSync(smartWalletsPath, 'utf8')) as { lists?: Record<string, unknown> }
        knownSmartWalletListIds = Object.keys(sw.lists ?? {})
      } catch {
        knownSmartWalletListIds = null
      }
    }

    const active = this.readActiveConfigSnapshot()
    const opts: Record<string, unknown> = {
      strict: flags.strict === true,
      activeStrategyId: active.activeStrategyId ?? null,
      requireSmartWalletListId: flags.active === true && active.entrySource === 'smart_wallets',
      warnMissingSmartWalletListIdForBonus:
        flags.active === true && active.entrySource !== 'smart_wallets' && (active.smartWalletScoreBonus ?? 0) > 0,
      knownSmartWalletListIds,
    }
    const reports = files.map((f) => this.adapters.domain.validateStrategyFile(f, opts))
    this.renderValidationReports(reports, flags.json === true)
    process.exit(reports.every((r) => r.ok) ? 0 : 1)
  }

  /** Best-effort raw read of the active config; works even when the config is invalid. */
  private readActiveConfigSnapshot(): {
    activeStrategyId?: string | null
    entrySource?: string
    smartWalletScoreBonus?: number
  } {
    try {
      const configPath = _USER_CONFIG_PATH
      if (!configPath || !fs.existsSync(configPath)) return {}
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
        strategy?: { activeStrategyId?: string | null }
        screening?: { entrySource?: string }
        opportunity?: { smartWalletScoreBonus?: number }
      }
      return {
        activeStrategyId: raw.strategy?.activeStrategyId ?? null,
        entrySource: raw.screening?.entrySource,
        smartWalletScoreBonus: raw.opportunity?.smartWalletScoreBonus,
      }
    } catch {
      return {}
    }
  }

  /** Render one or more validation reports in the shared comprehensive format. */
  private renderValidationReports(reports: any[], json: boolean): void {
    const ok = reports.every((r) => r.ok)
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok, reports }, null, 2)}\n`)
      return
    }
    for (const r of reports) {
      process.stdout.write(`File: ${r.file}\n`)
      for (const e of r.entries) {
        process.stdout.write(`  Validation: ${e.id}\n`)
        process.stdout.write(`  Status:     ${e.status}\n`)
        const section = (title: string, lines: string[]) => {
          if (!lines?.length) return
          process.stdout.write(`  ${title}:\n`)
          for (const line of lines) process.stdout.write(`    - ${line}\n`)
        }
        section('Errors', e.errors)
        section('Warnings', e.warnings)
        section('Notes', e.infos)
        if (e.unknownFields?.length) {
          process.stdout.write(`  Unknown (unused) fields: ${e.unknownFields.join(', ')}\n`)
        }
        const usageKeys = Object.keys(e.usage ?? {})
        if (usageKeys.length) {
          process.stdout.write('  Field usage:\n')
          for (const k of usageKeys) process.stdout.write(`    ${k.padEnd(20)} ${e.usage[k]}\n`)
        }
        process.stdout.write('\n')
      }
    }
    const valid = reports.reduce((n, r) => n + r.totals.valid, 0)
    const invalid = reports.reduce((n, r) => n + r.totals.invalid, 0)
    process.stdout.write(`Totals: ${valid} valid, ${invalid} invalid\n`)
  }

  private async handleConfig(argv: string[], sub2: string | undefined, flags: Record<string, any>): Promise<void> {
    if (sub2 === 'validate') {
      const explicit = argv.filter((a) => !a.startsWith('-')).slice(2)[0]
      const file = explicit ? path.resolve(explicit) : _USER_CONFIG_PATH
      if (!file || !fs.existsSync(file)) {
        const note = `No config file to validate at ${file || '(unset)'}`
        if (flags.json === true) process.stdout.write(`${JSON.stringify({ ok: true, reports: [], note }, null, 2)}\n`)
        else process.stdout.write(`${note}\n`)
        process.exit(0)
      }
      const report = this.adapters.domain.validateConfigFile(file, { envOptional: flags['env-optional'] === true })
      this.renderValidationReports([report], flags.json === true)
      process.exit(report.ok ? 0 : 1)
    }
    if (sub2 === 'get' || !sub2) {
      out(config)
    } else if (sub2 === 'set') {
      const key = argv.filter((a) => !a.startsWith('-'))[2]
      const rawVal = argv.filter((a) => !a.startsWith('-'))[3]
      if (!key || rawVal === undefined) die('Usage: etemaro config set <key> <value>')
      let value: unknown = rawVal
      try {
        value = JSON.parse(rawVal)
      } catch {
        /* keep as string */
      }
      out(
        await this.adapters.toolExecutor.executeTool('update_config', {
          changes: { [key]: value },
          reason: 'CLI config set',
        }),
      )
    } else {
      die(`Unknown config subcommand: ${sub2}. Use: get, set`)
    }
  }

  private async handleStudy(flags: Record<string, any>): Promise<void> {
    if (!flags.pool) die('Usage: etemaro study --pool <addr> [--limit 4]')
    const limit = flags.limit ? parseInt(flags.limit, 10) : 4
    out(await this.adapters.domain.studyTopLPers({ pool_address: flags.pool, limit }))
  }

  private async handleAttach(flags: Record<string, any>): Promise<void> {
    const agentId = flags.agent ? String(flags.agent) : process.env.ETEMARO_AGENT_ID || 'agent-default'
    let foundConfig: any = {}

    const candidates = [
      path.join(process.cwd(), 'config', 'instances', `${agentId}.json`),
      path.join(process.cwd(), 'data', 'instances', agentId, 'user-config.json'),
      path.join(process.cwd(), 'config', 'user-config.json'),
      path.join(process.cwd(), 'user-config.json'),
    ]

    for (const c of candidates) {
      if (fs.existsSync(c)) {
        try {
          foundConfig = JSON.parse(fs.readFileSync(c, 'utf8'))
          break
        } catch {
          /* ignore */
        }
      }
    }

    const conn = foundConfig?.connection || {}
    const port = flags.port ? Number(flags.port) : conn.ipcPort ? Number(conn.ipcPort) : 8765
    const token = flags.token ? String(flags.token) : conn.ipcToken || process.env.ETEMARO_IPC_TOKEN
    const socketPath = flags.socket ? String(flags.socket) : conn.ipcSocketPath

    const { render } = await import('ink')
    const React = await import('react')
    const { App } = await import('./ui/App.js')

    const appInstance = render(
      React.createElement(App, {
        port,
        token,
        socketPath,
        agentId,
      }),
    )

    await appInstance.waitUntilExit()
  }

  private async handleStart(flags: Record<string, any> = {}): Promise<void> {
    if (!this.adapters.daemon?.start) die('Start command requires daemon adapter')

    // Interactive first-run onboarding if no wallet configured
    if (!config.connection?.wallet) {
      const readline = await import('node:readline/promises')
      const rl = readline.createInterface({ input: stdinStream, output: stdoutStream })
      try {
        console.log('No Solana wallet configured for this instance.')
        const answer = await rl.question(
          'What would you like to do?\n  1. Generate a new wallet\n  2. Import existing private key (Base58)\n  3. Import from file\n  4. Select existing wallet alias\nChoice (1-4): ',
        )
        switch (answer) {
          case '1': {
            const label = (await rl.question('Enter wallet alias: ')) || 'default'
            const result = this.adapters.wallet.generateNewWallet({ label })
            console.log(`Generated wallet ${result.publicKey} as "${label}"`)
            // Update config
            const configObj = JSON.parse(fs.readFileSync(_USER_CONFIG_PATH, 'utf8'))
            if (!configObj.connection) configObj.connection = {}
            configObj.connection.wallet = label
            fs.writeFileSync(_USER_CONFIG_PATH, JSON.stringify(configObj, null, 2))
            break
          }
          case '2': {
            const label = (await rl.question('Enter wallet alias: ')) || 'default'
            // Close the outer readline interface before promptSecret so it stops listening
            // and does not compete with promptSecret on stdin, which would echo keystrokes to terminal.
            rl.close()
            const key = await promptSecret('Enter Base58 private key: ')
            const result = this.adapters.wallet.importWallet({ label, privateKey: key })
            console.log(`Imported wallet ${result.publicKey} as "${label}"`)
            const configObj = JSON.parse(fs.readFileSync(_USER_CONFIG_PATH, 'utf8'))
            if (!configObj.connection) configObj.connection = {}
            configObj.connection.wallet = label
            fs.writeFileSync(_USER_CONFIG_PATH, JSON.stringify(configObj, null, 2))
            break
          }
          case '3': {
            const label = (await rl.question('Enter wallet alias: ')) || 'default'
            const filePath = await rl.question('Enter path to keypair file: ')
            const result = this.adapters.wallet.importWallet({ label, filePath })
            console.log(`Imported wallet ${result.publicKey} as "${label}"`)
            const configObj = JSON.parse(fs.readFileSync(_USER_CONFIG_PATH, 'utf8'))
            if (!configObj.connection) configObj.connection = {}
            configObj.connection.wallet = label
            fs.writeFileSync(_USER_CONFIG_PATH, JSON.stringify(configObj, null, 2))
            break
          }
          case '4': {
            const credDirs = [
              path.join(getEtemaroDir(), '.credentials', 'wallets'),
              path.join(_REPO_ROOT, 'config', '.credentials', 'wallets'),
            ]
            const availableWallets: Array<{ label: string; publicKey?: string }> = []
            const seen = new Set<string>()
            for (const dir of credDirs) {
              if (fs.existsSync(dir)) {
                try {
                  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
                  for (const f of files) {
                    const label = path.basename(f, '.json')
                    if (seen.has(label)) continue
                    seen.add(label)
                    let pubKey: string | undefined
                    try {
                      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
                      if (typeof raw === 'object' && raw !== null && typeof raw.publicKey === 'string') {
                        pubKey = raw.publicKey
                      }
                    } catch {
                      /* ignore */
                    }
                    availableWallets.push({ label, publicKey: pubKey })
                  }
                } catch {
                  /* ignore */
                }
              }
            }
            if (availableWallets.length) {
              console.log('Available wallets:')
              availableWallets.forEach(
                (w, i) => void console.log(`  ${i + 1}. ${w.label}${w.publicKey ? ` (${w.publicKey})` : ''}`),
              )
              const choice = await rl.question('Enter number: ')
              const idx = parseInt(choice, 10) - 1
              if (idx >= 0 && idx < availableWallets.length) {
                const selected = availableWallets[idx]!
                const configObj = JSON.parse(fs.readFileSync(_USER_CONFIG_PATH, 'utf8'))
                if (!configObj.connection) configObj.connection = {}
                configObj.connection.wallet = selected.label
                fs.writeFileSync(_USER_CONFIG_PATH, JSON.stringify(configObj, null, 2))
                console.log(`Selected wallet "${selected.label}"`)
              } else {
                console.log('Invalid selection')
              }
            } else {
              console.log('No wallets found. Generate one first.')
            }
            break
          }
          default:
            console.log('Invalid choice')
        }
      } catch (err) {
        console.error('Onboarding failed:', err)
      } finally {
        rl.close()
      }
    }

    const isInteractiveTty = process.stdout.isTTY === true && flags.headless !== true && !process.env.PM2_HOME

    if (isInteractiveTty) {
      const { setStdoutMuted } = await import('@etemaro/core')
      setStdoutMuted(true)
      await this.adapters.daemon.start({ tty: false })
      await this.handleAttach(flags)
      if (this.adapters.daemon.stop) {
        await this.adapters.daemon.stop()
      }
    } else {
      process.stderr.write('[etemaro] Starting autonomous agent (headless)...\n')
      await this.adapters.daemon.start({ tty: false })
    }
  }

  /**
   * Start the agent headlessly and serve the browser web UI on the IPC port.
   * Unlike `attach`, this does not take over the terminal with the Ink TUI.
   */
  private async handleServe(flags: Record<string, any> = {}): Promise<void> {
    if (!this.adapters.daemon?.start) die('Serve command requires daemon adapter')

    const port = flags.port ? Number(flags.port) : (config.connection?.ipcPort ?? 8765)
    if (Number.isFinite(port) && port > 0) {
      config.connection.ipcPort = port
    }
    const host = config.connection?.ipcHost ?? '127.0.0.1'
    const browserHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
    const boundPort = config.connection?.ipcPort ?? 8765
    const url = `http://${browserHost}:${boundPort}/`

    if (!config.connection?.wallet) {
      process.stderr.write(
        '[etemaro] No Solana wallet configured — the web UI will show read-only state. Run `etemaro init`.\n',
      )
    }
    process.stderr.write(`[etemaro] Starting agent + web UI at ${url}\n`)

    await this.adapters.daemon.start({ tty: false })

    process.stderr.write(`[etemaro] Web UI ready: ${url}\n`)
    process.stderr.write('[etemaro] Press Ctrl+C to stop.\n')

    if (flags.open) this.openBrowser(url)
  }

  /** Best-effort open of the default browser (darwin/linux/win32). */
  private openBrowser(url: string): void {
    const isWin = process.platform === 'win32'
    const command = process.platform === 'darwin' ? 'open' : isWin ? 'cmd' : 'xdg-open'
    const args = isWin ? ['/c', 'start', '', url] : [url]
    try {
      const child = spawn(command, args, { detached: true, stdio: 'ignore' })
      child.unref()
    } catch (e: any) {
      process.stderr.write(`[etemaro] Could not open browser automatically: ${e?.message || e}\n`)
    }
  }

  private async handleLessons(argv: string[], sub2: string | undefined, flags: Record<string, any>): Promise<void> {
    if (sub2 === 'add') {
      const text = argv
        .filter((a) => !a.startsWith('-'))
        .slice(2)
        .join(' ')
      if (!text) die('Usage: etemaro lessons add <text>')
      this.adapters.domain.addLesson(text, [], { pinned: false, role: null })
      out({ saved: true, rule: text, outcome: 'manual', role: null })
    } else {
      const limit = flags.limit ? parseInt(flags.limit, 10) : 50
      out(this.adapters.domain.listLessons({ limit }))
    }
  }

  private handlePoolMemory(flags: Record<string, any>): void {
    if (!flags.pool) die('Usage: etemaro pool-memory --pool <addr>')
    out(this.adapters.domain.getPoolMemory({ pool_address: flags.pool }))
  }

  private handleEvolve(): void {
    const lessonsFile = dataPath(LESSONS_FILENAME)
    let perfData: any[] = []
    if (fs.existsSync(lessonsFile)) {
      try {
        perfData = JSON.parse(fs.readFileSync(lessonsFile, 'utf8')).performance || []
      } catch {
        /* no data */
      }
    }
    const result = this.adapters.domain.evolveThresholds(perfData, config)
    if (!result) {
      out({ evolved: false, reason: `Need at least 5 closed positions (have ${perfData.length})` })
    } else {
      out({ evolved: Object.keys(result.changes).length > 0, changes: result.changes, rationale: result.rationale })
    }
  }

  private handleBlacklist(_argv: string[], sub2: string | undefined, flags: Record<string, any>): void {
    if (sub2 === 'add') {
      if (!flags.mint) die('Usage: etemaro blacklist add --mint <addr> --reason <text>')
      if (!flags.reason) die('--reason is required')
      out(this.adapters.domain.addToBlacklist({ mint: flags.mint, reason: flags.reason }))
    } else if (sub2 === 'list' || !sub2) {
      out(this.adapters.domain.listBlacklist())
    } else {
      die(`Unknown blacklist subcommand: ${sub2}. Use: add, list`)
    }
  }

  private handlePerformance(flags: Record<string, any>): void {
    const limit = flags.limit ? parseInt(flags.limit, 10) : 200
    const history = this.adapters.domain.getPerformanceHistory({ hours: 999999, limit })
    const summary = this.adapters.domain.getPerformanceSummary()
    out({ summary, ...history })
  }
}

function isCliTarget(filePath: string | undefined): boolean {
  if (!filePath) return false
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return false
  const lower = filePath.toLowerCase()
  return (
    lower.endsWith('cli.ts') ||
    lower.endsWith('cli.js') ||
    lower.endsWith('cli.cjs') ||
    lower.endsWith('/etemaro') ||
    lower.endsWith('\\etemaro') ||
    lower === 'etemaro'
  )
}

/**
 * Format a human-readable error message when configuration loading or validation fails.
 * Points to the exact JSON configuration file path, identifies required fields pointing to
 * unset environment variables, and instructs the user how to either set the env var or
 * update the JSON file directly.
 */
export function formatConfigLoadError(err: any): string {
  const configFilePath =
    err?.configPath ||
    err?.cause?.configPath ||
    process.env.USER_CONFIG_PATH ||
    _USER_CONFIG_PATH ||
    path.resolve(process.cwd(), 'config', 'user-config.json')

  const issues: any[] =
    (Array.isArray(err?.issues) && err.issues) ||
    (Array.isArray(err?.cause?.issues) && err.cause.issues) ||
    (Array.isArray(err?.cause?.cause?.issues) && err.cause.cause.issues) ||
    (Array.isArray(err?.cause?.cause?.errors) && err.cause.cause.errors) ||
    []

  if (issues.length === 0) {
    return [
      '',
      '[config] Failed to load configuration:',
      `  Configuration file: ${configFilePath}`,
      `  Error: ${err?.message ?? String(err)}`,
      '',
    ].join('\n')
  }

  const envIssues: Array<{ field: string; envVar: string }> = []
  const otherIssues: Array<{ field: string; message: string }> = []

  for (const issue of issues) {
    const field = Array.isArray(issue.path) && issue.path.length > 0 ? issue.path.join('.') : 'configuration'
    const envMatch = issue.message?.match(/Environment variable (\w+)/)
    const envVar = issue.params?.envVar || envMatch?.[1]
    if (envVar) {
      envIssues.push({ field, envVar })
    } else {
      otherIssues.push({ field, message: issue.message || 'Invalid value' })
    }
  }

  const lines: string[] = []
  lines.push('')
  lines.push('[config] Configuration validation failed:')
  lines.push(`  Configuration file: ${configFilePath}`)
  lines.push('')

  if (envIssues.length > 0) {
    lines.push('The following required configuration values reference environment variables that are not set:')
    for (const item of envIssues) {
      lines.push(
        `  • Field "${item.field}" requires environment variable: ${item.envVar} (referenced as "env.${item.envVar}")`,
      )
    }
    lines.push('')
    lines.push('You should EITHER:')
    lines.push('  1. Set the environment variable in your .env file or system environment:')
    const uniqueVars = [...new Set(envIssues.map((i) => i.envVar))]
    for (const v of uniqueVars) {
      lines.push(`     ${v}=<value>`)
    }
    lines.push('')
    lines.push('  2. OR update the value directly in your configuration file:')
    lines.push(`     ${configFilePath}`)
    lines.push('     (specify the actual value directly instead of referencing "env.VARIABLE")')
  }

  if (otherIssues.length > 0) {
    if (envIssues.length > 0) lines.push('')
    lines.push('Additional configuration schema errors:')
    for (const item of otherIssues) {
      lines.push(`  • Field "${item.field}": ${item.message}`)
    }
    lines.push(`\nPlease review and fix your configuration file: ${configFilePath}`)
  }

  lines.push('')
  return lines.join('\n')
}

const isMain = isCliTarget(process.argv[1]) || (typeof require !== 'undefined' && require.main === module)

if (isMain) {
  main().catch((err) => {
    // Human-readable error output for config validation issues
    if (
      err &&
      (err.name === 'ConfigLoadError' ||
        err.constructor?.name === 'ConfigLoadError' ||
        String(err.message).includes('[config]'))
    ) {
      console.error(formatConfigLoadError(err))
      process.exit(1)
    }
    console.error(err.message ?? err)
    process.exit(1)
  })
}

/**
 * Extract the value for a `--flag`/`-f` pair from an argv array.
 * Returns undefined if the flag is absent, has no value, or the value
 * looks like another flag (so `etemaro balance --config` with no path
 * does not swallow the next subcommand).
 *
 * Extracted as a pure function for direct unit testing.
 */
export function resolveGlobalFlagValue(argv: string[], flag: string, alias?: string): string | undefined {
  const idx = argv.findIndex((a) => a === flag || (alias !== undefined && a === alias))
  if (idx === -1) return undefined
  const value = argv[idx + 1]
  if (value === undefined || value.startsWith('-')) return undefined
  return value
}

/** Apply CLI flags that must be visible to core before any tool runs. */
export function applyCliRuntimeFlags(flags: Record<string, unknown>, env: NodeJS.Dict<string> = process.env): void {
  if (flags['dry-run'] === true) env.DRY_RUN = 'true'
}

function defaultEtemaroHome(): string {
  const fromEnv = process.env.ETEMARO_HOME?.trim()
  if (fromEnv) return path.resolve(fromEnv)
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const xdg = process.env.XDG_CONFIG_HOME || (home ? path.join(home, '.config') : '')
  return path.join(xdg, 'etemaro')
}

async function askTty(question: string): Promise<string> {
  const rl = readline.createInterface({ input: stdinStream, output: stdoutStream })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}

async function main() {
  const argv = process.argv.slice(2)

  if (argv.includes('--version')) {
    process.stdout.write(`${pkgVersion}\n`)
    return
  }

  const configPathArg = resolveGlobalFlagValue(argv, '--config', '-c')
  const dataDirArg = resolveGlobalFlagValue(argv, '--data-dir', '-d')
  if (configPathArg) process.env.USER_CONFIG_PATH = path.resolve(configPathArg)
  if (dataDirArg) process.env.ETEMARO_DATA_DIR = path.resolve(dataDirArg)

  // Validation commands must be able to report on a broken/invalid config, so let
  // core fall back to defaults instead of exiting during import.
  if (argv.includes('validate')) process.env.ETEMARO_SKIP_ENV_VALIDATION = '1'

  loadRuntimeDotenv(defaultEtemaroHome())
  await loadCore()

  const agentLoopDeps = {
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

  const daemon = new DaemonCtor({
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

  const cli = new Cli({
    meteora,
    wallet,
    screening,
    toolExecutor,
    domain: {
      ...domain,
      validateConfigFile,
      addPoolNote: (pool: string, note: string) => domain.addPoolNote({ pool_address: pool, note }),
      getTokenNarrative: token.getTokenNarrative,
      getTokenInfo: token.getTokenInfo,
      getTokenHolders: token.getTokenHolders,
      studyTopLPers: study.studyTopLPers,
    },
    token,
    daemon,
  })
  await cli.run(argv)
}
