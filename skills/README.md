# Etemaro Skills

Open-standard ([agentskills.io](https://agentskills.io)) skills for DeFi analysis. Install
from this repo; your agent loads a skill when the task matches.

Skills are **read-only**: they fetch public data and rank or explain. They do not deploy
positions, swap, sign, or touch wallets. Live execution is the [Etemaro](https://etemaro.com)
product.

## Catalog

| Skill | What it does |
| :--- | :--- |
| [`meteora-dlmm-pool-screening`](./meteora-dlmm-pool-screening/) | Rank Meteora DLMM pools (fee/TVL, bin step, TVL, organic score) |

Each skill has `SKILL.md` (instructions), `how_to_use.md` (human cheat sheet), and optional
`scripts/` / `references/`.

## Install

```bash
npx skills add romankurnovskii/etemaro
npx skills add romankurnovskii/etemaro --skill meteora-dlmm-pool-screening
```

Works with Claude Code, Codex, Cursor, Gemini CLI, Copilot, and any agent that loads
`SKILL.md`. Then ask e.g. "screen trending Meteora DLMM pools for LP".

Already cloned this repo? Copy the folder instead:

```bash
cp -R skills/meteora-dlmm-pool-screening ./.agents/skills/
```

## Etemaro

Autonomous LP agent for Meteora DLMM on Solana — analysis in the skill, action in the product.

- Site: https://etemaro.com
- GitHub: https://github.com/romankurnovskii/etemaro

## License

MIT unless a skill's `SKILL.md` frontmatter says otherwise.
