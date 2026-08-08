# Agent Documentation System Rules

Every agent working in this repo **must** read this file first and keep the Memory Bank in sync on every change.

**There is exactly one persistence system in this repo: `.memory-bank/`.** There is no separate `docs/` tree, no `README.md`-as-doc-index, and no `.dev/` scratch directory. If you find yourself wondering "where does this go," the answer is always somewhere under `.memory-bank/` — see Section 3 for the file reference table.

---

## 0. Mandatory Bootstrap (Every Session, Before Anything Else)

1. Check whether `.memory-bank/` exists at the repo root.
   - **If it does not exist**: scaffold the full structure below immediately, unprompted. This does **not** require user approval — it is infrastructure, not a content change. Do this even if the user's task seems small or unrelated to documentation.
   - **If it exists**: proceed to Session Startup (Section 2).
2. Output the compliance statement (Section 1).

```
.memory-bank/
├── toc.md
├── projectbrief.md
├── productContext.md
├── systemPatterns.md
├── techContext.md
├── activeContext.md
├── progress.md
├── projectRules.md
├── decisions.md
├── quick-start.md
├── session-log.jsonl        # operational log, see Section 2
└── tasks/
    └── YYYY-MM/
        └── README.md
```

New files/sections beyond this baseline (e.g. `database-schema.md`, `build-deployment.md`, `testing-patterns.md`) are created on demand when a task actually needs them — not scaffolded speculatively.

### Creating a new package in the monorepo

When a task adds a new package, extend `systemPatterns.md` and `techContext.md` to cover it — do not create a parallel per-package doc tree. One Memory Bank per repo.

### Solana / Meteora integration work

Before modifying Solana or Meteora integration logic, read `.memory-bank/systemPatterns.md#Solana-CLMM-Findings` (or the equivalent section covering known SDK quirks and anti-patterns). If that section doesn't exist yet, that's a signal to create it once you've found something worth recording — not before.

---

## 1. Reuse Over Creation — The Sacred Rules

| Rule                                     | Requirement                                                                                | Validation                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| No new files without reuse analysis      | Search codebase, reference files that cannot be extended, provide exhaustive justification | Before creating: "Analyzed X, Y, Z. Cannot extend because [technical reason]" |
| No rewrites when refactoring is possible | Prefer incremental improvements, justify why refactoring won't work                        | "Refactoring X impossible because [specific limitation]"                      |
| No generic advice                        | Cite `file:line`, show concrete integration points, include migration strategies           | Every suggestion includes a `file:line` citation                              |
| No ignoring existing architecture        | Load patterns before changes, extend existing services/components, consolidate duplicates  | "Extends existing pattern at `file:line`"                                     |

### Reuse Validation Checklist (before creating any file)

```markdown
- [ ] Searched: [search terms] → found: [list files]
- [ ] Analyzed extension:
  - [ ] `existing/file1.ext` - Cannot extend: [specific technical reason]
  - [ ] `existing/file2.ext` - Cannot extend: [specific technical reason]
- [ ] Checked patterns: `systemPatterns.md#[section]`
- [ ] Justification: New file needed because [exhaustive reasoning]
```

### Non-Negotiables

- **Approval Gates**: No _code_ file changes applied without explicit user approval (see Section 6 for what does and doesn't need a separate approval).
- **Citations**: Always `file:line` for code, `file.md#Section` for Memory Bank.
- **Sandbox First**: All edits in branch/temp clone, never main.
- **MCP Preferred**: Use MCP servers for memory, repo ops, QA over brute-force context, when available.
- **No Mock Data**: Never fake/simulated data in production; never stub functions. (Test fixtures and test mocks are fine — this rule is about production code paths.)
- **Context Engineering**: Keep working context focused on the current task.

---

## 2. Session Startup

### Load Priority (choose based on task complexity)

