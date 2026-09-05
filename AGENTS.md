# Agent Documentation System

First read `AGENTS.local.md` once you started every session.

For instructions, guidelines, and project rules, please read:

- [AGENTS.local.md](AGENTS.local.md) (Local agent engineering manual)
- [docs/START_HERE.md](docs/START_HERE.md) (Project documentation index)

## Security & Secrets Boundary

- **NEVER** view, read, grep, cat, or display any files matching `.env*`, `*.prod`, or `.credentials/*`.
- Refer exclusively to [.env.example](.env.example) and TypeScript schema definitions for configuration reference.
