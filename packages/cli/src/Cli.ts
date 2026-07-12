/**
 * Meridian CLI — one-shot command-line interface.
 *
 * Exposes all tools as subcommands with JSON output. Writes a SKILL.md
 * to ~/.meridian/ for agent discovery. All adapter dependencies are
 * injected for testability.
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { parseArgs } from "util";
import {
  config,
  computeDeployAmount,
  getTrackedPosition,
  log,
  dataPath,
  meteora,
  wallet,
  screening,
  toolExecutor,
  domain,
  token,
  study,
  telegram,
  briefing,
  hivemind,
  tools,
} from "@meridian/core";
import { Daemon } from "@meridian/daemon";

// ─── Adapter Imports ────────────────────────────────────────────

export interface CliAdapters {
  meteora: {
    getMyPositions: (opts?: { force?: boolean; silent?: boolean }) => Promise<any>;
    closePosition: (opts: { position_address: string }) => Promise<any>;
    getActiveBin: (opts: { pool_address: string }) => Promise<any>;
    getPositionPnl: (opts: { pool_address: string; position_address: string }) => Promise<any>;
    searchPools: (opts: { query: string; limit: number }) => Promise<any>;
    getWalletPositions: (opts: { wallet_address: string }) => Promise<any>;
  };
  wallet: {
    getWalletBalances: () => Promise<any>;
    swapToken: (opts: any) => Promise<any>;
  };
  screening: {
    getTopCandidates: (opts: { limit: number }) => Promise<any>;
    getPoolDetail: (opts: any) => Promise<any>;
  };
  toolExecutor: {
    executeTool: (name: string, args: Record<string, unknown>) => Promise<any>;
  };
  domain: {
    getActiveStrategy: () => any;
    recallForPool: (pool: string) => string | null;
    addPoolNote: (pool: string, note: string) => void;
    checkSmartWalletsOnPool: (opts: { pool_address: string }) => Promise<any>;
    getTokenNarrative: (opts: { mint: string }) => Promise<any>;
    getTokenInfo: (opts: { query: string }) => Promise<any>;
    getTokenHolders: (opts: { mint: string; limit: number }) => Promise<any>;
    studyTopLPers: (opts: { pool_address: string; limit: number }) => Promise<any>;
    listLessons: (opts: { limit: number }) => any;
    addLesson: (text: string, tags: string[], opts: any) => void;
    getPoolMemory: (opts: { pool_address: string }) => any;
    evolveThresholds: (perf: any[], cfg: any) => any;
    addToBlacklist: (opts: { mint: string; reason: string }) => any;
    listBlacklist: () => any;
    getPerformanceHistory: (opts: { hours: number; limit: number }) => any;
    getPerformanceSummary: () => any;
  };
  daemon?: {
    runScreeningCycle: (opts?: { silent?: boolean }) => Promise<string | null>;
    runManagementCycle: (opts?: { silent?: boolean }) => Promise<string | null>;
    startCronJobs: () => void;
  };
  token?: {
    getTokenInfo: (opts: { query: string }) => Promise<any>;
    getTokenHolders: (opts: { mint: string; limit: number }) => Promise<any>;
    getTokenNarrative: (opts: { mint: string }) => Promise<any>;
  };
}

// ─── SKILL.md ───────────────────────────────────────────────────

const SKILL_MD = `# meridian — Solana DLMM LP Agent CLI

Data dir: ~/.meridian/

## Commands

### meridian balance
Returns wallet SOL and token balances.
\`\`\`
Output: { wallet, sol, sol_usd, usdc, tokens: [{mint, symbol, balance, usd_value}], total_usd }
\`\`\`

### meridian positions
Returns all open DLMM positions.
\`\`\`
Output: { positions: [{position, pool, pair, in_range, age_minutes, ...}], total_positions }
\`\`\`

### meridian pnl <position_address>
Returns PnL for a specific position.
\`\`\`
Output: { pnl_pct, pnl_usd, unclaimed_fee_usd, all_time_fees_usd, current_value_usd, lower_bin, upper_bin, active_bin }
\`\`\`

### meridian screen [--dry-run] [--silent]
Runs one AI screening cycle to find and deploy new positions.
\`\`\`
Output: { done: true, report: "..." }
\`\`\`

### meridian manage [--dry-run] [--silent]
Runs one AI management cycle over open positions.
\`\`\`
Output: { done: true, report: "..." }
\`\`\`

### meridian deploy --pool <addr> --amount <sol> [--bins-below 69] [--bins-above 0] [--strategy bid_ask|spot] [--dry-run]
Deploys a new LP position. All safety checks apply.
\`\`\`
Output: { success, position, pool_name, txs, price_range, bin_step }
\`\`\`

### meridian claim --position <addr>
Claims accumulated swap fees for a position.
\`\`\`
Output: { success, position, txs, base_mint }
\`\`\`

### meridian close --position <addr> [--skip-swap] [--dry-run]
Closes a position. Auto-swaps base token to SOL unless --skip-swap.
\`\`\`
Output: { success, pnl_pct, pnl_usd, txs, base_mint }
\`\`\`

### meridian swap --from <mint> --to <mint> --amount <n> [--dry-run]
Swaps tokens via Jupiter. Use "SOL" as mint shorthand.
\`\`\`
Output: { success, tx, input_amount, output_amount }
\`\`\`

### meridian candidates [--limit 5]
Returns top pool candidates fully enriched: pool metrics, token audit, holders, smart wallets, narrative, active bin, pool memory.
\`\`\`
Output: { candidates: [{name, pool, bin_step, fee_pct, volume, tvl, organic_score, active_bin, smart_wallets, token: {holders, audit, global_fees_sol, ...}, holders, narrative, pool_memory}] }
\`\`\`

### meridian study --pool <addr> [--limit 4]
Studies top LPers on a pool. Returns behaviour patterns, hold times, win rates, strategies.
\`\`\`
Output: { pool, patterns: {top_lper_count, avg_hold_hours, avg_win_rate, ...}, lpers: [{owner, summary, positions}] }
\`\`\`

### meridian token-info --query <mint_or_symbol>
Returns token audit, mcap, launchpad, price stats, fee data.
\`\`\`
Output: { results: [{mint, symbol, mcap, launchpad, audit, stats_1h, global_fees_sol, ...}] }
\`\`\`

### meridian token-holders --mint <addr> [--limit 20]
Returns holder distribution, bot %, top holder concentration.
\`\`\`
Output: { mint, holders, top_10_real_holders_pct, bundlers_pct_in_top_100, global_fees_sol, ... }
\`\`\`

### meridian token-narrative --mint <addr>
Returns AI-generated narrative about the token.
\`\`\`
Output: { mint, narrative }
\`\`\`

### meridian pool-detail --pool <addr> [--timeframe 5m]
Returns detailed pool metrics for a specific pool.
\`\`\`
Output: { pool, name, bin_step, fee_pct, volume, tvl, volatility, ... }
\`\`\`

### meridian search-pools --query <name_or_symbol> [--limit 10]
Searches pools by name or token symbol.
\`\`\`
Output: { pools: [{pool, name, bin_step, fee_pct, tvl, volume, ...}] }
\`\`\`

### meridian active-bin --pool <addr>
Returns the current active bin for a pool.
\`\`\`
Output: { pool, binId, price }
\`\`\`

### meridian wallet-positions --wallet <addr>
Returns DLMM positions for any wallet address.
\`\`\`
Output: { wallet, positions: [...], total_positions }
\`\`\`

### meridian config get
Returns the full runtime config.

### meridian config set <key> <value>
Updates a config key. Parses value as JSON when possible.
\`\`\`
Valid keys: minTvl, maxTvl, minVolume, maxPositions, deployAmountSol, managementIntervalMin, screeningIntervalMin, managementModel, screeningModel, generalModel, autoSwapAfterClaim, minClaimAmount, outOfRangeWaitMinutes
\`\`\`

### meridian lessons [--limit 50]
Lists all lessons from lessons.json. Shows rule, tags, pinned status, outcome, role.
\`\`\`
Output: { total, lessons: [{id, rule, tags, outcome, pinned, role, created_at}] }
\`\`\`

### meridian lessons add <text>
Adds a manual lesson with outcome=manual, role=null (applies to all roles).
\`\`\`
Output: { saved: true, rule, outcome, role }
\`\`\`

### meridian pool-memory --pool <addr>
Returns deploy history for a specific pool from pool-memory.json.
\`\`\`
Output: { pool_address, known, name, total_deploys, win_rate, avg_pnl_pct, last_outcome, notes, history }
\`\`\`

### meridian evolve
Runs evolveThresholds() over all closed position data and updates user-config.json.
\`\`\`
Output: { evolved, changes, rationale }
\`\`\`

### meridian blacklist add --mint <addr> --reason <text>
Permanently blacklists a token mint so it is never deployed into.
\`\`\`
Output: { blacklisted, mint, reason }
\`\`\`

### meridian blacklist list
Lists all blacklisted token mints with reasons and timestamps.
\`\`\`
Output: { count, blacklist: [{mint, symbol, reason, added_at}] }
\`\`\`

### meridian performance [--limit 200]
Shows all closed position performance history with summary stats.
\`\`\`
Output: { summary: { total_positions_closed, total_pnl_usd, avg_pnl_pct, win_rate_pct, total_lessons }, count, positions: [...] }
\`\`\`

### meridian discord-signals [clear]
Shows pending Discord signal queue from the discord-listener process.
\`\`\`
Output: { count, pending, processed, signals: [{id, symbol, pool, author, channel, queued_at, rug_score, status}] }
\`\`\`

### meridian start [--dry-run]
Starts the autonomous agent with cron jobs (management + screening).

## Flags
--dry-run     Skip all on-chain transactions
--silent      Suppress Telegram notifications for this run
`;

// ─── Output Helpers ─────────────────────────────────────────────

function out(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  process.exit(0);
}

function die(msg: string, extra: Record<string, unknown> = {}): never {
  process.stderr.write(JSON.stringify({ error: msg, ...extra }) + "\n");
  process.exit(1);
}

// ─── CLI Class ──────────────────────────────────────────────────

export class Cli {
  private adapters: CliAdapters;
  private meridianDir: string;

  constructor(adapters: CliAdapters) {
    this.adapters = adapters;
    this.meridianDir = path.join(process.env.HOME || "", ".meridian");
  }

  // ─── Lifecycle ─────────────────────────────────────────────────

  async run(argv: string[] = process.argv.slice(2)): Promise<void> {
    // Write SKILL.md for agent discovery
    this.writeSkillMd();

    // Parse args
    const subcommand = argv.find(a => !a.startsWith("-"));
    const sub2 = argv.filter(a => !a.startsWith("-"))[1];

    if (!subcommand || subcommand === "help" || argv.includes("--help")) {
      process.stdout.write(SKILL_MD);
      process.exit(0);
    }

    // Parse flags
    const { values: flags } = parseArgs({
      args: argv,
      options: {
        pool: { type: "string" },
        amount: { type: "string" },
        position: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        strategy: { type: "string" },
        query: { type: "string" },
        mint: { type: "string" },
        wallet: { type: "string" },
        timeframe: { type: "string" },
        reason: { type: "string" },
        "bins-below": { type: "string" },
        "bins-above": { type: "string" },
        "amount-x": { type: "string" },
        "amount-y": { type: "string" },
        "bps": { type: "string" },
        "no-claim": { type: "boolean" },
        "skip-swap": { type: "boolean" },
        "dry-run": { type: "boolean" },
        "silent": { type: "boolean" },
        limit: { type: "string" },
      },
      allowPositionals: true,
      strict: false,
    });

    switch (subcommand) {
      case "balance": return this.handleBalance();
      case "positions": return this.handlePositions();
      case "pnl": return this.handlePnl(argv, flags);
      case "candidates": return this.handleCandidates(flags);
      case "token-info": return this.handleTokenInfo(argv, flags);
      case "token-holders": return this.handleTokenHolders(argv, flags);
      case "token-narrative": return this.handleTokenNarrative(argv, flags);
      case "pool-detail": return this.handlePoolDetail(flags);
      case "search-pools": return this.handleSearchPools(argv, flags);
      case "active-bin": return this.handleActiveBin(flags);
      case "wallet-positions": return this.handleWalletPositions(argv, flags);
      case "deploy": return this.handleDeploy(argv, flags);
      case "claim": return this.handleClaim(flags);
      case "close": return this.handleClose(flags);
      case "swap": return this.handleSwap(flags);
      case "screen": return this.handleScreen(flags);
      case "manage": return this.handleManage(flags);
      case "config": return this.handleConfig(argv, sub2);
      case "study": return this.handleStudy(flags);
      case "start": return this.handleStart();
      case "lessons": return this.handleLessons(argv, sub2, flags);
      case "pool-memory": return this.handlePoolMemory(flags);
      case "evolve": return this.handleEvolve();
      case "blacklist": return this.handleBlacklist(argv, sub2, flags);
      case "performance": return this.handlePerformance(flags);
      case "discord-signals": return this.handleDiscordSignals(sub2);
      default: die(`Unknown command: ${subcommand}. Run 'meridian help' for usage.`);
    }
  }

  // ─── SKILL.md ──────────────────────────────────────────────────

  private writeSkillMd(): void {
    fs.mkdirSync(this.meridianDir, { recursive: true });
    fs.writeFileSync(path.join(this.meridianDir, "SKILL.md"), SKILL_MD);
  }

  // ─── Command Handlers ──────────────────────────────────────────

  private async handleBalance(): Promise<void> {
    out(await this.adapters.wallet.getWalletBalances());
  }

  private async handlePositions(): Promise<void> {
    out(await this.adapters.meteora.getMyPositions({ force: true }));
  }

  private async handlePnl(argv: string[], flags: Record<string, any>): Promise<void> {
    const posAddr = argv.find((a, i) => !a.startsWith("-") && i > 0 && argv[i - 1] !== "--position" && a !== "pnl");
    const positionAddress = flags.position || posAddr;
    if (!positionAddress) die("Usage: meridian pnl <position_address>");

    let poolAddress: string;
    const tracked = getTrackedPosition(positionAddress);
    if (tracked?.pool) {
      poolAddress = tracked.pool;
    } else {
      const pos = await this.adapters.meteora.getMyPositions({ force: true });
      const found = pos.positions?.find((p: any) => p.position === positionAddress);
      if (!found) die("Position not found", { position: positionAddress });
      poolAddress = found.pool;
    }

    const pnl = await this.adapters.meteora.getPositionPnl({
      pool_address: poolAddress,
      position_address: positionAddress,
    });
    if (tracked?.strategy) pnl.strategy = tracked.strategy;
    if (tracked?.instruction) pnl.instruction = tracked.instruction;
    out(pnl);
  }

  private async handleCandidates(flags: Record<string, any>): Promise<void> {
    const limit = parseInt(flags.limit || "5");
    const raw = await this.adapters.screening.getTopCandidates({ limit });
    const pools = raw.candidates || raw.pools || [];

    const enriched = [];
    for (const pool of pools) {
      const mint = pool.base?.mint;
      const [activeBin, smartWallets, tokenInfo, holders, narrative] = await Promise.allSettled([
        this.adapters.meteora.getActiveBin({ pool_address: pool.pool }),
        this.adapters.domain.checkSmartWalletsOnPool({ pool_address: pool.pool }),
        mint ? this.adapters.domain.getTokenInfo({ query: mint }) : Promise.resolve(null),
        mint ? this.adapters.domain.getTokenHolders({ mint, limit: 20 }) : Promise.resolve(null),
        mint ? this.adapters.domain.getTokenNarrative({ mint }) : Promise.resolve(null),
      ]);
      const ti = tokenInfo.status === "fulfilled" ? tokenInfo.value?.results?.[0] : null;
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
        active_bin: activeBin.status === "fulfilled" ? activeBin.value?.binId : null,
        smart_wallets: smartWallets.status === "fulfilled" ? (smartWallets.value?.in_pool || []).map((w: any) => w.name) : [],
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
        holders: holders.status === "fulfilled" ? holders.value : null,
        narrative: narrative.status === "fulfilled" ? narrative.value?.narrative : null,
        pool_memory: this.adapters.domain.recallForPool(pool.pool) || null,
      });
      await new Promise(r => setTimeout(r, 150));
    }

    out({ candidates: enriched, total_screened: raw.total_screened });
  }

  private async handleTokenInfo(argv: string[], flags: Record<string, any>): Promise<void> {
    const query = flags.query || flags.mint || argv.find((a, i) => !a.startsWith("-") && i > 0 && a !== "token-info");
    if (!query) die("Usage: meridian token-info --query <mint_or_symbol>");
    out(await this.adapters.domain.getTokenInfo({ query }));
  }

  private async handleTokenHolders(argv: string[], flags: Record<string, any>): Promise<void> {
    const mint = flags.mint || argv.find((a, i) => !a.startsWith("-") && i > 0 && a !== "token-holders");
    if (!mint) die("Usage: meridian token-holders --mint <addr>");
    const limit = flags.limit ? parseInt(flags.limit) : 20;
    out(await this.adapters.domain.getTokenHolders({ mint, limit }));
  }

  private async handleTokenNarrative(argv: string[], flags: Record<string, any>): Promise<void> {
    const mint = flags.mint || argv.find((a, i) => !a.startsWith("-") && i > 0 && a !== "token-narrative");
    if (!mint) die("Usage: meridian token-narrative --mint <addr>");
    out(await this.adapters.domain.getTokenNarrative({ mint }));
  }

  private async handlePoolDetail(flags: Record<string, any>): Promise<void> {
    if (!flags.pool) die("Usage: meridian pool-detail --pool <addr> [--timeframe 5m]");
    out(await this.adapters.screening.getPoolDetail({
      pool_address: flags.pool,
      timeframe: flags.timeframe || "5m",
    }));
  }

  private async handleSearchPools(argv: string[], flags: Record<string, any>): Promise<void> {
    const query = flags.query || argv.find((a, i) => !a.startsWith("-") && i > 0 && a !== "search-pools");
    if (!query) die("Usage: meridian search-pools --query <name_or_symbol>");
    const limit = flags.limit ? parseInt(flags.limit) : 10;
    out(await this.adapters.meteora.searchPools({ query, limit }));
  }

  private async handleActiveBin(flags: Record<string, any>): Promise<void> {
    if (!flags.pool) die("Usage: meridian active-bin --pool <addr>");
    out(await this.adapters.meteora.getActiveBin({ pool_address: flags.pool }));
  }

  private async handleWalletPositions(argv: string[], flags: Record<string, any>): Promise<void> {
    const wallet = flags.wallet || argv.find((a, i) => !a.startsWith("-") && i > 0 && a !== "wallet-positions");
    if (!wallet) die("Usage: meridian wallet-positions --wallet <addr>");
    out(await this.adapters.meteora.getWalletPositions({ wallet_address: wallet }));
  }

  private async handleDeploy(argv: string[], flags: Record<string, any>): Promise<void> {
    if (!flags.pool) die("Usage: meridian deploy --pool <addr> --amount <sol>");
    const amountX = flags["amount-x"] ? parseFloat(flags["amount-x"]) : undefined;
    if (!flags.amount && !amountX) die("--amount or --amount-x is required");

    out(await this.adapters.toolExecutor.executeTool("deploy_position", {
      pool_address: flags.pool,
      amount_y: flags.amount ? parseFloat(flags.amount) : undefined,
      amount_x: amountX,
      strategy: flags.strategy,
      single_sided_x: argv.includes("--single-sided-x"),
      bins_below: flags["bins-below"] ? parseInt(flags["bins-below"]) : undefined,
      bins_above: flags["bins-above"] ? parseInt(flags["bins-above"]) : undefined,
      allow_duplicate_pool: argv.includes("--allow-duplicate-pool"),
    }));
  }

  private async handleClaim(flags: Record<string, any>): Promise<void> {
    if (!flags.position) die("Usage: meridian claim --position <addr>");
    out(await this.adapters.toolExecutor.executeTool("claim_fees", { position_address: flags.position }));
  }

  private async handleClose(flags: Record<string, any>): Promise<void> {
    if (!flags.position) die("Usage: meridian close --position <addr>");
    out(await this.adapters.toolExecutor.executeTool("close_position", {
      position_address: flags.position,
      skip_swap: flags["skip-swap"] ?? false,
    }));
  }

  private async handleSwap(flags: Record<string, any>): Promise<void> {
    if (!flags.from || !flags.to || !flags.amount) die("Usage: meridian swap --from <mint> --to <mint> --amount <n>");
    out(await this.adapters.toolExecutor.executeTool("swap_token", {
      input_mint: flags.from,
      output_mint: flags.to,
      amount: parseFloat(flags.amount),
    }));
  }

  private async handleScreen(flags: Record<string, any>): Promise<void> {
    if (!this.adapters.daemon) die("Screen command requires daemon adapter");
    const report = await this.adapters.daemon.runScreeningCycle({ silent: flags.silent });
    out({ done: true, report: report || "No action taken" });
  }

  private async handleManage(flags: Record<string, any>): Promise<void> {
    if (!this.adapters.daemon) die("Manage command requires daemon adapter");
    const report = await this.adapters.daemon.runManagementCycle({ silent: flags.silent });
    out({ done: true, report: report || "No action taken" });
  }

  private async handleConfig(argv: string[], sub2: string | undefined): Promise<void> {
    if (sub2 === "get" || !sub2) {
      out(config);
    } else if (sub2 === "set") {
      const key = argv.filter(a => !a.startsWith("-"))[2];
      const rawVal = argv.filter(a => !a.startsWith("-"))[3];
      if (!key || rawVal === undefined) die("Usage: meridian config set <key> <value>");
      let value: unknown = rawVal;
      try { value = JSON.parse(rawVal); } catch { /* keep as string */ }
      out(await this.adapters.toolExecutor.executeTool("update_config", {
        changes: { [key]: value },
        reason: "CLI config set",
      }));
    } else {
      die(`Unknown config subcommand: ${sub2}. Use: get, set`);
    }
  }

  private async handleStudy(flags: Record<string, any>): Promise<void> {
    if (!flags.pool) die("Usage: meridian study --pool <addr> [--limit 4]");
    const limit = flags.limit ? parseInt(flags.limit) : 4;
    out(await this.adapters.domain.studyTopLPers({ pool_address: flags.pool, limit }));
  }

  private handleStart(): void {
    if (!this.adapters.daemon) die("Start command requires daemon adapter");
    process.stderr.write("[meridian] Starting autonomous agent...\n");
    this.adapters.daemon.startCronJobs();
  }

  private async handleLessons(argv: string[], sub2: string | undefined, flags: Record<string, any>): Promise<void> {
    if (sub2 === "add") {
      const text = argv.filter(a => !a.startsWith("-")).slice(2).join(" ");
      if (!text) die("Usage: meridian lessons add <text>");
      this.adapters.domain.addLesson(text, [], { pinned: false, role: null });
      out({ saved: true, rule: text, outcome: "manual", role: null });
    } else {
      const limit = flags.limit ? parseInt(flags.limit) : 50;
      out(this.adapters.domain.listLessons({ limit }));
    }
  }

  private handlePoolMemory(flags: Record<string, any>): void {
    if (!flags.pool) die("Usage: meridian pool-memory --pool <addr>");
    out(this.adapters.domain.getPoolMemory({ pool_address: flags.pool }));
  }

  private handleEvolve(): void {
    const lessonsFile = path.join(process.cwd(), "lessons.json");
    let perfData: any[] = [];
    if (fs.existsSync(lessonsFile)) {
      try { perfData = JSON.parse(fs.readFileSync(lessonsFile, "utf8")).performance || []; } catch { /* no data */ }
    }
    const result = this.adapters.domain.evolveThresholds(perfData, config);
    if (!result) {
      out({ evolved: false, reason: `Need at least 5 closed positions (have ${perfData.length})` });
    } else {
      out({ evolved: Object.keys(result.changes).length > 0, changes: result.changes, rationale: result.rationale });
    }
  }

  private handleBlacklist(argv: string[], sub2: string | undefined, flags: Record<string, any>): void {
    if (sub2 === "add") {
      if (!flags.mint) die("Usage: meridian blacklist add --mint <addr> --reason <text>");
      if (!flags.reason) die("--reason is required");
      out(this.adapters.domain.addToBlacklist({ mint: flags.mint, reason: flags.reason }));
    } else if (sub2 === "list" || !sub2) {
      out(this.adapters.domain.listBlacklist());
    } else {
      die(`Unknown blacklist subcommand: ${sub2}. Use: add, list`);
    }
  }

  private handlePerformance(flags: Record<string, any>): void {
    const limit = flags.limit ? parseInt(flags.limit) : 200;
    const history = this.adapters.domain.getPerformanceHistory({ hours: 999999, limit });
    const summary = this.adapters.domain.getPerformanceSummary();
    out({ summary, ...history });
  }

  private handleDiscordSignals(sub2: string | undefined): void {
    const sigFile = dataPath("discord-signals.json");
    if (!fs.existsSync(sigFile)) {
      out({ count: 0, pending: 0, signals: [], message: "No discord-signals.json found. Is the listener running?" });
      return;
    }
    let signals: any[] = [];
    try { signals = JSON.parse(fs.readFileSync(sigFile, "utf8")); } catch { die("Failed to parse discord-signals.json"); }

    if (sub2 === "clear") {
      const pending = signals.filter(s => s.status === "pending");
      fs.writeFileSync(sigFile, JSON.stringify(pending, null, 2));
      out({ cleared: signals.length - pending.length, remaining: pending.length });
      return;
    }

    const pending = signals.filter(s => s.status === "pending");
    const processed = signals.filter(s => s.status !== "pending");
    out({
      count: signals.length,
      pending: pending.length,
      processed: processed.length,
      signals: signals.map(s => ({
        id: s.id,
        symbol: s.base_symbol,
        pool: s.pool_address,
        author: s.discord_author,
        channel: s.discord_channel,
        queued_at: s.queued_at,
        rug_score: s.rug_score,
        status: s.status,
        snippet: s.discord_message_snippet?.slice(0, 60),
      })),
    });
  }
}

