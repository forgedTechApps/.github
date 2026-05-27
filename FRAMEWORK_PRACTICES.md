# forgedTechApps — Best Practices & Skills In Use

A consolidated reference of the standards, enforcement mechanisms, and workflow
disciplines currently active across the forgedTechApps org. Hand this to Claude
(or any reviewer) and ask: *"what's missing, what's weak, what's redundant?"*

Last updated: 2026-05-26.

---

## 1. The framework, in one paragraph

Every project has a `.agent-standards.yml` that `extends: forgedtech/org-defaults`
and adds project-specific rules. An MCP server (`agent-standards`) loads this,
deep-merges org + project, and exposes 13 tools that Claude must call to read
standards, check repo state, propose changes, and track tasks. CLAUDE.md is the
human/agent-readable companion that mirrors the workflow contract. Rules that
catch real mistakes get promoted from `.agent-standards-proposals.md` into
durable config.

---

## 2. Org-wide defaults (`forgedtech/org-defaults.yml`)

### 2.1 Model routing (two-phase)

- **Planning phase** → `opus` at `effort: medium` (claude-opus-4-7)
- **Execution phase** → `sonnet` (claude-sonnet-4-6)
- MCP `start_task` and `propose_change` block writes when the declared
  `current_model` doesn't match the phase's expected family.
- Default phase is `planning`. Agent must explicitly transition to `execution`.

### 2.2 Software design (universal)

- DRY (three uses = extract), SOLID (SRP + dependency inversion at boundaries),
  KISS / YAGNI (no speculative abstraction).
- No commented-out code in commits. No untracked TODOs.
- Conventional Commits enforced.
- Names communicate intent. Functions do one thing.

### 2.3 Workflow discipline

- Plan before coding. State hypothesis + intended changes + test approach
  BEFORE writing code.
- Break tasks into 3–5 focused chunks. >5 file changes or >2 unrelated areas → split.
- Scope discipline: implement exactly what was requested. No "while I'm here" refactors.
- Refactor only after it works.
- Tests are non-negotiable; order depends on spec (known behaviour → test-first,
  unknown → build-then-test).
- After every two search/read ops, write findings somewhere durable.
- If the agent made a mistake the user had to correct, propose a one-line
  addition to CLAUDE.md or `.agent-standards.yml`. User accepts or declines —
  never auto-edit.

### 2.4 Token / context discipline

- Find before reading. Grep first; don't Read whole files.
- Don't re-read files within a session — prior result is still in context.
- Long file or huge log? Use offset/limit, or filter through grep/head/tail.
- **Between unrelated tasks, prefer `/clear` over patching forward.**
- **Stale context hurting accuracy? Prefer `/clear` over `/compact`.** Use
  `/compact` only when continuing the SAME task with significant history.

### 2.5 UI / component-driven design (gated by `ci.kind ∈ {mobile, web}`)

- Components small, single-purpose, reusable. View > 200 lines → extract subviews.
- Components own their styling. No reaching into parents/siblings. Communicate
  via props/inputs and events/callbacks.
- Design tokens from a single source. No hardcoded hex/spacing/font sizes.
- Shared component library is home for cross-feature primitives.
- Storybook / catalog page when feasible.

### 2.6 Architecture (security-first)

- Input validation at every boundary. Trust internally.
- Authorisation at the resource level, not just the route.
- External HTTP: explicit timeouts + documented failure mode (retry / circuit-break / fallback).
- Logging never includes PII / credentials / tokens / full request bodies.
- Secrets only via env vars or secret store. Never in committed files.
  Pre-commit / CI must reject.
- `.env.example` for every deployable service.
- Service-role keys never flow to clients.
- SQL: parameterised queries only.
- Migrations forward-only and reversible (or document why not).
- DB access through a repository / DAL — UI / routes never touch driver directly.
- HTTP services set security headers: HSTS, CSP, X-Content-Type-Options,
  X-Frame-Options (or frame-ancestors), Referrer-Policy.
- CORS allowlist explicit per-origin. No `*` for credentialed endpoints.
- Rate-limit every public endpoint. Surface 429 with Retry-After.
- Auth changes reviewed against OWASP ASVS Level 1.
- Auth/input/data/templating changes trigger OWASP Top 10 mental review.

### 2.7 Coverage floors

- `unit_min: 60`, `integration_min: 40`. Projects can raise (Kurata: 70 / 50).
- Regression tests required for `**/auth/**` and `**/migrations/**`.

### 2.8 Review gates

