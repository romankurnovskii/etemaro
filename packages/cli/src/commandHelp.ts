/**
 * @file commandHelp.ts
 * @description Contextual help text for specific CLI subcommands.
 */

export const SUBCOMMAND_HELP: Record<string, string> = {
  wallet: `etemaro wallet <subcommand> [flags]

Manage local Solana keypairs and keystores in ~/.config/etemaro/.credentials/wallets/

Subcommands:
  generate [--name <alias>] [--show-private-key]
    Generate a new Solana keypair and save to secure keystore.
  import --name <alias> [--file <path> | --prompt | --private-key <key>]
    Import an existing Base58 private key or Solana CLI keypair file.
  list
    List all configured wallets, public keys, and encryption status.
  export --name <alias>
    Export private key (interactive TTY confirmation required).
  remove --name <alias> [--yes]
    Permanently delete a wallet from the keystore.
  swap-all [--skip <mints>]
    Swap all non-SOL tokens in the wallet back to SOL.
`,
  config: `etemaro config <subcommand> [flags]

View, update, and validate agent runtime configuration.

Subcommands:
  get
    Print the active configuration document in JSON format.
  set <key> <value>
    Update a configuration key in the active configuration file.
  validate [<path>] [--json] [--env-optional]
    Validate configuration structure against the canonical schema.
`,
  deploy: `etemaro deploy --pool <addr> --amount <sol> [flags]

Deploy capital into a Meteora DLMM liquidity pool.

Flags:
  --pool <addr>         Pool address to deploy into (required)
  --amount <sol>        SOL amount to deposit
  --amount-x <tokens>   Token X amount (for single-sided or custom entry)
  --strategy <type>     Distribution strategy: spot, curve, bid_ask
  --bins-below <n>      Number of bins below active bin
  --bins-above <n>      Number of bins above active bin
  --dry-run             Simulate deploy without sending on-chain transactions
`,
  close: `etemaro close [--position <addr> | --all] [flags]

Close open DLMM liquidity positions.

Flags:
  --position <addr>     Close a specific position by address
  --all                 Close all open positions
  --skip-swap           Keep tokens instead of auto-swapping to SOL
  --dry-run             Simulate close without sending on-chain transactions
`,
  swap: `etemaro swap --from <mint> --to <mint> --amount <n> [flags]

Swap tokens via Jupiter DEX.

Flags:
  --from <mint>         Input token mint address (or "SOL")
  --to <mint>           Output token mint address (or "SOL")
  --amount <n>          Amount of input tokens to swap
  --dry-run             Simulate swap quote without sending on-chain transaction
`,
  sweep: `etemaro sweep [--skip <mints>]

Sweep and auto-liquidate residual unsold SPL tokens back to SOL.

Flags:
  --skip <mints>        Comma-separated mint addresses to exempt from liquidation
`,
  liquidations: `etemaro liquidations [--status <status>]

Query pending or active token liquidations in the sweeper queue.

Flags:
  --status <state>      Filter by status (pending, completed, failed)
`,
  start: `etemaro start [flags]

Start the autonomous DLMM trading daemon.

Flags:
  --dry-run             Run in simulation mode (no real gas or funds spent)
  --silent              Suppress external notifications (Telegram)
  --config <path>       Custom agent configuration file path
  --data-dir <path>     Custom data directory path
`,
  serve: `etemaro serve [flags]

Run agent headlessly and serve the browser web dashboard.

Flags:
  --port <port>         IPC and web server port (default: 8765)
  --open                Automatically open default web browser to the dashboard
`,
  attach: `etemaro attach [flags]

Connect interactive terminal UI (Ink TUI) to running agent daemon.

Flags:
  --agent <id>          Agent identifier to attach to (default: agent-default)
  --port <port>         Daemon IPC port (default: 8765)
`,
  init: `etemaro init [flags]

Perform first-time workspace setup and configuration scaffolding.

Flags:
  --dir <path>          Target installation directory (default: ~/.config/etemaro)
`,
  'new-agent': `etemaro new-agent [flags]

Create and scaffold a new isolated agent instance configuration.

Flags:
  --name <name>         Human-readable name for the agent
  --desc <text>         Optional agent description
  --id <agentId>        Custom slugified agent identifier
`,
}

export function getContextualHelp(subcommand?: string): string | null {
  if (!subcommand) return null
  return SUBCOMMAND_HELP[subcommand] ?? null
}