// ─── Self-Execution ──────────────────────────────────────────────
const isMain = process.argv[1] && (
  process.argv[1].endsWith("Cli.ts") || 
  process.argv[1].endsWith("Cli.js") ||
  process.argv[1].endsWith("cli.js")
);

if (isMain) {
  const agentLoopDeps = {
    executeTool: toolExecutor.executeTool,
    getTools: () => tools,
    getWalletBalances: async () => {
      const bal = await wallet.getWalletBalances();
      return {
        sol: bal.sol,
        usd: bal.sol_usd,
        tokens: bal.tokens.map((t: any) => ({
          mint: t.mint,
          symbol: t.symbol,
          amount: t.amount,
          usd: t.usd
        }))
      };
    },
    getMyPositions: meteora.getMyPositions,
    getStateSummary: domain.getStateSummary,
    getLessonsForPrompt: (opts: any) => domain.getLessonsForPrompt(opts),
    getPerformanceSummary: () => {
      const summary = domain.getPerformanceSummary();
      return summary ? JSON.stringify(summary) : null;
    },
    getDecisionSummary: domain.getDecisionSummary,
    getWeightsSummary: domain.getWeightsSummary,
  };

  const daemon = new Daemon({
    meteora,
    wallet,
    screening,
    toolExecutor,
    telegram,
    briefing,
    hivemind,
    domain: {
      ...domain,
      addPoolNote: (pool: string, note: string) => domain.addPoolNote({ pool_address: pool, note }),
      getTokenNarrative: token.getTokenNarrative,
      getTokenInfo: token.getTokenInfo,
    },
    agentLoopDeps,
  });

  const cli = new Cli({
    meteora,
    wallet,
    screening,
    toolExecutor,
    domain: {
      ...domain,
      addPoolNote: (pool: string, note: string) => domain.addPoolNote({ pool_address: pool, note }),
      getTokenNarrative: token.getTokenNarrative,
      getTokenInfo: token.getTokenInfo,
      getTokenHolders: token.getTokenHolders,
      studyTopLPers: study.studyTopLPers,
    },
    token,
    daemon,
  });
  cli.run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