- Explicit approval required for `**/.env*`, `**/migrations/**`, `**/Dockerfile`,
  `**/wrangler.toml`, `.github/workflows/**`.
- No force-push on `main` or `dev`.

### 2.9 Branching

- Required branches: `main`, `dev`.
- Default branch: `main`.
- Feature branch pattern: `^(feat|fix|chore|docs|test|ci|refactor|perf|style)/[a-z0-9._-]+$`.

### 2.10 Investigation discipline

- Soft mode by default. Sensitive projects bump to `hard` (Kurata, TradingBot,
  Veda).
- `min_read_write_ratio: 3` (default). Hard mode raises to 4+.

### 2.11 Vulnerability scanning (CI-enforced)

- CodeQL SAST (security-extended + security-and-quality).
- OWASP Dependency-Check (CVSS ≥ 7 fails the build).
- OSV Scanner against language lockfiles.
- Optional: OWASP ZAP baseline against deployed HTTP services.
- Suppressions require inline justification + tracking issue.

---

## 3. MCP enforcement tools (`agent-standards` server)

13 tools. Schemas in `agent-standards/schema/`. Source in `mcp-server/src/`.

| Tool                          | What it does                                                                 |
|-------------------------------|------------------------------------------------------------------------------|
| `get_standards`               | Returns merged org+project standards. UI rules folded only if mobile/web.    |
| `check_paths`                 | Verifies sensitive paths exist, feature_path_pattern resolvable.             |
| `check_ci_setup`              | Validates `.github/workflows/ci.yml` against standards. Honors `ci.bespoke`. |
| `check_branching`             | Verifies required branches exist, no force-push protection.                  |
| `check_secrets`               | Scans for forge-pipe tokens, AWS/GitHub/Slack/Stripe/OpenAI/Anthropic/Supabase keys, JWTs, PEM keys. Allowlist + entropy + inline opt-out. |
| `check_design_consistency`    | Lints off-token hex colors, Tailwind arbitrary values, off-scale spacing, inline JSX styles. Mobile/web only. |
| `run_local_checks`            | Runs project's declared lint/typecheck/test commands.                        |
| `propose_claude_md_rule`      | Appends a rule proposal to `.agent-standards-proposals.md` (NOT gitignored). |
| `get_drift_log`               | Reads `.agent-standards-drift.jsonl` (rolling 500 entries).                  |
| `start_task`                  | Opens a tracked task. Blocks if model family ≠ phase's expected family.      |
| `propose_change`              | Records intended edits. Blocks on `TASK_PLANNING_PHASE_WRITE` and `TASK_WRONG_MODEL_FOR_EXECUTION`. |
| `commit_checkpoint`           | Records progress against an open task.                                       |
| `init_repo`                   | Scaffolds `.agent-standards.yml` + canonical CI workflow.                    |

### Server architecture notes

- Only declares `{ capabilities: { tools: {} } }` — NOT resources/prompts.
  Empty capability blocks caused MCP `/mcp` freezes.
- Schema validation via `Ajv2020` from `ajv/dist/2020.js`.
- Drift log: JSONL append-only, rolling cap of 500 entries.
- Task state: `.agent-standards-tasks.json` (gitignored).

---

## 4. Per-project standards (highlights)

Wired projects: **forgedtech, forgev2, forge-ios, eleven11v2, networkPulse,
Viyr, veda, veda-ios, veda-proxy, kurata, TradingBot**.

### Investigation mode = `hard` for sensitive repos:

- **Kurata** — household data, children's data, receipts.
- **TradingBot** — money. Live deploy requires explicit user run of deploy script.
- **Veda** — health-adjacent on-device AI; no auto-deploy to Cloudflare or App Store.

### Examples of high-value project-specific rules

- **Kurata**: every query filters by `householdId`. FairShare counts cleaning,
  cooking, shopping, parenting equally. Briefing = max 3 items, canonical
  priority order. RLS on by default. Receipts encrypted at rest, signed URLs
  only. Bands never auto-advance.
- **TradingBot**: Domain depends on nothing else. OrderService is the only place
  orders are placed. Every entry order has a protective stop. `decimal` for
  money — `double` for prices is a bug.
- **Veda**: 4 Claude call sites only. Domain stays pure. Vitruvian gating.
  Paywall logic centralised.

### Project-level coverage uplifts

- **Kurata** uses `per_surface` thresholds: `packages/shared` 95/90/95, security
  lib 90/80/80, services 70/70/70, web actions 80.
- Cross-household isolation is a single parameterised integration test that
  every authenticated route gets added to.

