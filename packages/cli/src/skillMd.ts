/**
 * @file skillMd.ts
 * @description Embedded SKILL.md content used by the CLI for agent discovery.
 */
export const SKILL_MD = `# etemaro — Solana DLMM LP Agent CLI

Data dir: ~/.config/etemaro/

## Commands

### etemaro pnl <position_address>
Returns PnL for a specific position.
\`\`\`
Output: { pnl_pct, pnl_usd, unclaimed_fee_usd, all_time_fees_usd, current_value_usd, lower_bin, upper_bin, active_bin }
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

> Repo clone (no global etemaro)? Prefix commands with "npm run cli --" (keep the --), e.g. npm run cli -- wallet import --name <alias> --prompt.

### etemaro wallet generate [--name <alias>] [--show-private-key]
Generates a new Solana keypair and stores it in the local keystore (~/.config/etemaro/.credentials/wallets/<alias>.json, mode 0600). Encrypted with AES-256-GCM when ETEMARO_KEYSTORE_PASSPHRASE is set; plaintext otherwise. The private key is only printed when --show-private-key is passed.
\`\`\`
Output: { success, publicKey, createdAt, label, savedTo }
\`\`\`

### etemaro wallet import --name <alias> [--private-key <key>] [--file <path>] [--prompt]
Imports an existing wallet. Prefer --prompt or --file: --private-key exposes the secret in shell history and process listings.
Run "etemaro wallet import" with no flags on a terminal for a guided flow: it asks for the alias, then whether to import from a keypair JSON file or a Base58 private key.
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

### etemaro pool-memory --pool <addr>
Returns deploy history for a specific pool from pool-memory.json.
\`\`\`
Output: { pool_address, known, name, total_deploys, win_rate, avg_pnl_pct, last_outcome, notes, history }
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
--config <path>  Path to agent-config.json (alias: -c). Overrides AGENT_CONFIG_PATH env var.
--data-dir <path>  Data directory (alias: -d). Overrides ETEMARO_DATA_DIR/DATA_DIR env vars.
`
