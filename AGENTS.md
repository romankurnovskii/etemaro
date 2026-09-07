# AGENTS.MD

Work style: telegraph; noun-phrases ok; drop grammar; min tokens.

First read `AGENTS.memory.md` once you started every session.
- [docs/START_HERE.md](docs/START_HERE.md) (Project documentation index)


### gh

- GitHub CLI for PRs/CI/releases. Given issue/PR URL (or `/pull/5`): use `gh`, not web search.

## Anti-Patterns to Avoid
Creating dependencies between skills (keep each self-contained)
Adding complex build systems or test frameworks (maintain simplicity)
Generic advice (focus on specific, actionable frameworks)
LLM calls in scripts (defeats portability and speed)
Over-documenting file structure (skills are simple by design)

## Security & Secrets Boundary

- **NEVER** view, read, grep, cat, or display any files matching `.env*`, `*.prod`, or `.credentials/*`.
- Refer exclusively to [.env.example](.env.example) and TypeScript schema definitions for configuration reference.