### Process rules promoted from drift-log into standards

(Examples from Kurata, after real incidents:)
- "Before reporting 'CI passing', verify the head commit's check-suite contains
  ≥1 passing check-run. `mergeable: CLEAN` with `total_count: 0` means CI never
  started."
- "When a subagent times out, surface the timeout to the user before silently
  switching execution mode."
- "Implementation plans listing routes must grep-verify each path against the
  route registrar before the plan is finalised."

---

## 5. Context management

### `.claudeignore` (separate from `.gitignore`)

For files that ARE committed to git but are noise for an agent. Example
(Viyr):

- Generated Dart: `*.g.dart`, `*.freezed.dart`, `*.config.dart`, `*.gr.dart`
- Vendored builds: `ios/Pods/`, `android/.gradle/`, `android/build/`
- Lockfiles: `pubspec.lock`, `ios/Podfile.lock`, `package-lock.json`
- Coverage / `.dart_tool/`
- Binary assets: `*.png`, `*.jpg`, `*.webp`, `*.ttf`, etc.

### Session hygiene

- `/clear` between unrelated tasks (in standards).
- `/compact` only for same-task long history (in standards).
- Proactive compaction at high context, before tool use.

---

## 6. CI / CD architecture

- Reusable workflows live in `forgedTechApps/.github/.github/workflows/`:
  `quality-gate-{swift,flutter,node,python,dotnet}.yml`, `security-scan.yml`,
  `deploy-railway.yml`, `deploy-vercel.yml`.
- Per-project `ci.yml` calls these via `uses:`.
- Bespoke CI is opt-in via `ci.bespoke: true` + `ci.bespoke_reason`. Kurata is
  the canonical example (pnpm monorepo can't use npm-shaped reusable).
- Top-level permissions block must include `issues: write` (security-scan notify
  job needs it). Inside reusable workflow `jobs.*.permissions:`, `actions:read`
  and `issues:write` both cause `startup_failure` on the free plan — never set
  them there.
- Deploy jobs MUST `needs:` the CI job.
- `paths-ignore:` used aggressively to conserve free-tier minutes.

---

## 7. Workflow contract (CLAUDE.md template)

Every project's CLAUDE.md includes:

- Model routing table (logical → concrete IDs).
- Reference to `.agent-standards.yml` as source of truth.
- Stack summary, key invariants, sensitive paths.
- Pre-PR self-review checklist.
- Explicit list of what the agent CANNOT do without confirmation
  (deploy, force-push, edit migrations, edit `.env*`, change auth).

---

## 8. Drift-log → proposal → standard pipeline

1. Agent or user spots a recurring mistake or weak point.
2. Agent calls `propose_claude_md_rule` → appends to
   `.agent-standards-proposals.md` (committed, visible).
3. User reviews. If they accept, the rule moves into
   `.agent-standards.yml` (project) or `org-defaults.yml` (org-wide).
4. `get_drift_log` shows what was caught recently — informs next round of
   promotions.

This is how Kurata's three process rules above became durable config.

---

## 9. Known weaknesses / open follow-ups

Honest list, for the reviewer:

- **Model routing enforcement is honour-system.** MCP can't independently
  detect the calling model; it trusts `current_model` declared by the agent.
- **Aspirational vs concrete rules aren't tagged.** Some rules ("functions do
  one thing") are cultural; some ("every query filters by householdId") are
  checkable invariants. No formal tier system yet — rejected as too complex,
  but the tension remains.
- **Viyr's 18 hardcoded-color findings** from first `check_design_consistency`
  run are untriaged.
- **`.agent-standards-drift.jsonl` and `.agent-standards-tasks.json`** aren't
  in `.gitignore` for every project yet.
- **`start_task` / `propose_change`** haven't been stress-tested in a real
  multi-day task.
- **`voice.md` placeholders** for some projects still need concrete "sounds
  like / doesn't sound like" examples.
- **No automated promotion** from drift-log to standards — human gate is
  intentional but could miss patterns.
- **No metrics** on how often each rule is hit, so we can't tell which rules
  are load-bearing vs decorative.

---

## 10. What to ask Claude

Hand this doc to a fresh Claude session and ask one of:

- "Where are the gaps in security coverage?"
- "Which rules are likely to be ignored because they're too vague?"
- "What's missing from the workflow contract that would prevent the most
  common agent mistakes?"
- "Which project should adopt rules from another project?"
- "What's the cheapest next improvement that would catch the most mistakes?"

The framework's whole point is to make these questions answerable from one
document.
