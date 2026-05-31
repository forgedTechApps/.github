# forgedTechApps/.github — the standards repo itself

This repo is the **source of truth** for org-wide CI/CD, agent standards, and the
agent-standards MCP server. It holds the templates every other project consumes — so it
must hold itself to the standards it ships. This CLAUDE.md applies the framework to the
framework.

## Workflow conventions

How to run a session follows the org-wide template — which lives **in this repo**:
[`agent-standards/templates/CLAUDE.md.template`](agent-standards/templates/CLAUDE.md.template).
We eat our own dog food: plan-before-code, three-tier model routing (Opus plan / Sonnet
execute / Haiku lightweight output), tests ship with the change, stranger review +
production-readiness for substantial/deploy-bound changes, GCOE for agent instructions.

**Output discipline (strict).** During investigation and execution, be terse — let tool
calls carry the work, with at most one short framing sentence per batch. No play-by-play
("Let me check…"), no recapping tool output that's already visible, no narrating transient
tool/harness glitches (silently retry). Reserve fuller prose for genuine decisions/tradeoffs
and the final result. Pair this with **verify-then-act, one step at a time**: don't batch
commit→push→merge before confirming each step from real output — premature batching produces
both wrong claims and noise. A `UserPromptSubmit` hook re-asserts this each turn.

## Principles

See [`agent-standards/templates/PRINCIPLES.md`](agent-standards/templates/PRINCIPLES.md)
(functions do one thing, scope discipline, vertical slices, LLM observability, …). Note the
"AI / LLM call sites" section applies to the MCP server's own provider usage if any is added.

## grill-me overrides (the standards repo)

The canonical grill-me skill lives here (`agent-standards/skills/grill-me/`). It applies to
work in this repo too. In addition to the universal branches, the interview MUST ask:

- **"Does this change a check's severity or tier?"** Demoting/promoting a check (invariant ↔
  practice, error ↔ warn ↔ info) changes behaviour in *every* consuming repo. Confirm the
  evidence (false-positive rate, real-world signal) — this session demoted four checks for
  exactly this reason; don't reverse without data.
- **"Does this touch `.github/workflows/`?"** Those ship to every product repo via the `@v1`
  tag. A bad change breaks everyone's CI at once. Confirm the blast radius and the rollback.
- **"Does this touch the MCP server's tool surface or schema?"** Adding/changing a tool or its
  JSON Schema changes the API every project's agent calls. Keep the Zod parser, the advertised
  JSON Schema, and `run_local_checks`'s `include` enum in sync (they have drifted before).
- **"Does this add a mechanical check?"** Default to NO. The session's hard-won lesson: a check
  that fires on judgment (needs an AST or domain knowledge) produces noise and trains people to
  ignore findings. Judgment-heavy concerns go to grill-me branches, principles, or guidelines —
  not checks. A new check must be binary, low-false-positive, and load-bearing.
- **"Does this require a `v1` tag bump?"** If so, it lands in every product repo immediately —
  coordinate before pushing.

Trivial bypass (`size: 'trivial'`) is **not available** for changes to `.github/workflows/**`,
`mcp-server/src/**`, `agent-standards/schema/**`, or any check severity/tier — each needs the
full interview (these are the `sensitive_paths` in `.agent-standards.yml`).

## Layout

```
.github/workflows/    Reusable workflows shipped org-wide via @v1 (quality-gate-*, deploy-*, security-scan)
mcp-server/           The agent-standards MCP server (@forgedtech/agent-standards-mcp). 14 checks + workflow tools.
  src/                Check implementations + server.ts (tool registration) + standards.ts (schema)
  src/__tests__/      Fixture-based test harness (one dir per case + expected.json)
  templates/defaults/ org-defaults.yml — the org-wide rules every .agent-standards.yml extends
agent-standards/
  skills/grill-me/    Canonical grill-me skill (symlinked into every project)
  templates/          CLAUDE.md.template, PRINCIPLES.md, PRODUCTION_READINESS.md, UI_UX_GUIDELINES.md, SETUP.md
  schema/             .agent-standards.yml JSON Schema
  hooks/              session-start / pre-compact hooks
```

## Stack & commands

- **pnpm** workspace; the MCP server is the only package.
- Lint: `pnpm --filter ./mcp-server lint` (tsc --noEmit). Test: `pnpm --filter ./mcp-server test`
  (fixture harness, 41+ cases). Build: `pnpm --filter ./mcp-server build`.
- The test suite doubles as the org-defaults validator: it parses `org-defaults.yml` via
  `loadStandards`, so a malformed rule fails the suite. Run it after any standards edit.

## Architecture rules (load-bearing — from `.agent-standards.yml`)

- Reusable workflows MUST avoid `actions:read` and `issues:write` in **job-level** permissions
  (GitHub free-plan restriction — both cause `startup_failure`). Caller workflows put
  `issues: write` in their **top-level** block. (See memory: GitHub Actions free-plan.)
- No dynamic `runs-on` expressions in reusable workflows — static labels + `if:` conditions.
- No `${{ }}` boolean expressions in `with:` blocks for `workflow_call` boolean inputs — literal
  `true`/`false`.
- Bumping `v1` affects every product repo immediately — coordinate before pushing.
- Keep the three MCP surfaces in sync: Zod parser, advertised JSON Schema, and any `include`
  enums. They have drifted before (`run_local_checks`).

## Check taxonomy (the philosophy this session settled)

- **invariant** (error/warn, has `check_command`): mechanically verifiable, low false-positive,
  load-bearing. e.g. `check_secrets`, `check_ci`, `check_env_example`, CORS-wildcard.
- **practice**: observable in records, not pre-checked. Most workflow/discipline rules.
- **gate**: workflow checkpoint that halts until satisfied (DoR, scope-expansion, ASVS).
- **principle**: genuinely unenforceable judgment — lives in PRINCIPLES.md / guidelines, never a
  check. Whole-codebase *semantic* checks (tenant-isolation, sql-injection, log-pii, http-headers)
  were demoted to `info` hints this session for firing on noise; don't re-promote without data.

## Merge gate

This repo has no branch protection — **never `gh pr merge --auto`** (a committed PreToolUse hook
blocks it). Poll the head commit's check-runs (the `MCP CI` workflow runs on `mcp-server/**`
changes) until green, then merge manually. Docs-only PRs that don't touch `mcp-server/` won't
trigger CI — that's expected; merge once mergeable.

## Self-check

Run the framework against itself before merging a standards change:
`run_local_checks` (or the relevant `check_*`) against this repo, plus `pnpm --filter ./mcp-server
test`. The framework should pass its own bar.