**Every session** (mandatory, after Section 0's bootstrap check):

1. Attach MCP servers: read `.mcp.json` if present.
2. Load Memory Bank per mode below.
3. Append a line to `.memory-bank/session-log.jsonl`:
   `{"ts":"2025-10-25T10:30Z","mode":"fast|standard|deep","mb_v":"2024-10"}`

**Fast Track** (bug fixes, small changes):

- Load current month's `tasks/YYYY-MM/README.md`.
- Check recent achievements and next priorities.
- Load `quick-start.md` if needed.

**Standard Discovery** (features, tests, quality-critical work):

- Current month README.
- Core files: `projectbrief.md`, `systemPatterns.md`, `techContext.md`, `activeContext.md`, `progress.md`.
- Verify `toc.md` and `activeContext.md` are current.

**Deep Dive** (architecture, legacy investigation):

- Standard Discovery files.
- Specific past month's README when investigating legacy work.
- `decisions.md` for architectural context.

### Session Logging

All operational log entries are appended to `.memory-bank/session-log.jsonl` (JSONL, append-only). This is separate from the human-readable Memory Bank content files.

```json
{"timestamp":"2025-10-25T10:30:00Z","session_id":"uuid","mode":"standard","mb_version":"2024-10"}
{"timestamp":"2025-10-25T10:35:00Z","session_id":"uuid","event":"state_transition","from":"PLAN","to":"BUILD"}
{"timestamp":"2025-10-25T11:00:00Z","session_id":"uuid","event":"approval_requested","state":"APPROVAL"}
```

### Compaction Protocol (mid-session context preservation)

Compaction can happen at any time — automatically, via `/compact`, or via platform-level context management — without advance notice. State persistence is therefore continuous, not deferred.

**At every state transition** (`PLAN → BUILD → DIFF → QA → APPROVAL → APPLY → DOCS`):

1. Update `activeContext.md` with current state, substate, and working context.
2. Append current status to `tasks/YYYY-MM/README.md` with an `[IN-PROGRESS]` tag.
3. Append any new architectural decisions to `decisions.md`.
4. Log the transition to `session-log.jsonl`.
5. Capture any conversation-only context (user preferences, verbal requirements, pending questions) into `activeContext.md`.

**After compaction (recovery)**:

1. Re-run Section 0's bootstrap check, then re-enter Session Startup in **Fast Track** mode — full discovery is unnecessary since state was just persisted.
2. Confirm state machine position from `activeContext.md`.
3. Resume from the saved state — do not restart the current task from scratch.
4. Output:
   ```
   COMPACTION RECOVERY: Resumed [STATE] for [task name]
   Context restored from: activeContext.md, tasks/YYYY-MM/README.md
   ```

**Rules**: re-read the Memory Bank after any detected compaction before taking action. If current state is `APPROVAL` or `DIFF`, the diff summary should already be in `activeContext.md`. Compaction does not reset cycle/token/minute budgets — carry them forward from the operational log.

---

## 3. Memory Bank Reference

### File Reference Table

| File                | Purpose               | Load When                 | Update When                           |
| ------------------- | --------------------- | ------------------------- | ------------------------------------- |
| `toc.md`            | Index/navigation      | After adding files        | After new files/tasks                 |
| `projectbrief.md`   | Core requirements     | Complex tasks             | Major pivots                          |
| `productContext.md` | User goals, market    | Complex tasks             | Quarterly/strategy shifts             |
| `systemPatterns.md` | Architecture patterns | Before arch changes       | Pattern discovery                     |
| `techContext.md`    | Tech stack decisions  | Session start             | New tech adoption                     |
| `activeContext.md`  | Current focus         | Every session             | Every state transition                |
| `progress.md`       | Current state         | Session start             | Major features done                   |
| `projectRules.md`   | Coding standards      | When uncertain            | New patterns emerge                   |
| `decisions.md`      | Why X over Y          | Arch decisions            | Arch decisions made                   |
| `tasks/*/README.md` | Monthly summary       | Month-specific work       | Every task completion (see Section 6) |
| `tasks/*/*.md`      | Task documentation    | Investigating past issues | After each completed task             |

### Read vs Write Paths

**Read** (frequent): session startup, before arch decisions, when uncertain, investigating issues.
**Write** (routine, no separate approval beyond the code approval that produced it — see Section 6): after completing a task, pattern discovery, arch decisions, milestone completion, or explicit user request ("update memory bank").

---

## 4. State Machine

### Overview

**States**: `PLAN → BUILD → DIFF → QA → APPROVAL → APPLY → DOCS`
**Substates**: `CODING` (building), `WAITING_TOOL` (permissions), `RUNNING` (QA), `IDLE`

```
PLAN [approve] → BUILD → DIFF → QA [pass] → APPROVAL [approve] → APPLY → DOCS → END
  ↑               ↑______↓______↓_____[fail/changes]______________↓
  └───────────────────────────────────[major changes needed]─────┘
```

### PLAN

**In**: Task contract + MB context | **Out**: Implementation plan | **Exit**: User approves

```markdown
## Plan: [Task Name]

**Analyzed**:

- `path/file.ext:50-100` - Current implementation of X
- `.memory-bank/systemPatterns.md#Pattern` - Established pattern for Y

**Reuse Strategy**:

- Extend `file.ext` - Add method for [functionality]
- Cannot reuse [component] because: [specific technical reason]

**Steps**:

1. [Action] - extends pattern at `file:line`
2. [Action] - adds tests mirroring `test.ext`

**Integration**: [Component A] calls via [method]
**Risks**: [Risk] → mitigation: [approach]
**Tests**: Unit: [scenarios] | Integration: [flows] | Manual: [paths]
```

**Exit**: user responds "approved", "proceed", "looks good".
**Failures**: insufficient reuse analysis → load more MB | ambiguous → ask user | rejected → iterate.

### BUILD

**In**: Approved plan | **Out**: Proposed diff (NOT APPLIED) | **Exit**: All changes complete, diff generated

Substate: `CODING`.

1. Work in branch/temp clone (never main).
2. Create/modify files per approved plan.
3. Follow patterns from `projectRules.md`.
4. Add tests alongside implementation.
5. Generate a unified diff. **Do not apply it.**

**Exit**: all planned changes done, tests written, no syntax errors, diff generated, not applied.
**Failures**: compilation errors → fix, stay in BUILD | pattern violations → review `projectRules.md` | two identical diffs → STALL DETECTED (Section 5).

### DIFF

**In**: BUILD complete | **Out**: Rationale + diff | **Exit**: Ready for QA

```markdown
## Proposed Changes

**Files**:
```

path/file1.ext | 50 +++++++++---------
3 files, 370 insertions(+), 10 deletions(-)

```

**Diff**: [unified diff output]

**Rationale**: Modified `file1.ext` to extend per `systemPatterns.md#Pattern` | Created `file2.ext` because [reason]

**Integration**: `component.ext:45` calls new method | No breaking API changes

**MB References**: `systemPatterns.md#Architecture` | `decisions.md#2025-09-15-strategy`
```

**Exit**: changes presented with rationale, MB references, and new-file justification (if any).
**Failures**: cannot justify a new file → return to BUILD | missing MB refs → add them.

### QA

**In**: DIFF complete | **Out**: Structured test results | **Exit**: Tests pass OR user waiver

Substate: `RUNNING`.

```markdown
## QA Results

**Tests**: ✅ PASS | Total: 145 | Passed: 145 | Failed: 0 | Duration: 23.5s
**Linter**: ✅ PASS | Errors: 0 | Warnings: 2 (non-blocking)
**Coverage**: Overall: 87.3% (+2.1%) | New code: 95.2%
**Build**: ✅ SUCCESS | Duration: 12.3s

**Verdict**: ✅ Ready for APPROVAL | ❌ Return to BUILD
```

**Retry Protocol**: 1st fail → analyze, minimal fix, re-test | 2nd fail → re-analyze approach, check environment | 3rd fail → **STALL DETECTED** → request user input or agent swap.

### APPROVAL (human gate for code)

**In**: QA passed | **Out**: User decision | **Exit**: User approves explicitly

```markdown
## Ready for Approval

**Files modified**: `path/file1.ext` (+50, -10) | `path/file2.ext` (+120, -5)

**Test Results**: ✅ 145 tests passing | ✅ Linter clean | ✅ Coverage 87.3% (+2.1%) | ✅ Build successful

**Review Gates**: ✅ Tests pass | ✅ Security reviewed | ✅ Linter clean

**On approval, the following happen automatically with no further gate**: changes are applied (APPLY) and the Memory Bank is updated — task doc, monthly README, and any new patterns/decisions (DOCS). This message _is_ the notice for both.

**Please review. Reply with**:

- "approved" / "looks good" / "ship it" → APPLY, then DOCS
- "change X" / "fix Y" → back to BUILD
- "revert" → discard all changes
```

**Exit**: user responds with an approval keyword.
**Failures**: ambiguous response → ask for explicit approval | approval requested without gates passing → warn, request waiver.

### APPLY

**In**: user approved | **Out**: Changes applied or rolled back | **Exit**: Applied successfully OR rolled back

```markdown
## Changes Applied

✅ All changes applied to sandbox branch
✅ 3 files modified
✅ Quick verification passed
Ready for DOCS.
```

On failure: report the error, roll back, diagnose, return to BUILD.

### DOCS

**In**: APPLY succeeded (approval already given in APPROVAL) | **Out**: Task docs, MB updates | **Exit**: All docs complete

**No additional user approval is required to enter this state** — approving the code in APPROVAL covers the documentation of that same code. This is the one thing this file used to contradict itself on; it doesn't anymore.

1. Create task doc: `.memory-bank/tasks/YYYY-MM/DDMMDD_task-name.md`.
2. Update monthly README: `.memory-bank/tasks/YYYY-MM/README.md`.
3. Update `projectRules.md` if new patterns emerged.
4. Update `decisions.md` if architectural decisions were made.
5. Update `toc.md` if new MB files were added.

**Task Doc Template**:

```markdown
# YYMMDD_task-name

## Objective

[What was accomplished]

## Outcome

- ✅ Tests: 145 passing (+10 new)
- ✅ Coverage: 87.3% (+2.1%)
- ✅ Build: Successful

## Files Modified

- `file1.ext` - Added [functionality]

## Patterns Applied

- `systemPatterns.md#Pattern`

## Integration Points

- `component.ext:45` via new method

## Architectural Decisions

- Decision: [X] — Rationale: [Y] per `decisions.md#...`
```

**Monthly README Update**:

```markdown
## Tasks Completed

### 2025-10-25: [Task Name]

- Implemented [brief description]
- Files: `file1.ext`, `file2.ext`
- See: [251025_task-name.md](./251025_task-name.md)
```

**Exit**: task doc created, monthly README updated, relevant MB files updated.
**Failures**: template violations → correct format | missing references → add them.

---

## 5. Task Contract & Budgets

### Task Contract Format

```markdown
## Task: [Clear, specific objective]

### Context

- **Repository**: [path or monorepo location]
- **Related Work**: [prior tasks, MB entries]
- **Constraints**: [arch rules, security, performance]

### Expected Outcomes

- **Acceptance Criteria**: [specific, testable criteria]
- **Definition of Done**: [when truly complete]

### Historical Reference

- **Prior Tasks**: [links to `tasks/YYYY-MM/DDMMDD_*.md`]
- **Arch Decisions**: [links to `decisions.md` entries]

### Architectural Constraints

- **Must Follow**: [specific patterns from MB]
- **Must Not**: [anti-patterns, approaches to avoid]
```

### Budget System

- **Cycles**: max BUILD → QA iterations (default 3).
- **Tokens**: max context tokens (agent-specific limits).
- **Minutes**: max wall-clock time (default 30 min for standard tasks).

```json
{
  "task_id": "251025_task",
  "budgets": {
    "cycles": { "allocated": 3, "consumed": 1, "remaining": 2 },
    "tokens": { "allocated": 100000, "consumed": 45000, "remaining": 55000 },
    "minutes": { "allocated": 30, "consumed": 12, "remaining": 18 }
  },
  "status": "within_budget"
}
```

**Budget exceeded**: cycles → STALL DETECTED, user intervention | tokens → minimal context mode or agent swap | minutes → present progress, request extension (user approval only).

### Stall Detection

**Condition**: two consecutive identical diffs.

```markdown
## STALL DETECTED

⚠️ Two identical diffs - unable to progress

**Diagnosis**: Cause: [reason] | Attempted: [what was tried] | Blocker: [what prevents progress]

**Recommendations**:

1. More Context: Load [specific MB files/codebase areas]
2. Alternative: [different technical strategy]
3. Agent Swap: Switch to [specialized agent] for subtask

**Budgets**: Cycles: 3/3 ⚠️ | Tokens: 85K/100K | Minutes: 28/30 ⚠️
```

### Context Management

**Zones**: Core (task contract, relevant MB files, current state — always loaded) | Task (files being modified, direct dependencies — current task only) | Reference (arch patterns, historical decisions — on demand).

**Rotation**: after each state transition, drop Task Context and reload only what the next state needs. Core Context persists. State is already saved to the Memory Bank at every transition (Section 2), so compaction recovery is automatic.

---

## 6. Quality & Documentation

### Absolute Prohibitions

| Prohibition                                    | Consequence        |
| ---------------------------------------------- | ------------------ |
| No fake/simulated/mock data in production code | Rollback + restart |
| No stubbed functions marked complete           | Rollback + restart |
| No ignoring test failures                      | Rollback + restart |
| No applying changes without approval           | Rollback + restart |

Test fixtures and test mocks are fine — this is about production code paths only.

### Security Review (part of APPROVAL)

- **Auth/Authz**: no hardcoded creds | auth checked before sensitive ops | authz at boundaries.
- **Data Handling**: input validation on external data | output encoding prevents injection | sensitive data encrypted where applicable.
- **Error Handling**: no sensitive data in errors | errors logged appropriately.
- **Dependencies**: no known vulnerabilities | versions pinned.

If any item fails, address it before entering APPROVAL.

### Linting & Testing

Zero lint errors before APPROVAL (warnings OK with justification). Unit tests for all new functions, integration tests for workflows, deterministic and independent tests.

### Documentation Approval Model

**Everything in this section happens as a normal consequence of code approval — none of it needs a second, separate approval:**

- Creating `.memory-bank/tasks/*/` task docs
- Updating `.memory-bank/tasks/*/README.md`
- Updating `.memory-bank/decisions.md` and `.memory-bank/projectRules.md`
- Committing the above to version control alongside the code

The only approval gate in this whole workflow is the one in the APPROVAL state (Section 4), and it covers both the code and its documentation.

**When to update which MB file**:

- ✅ Completing any task → task doc + monthly README (always, no exceptions — this is the fix for tasks silently going undocumented)
- ✅ Discovering a new pattern → `systemPatterns.md`, `projectRules.md`
- ✅ Making an architectural decision → `decisions.md`
- ✅ User says "update memory bank" → full refresh across relevant files

**Citation formats**: Code: `path/file.ext:42` | `path/file.ext:42-58` | `path/file.ext:functionName()`. MB: `.memory-bank/systemPatterns.md#Section` | `.memory-bank/decisions.md#2025-10-15-decision`.

### Versioning & Rollback

Do not invent release/milestone IDs — output a proposal for the user to assign one.

**Rollback triggers**: APPLY fails | user requests revert | critical error | security vulnerability found.

**Rollback protocol**: identify last known good state → restore all files → verify → log in `session-log.jsonl` → report reason, reverted changes, current state, and recommendation to the user.

---

## 7. Troubleshooting

### Decision Tree: Agent Stuck

```
Stuck? → Cycles ≥3?
           ↓ YES
         Identical diffs?
           ↓ YES → Load more MB context OR agent swap
           ↓ NO → Analyze failure pattern → adjust approach
```

### Common Issues

| Issue                | Symptoms                                                               | Resolution                                                                                 |
| -------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Loop**             | Same diff repeatedly, QA fails repeatedly, no progress after 3+ cycles | Check budgets → load more MB → clarify requirements → agent swap                           |
| **Context Exceeded** | Token limit approaching, forgetting earlier info                       | State is already persisted (Section 2) → rotate context → break into subtasks → agent swap |
| **CI ≠ Local**       | QA passes, CI fails                                                    | Compare environments → verify dependency versions → check state cleanup                    |
| **Security Fail**    | Checklist incomplete, sensitive data exposed                           | Never bypass → return to BUILD → fix → re-test                                             |

### Recovery Procedures

**Full Reset** (complete breakdown): log current state → discard uncommitted changes → reset to last known good state → start fresh with Standard Discovery.

**Partial Rollback** (recent regression): identify last working state → roll back only the problematic change → keep working changes → re-test → continue from DIFF or BUILD.

**Agent Swap** (capability mismatch): complete current state at a clean boundary → log progress → prepare focused context (task contract, relevant MB files, current work state) → hand off to specialized agent → integrate results back.

---

## Quick Reference

### State Transitions

`PLAN [user approves] → BUILD → DIFF → QA [pass] → APPROVAL [user approves] → APPLY → DOCS`

Iterations on failure: `BUILD ← DIFF ← QA ← APPROVAL`. Major changes: return to `PLAN`.

### Critical Rules

1. No new files without exhaustive reuse analysis.
2. No applying code changes without user approval.
3. No fake/mock data in production.
4. Always cite `file:line` for code, `file.md#Section` for MB.
5. Always work in sandbox (never main).
6. If `.memory-bank/` doesn't exist at session start, create it — unprompted, no approval needed.
7. Every completed task gets a task doc and a monthly README update — no exceptions, no separate approval.

---

**Each session starts fresh. `.memory-bank/` is the only persistent memory — there is no other doc tree and no scratch directory. Maintain it with precision.**

**Mission**: Build software respecting existing architecture, following established patterns, improving incrementally. Reuse over creation. Quality over speed. Approval over assumption.
