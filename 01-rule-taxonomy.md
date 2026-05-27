# forgedTechApps — Rule Taxonomy Proposal

**Document 1 of 3.** Defines the structure all subsequent rules will fit into.
Read this first; the migration plan and revised YAML both depend on it.

---

## The core problem

Your current `.agent-standards.yml` mixes three fundamentally different kinds of
rule into one flat list:

1. **Invariants** that can be mechanically verified (e.g. "every query filters
   by `householdId`", "no hardcoded hex colors").
2. **Process rules** that gate agent behaviour (e.g. "plan before coding",
   "model must be `opus` in planning phase").
3. **Cultural guidelines** that express taste (e.g. "functions do one thing",
   "names communicate intent").

Treating them identically causes three problems:

- The agent can't tell which rules are checkable and which are aspirational, so
  it either over-indexes on culture or under-indexes on invariants.
- Reviewers can't tell which rule violations should block merge versus warn.
- The drift-log → proposal pipeline can't distinguish "we keep breaking this
  invariant" from "we keep ignoring this cultural cue" — they need different
  responses.

A taxonomy fixes this. Each rule gets a tier, and each tier has a defined
enforcement mechanism, failure mode, and promotion path.

---

## Proposed taxonomy: four tiers

### Tier 1 — INVARIANT

A statement that must be true of the codebase or runtime. Mechanically verifiable.
Violation is a bug.

**Properties:**
- Has a check command, hook, or CI job that returns pass/fail.
- Failure blocks merge.
- Should produce a useful error message identifying the violating location.
- Lives in `.agent-standards.yml` under `invariants:`.

**Examples from your existing standards:**
- "Every query filters by `householdId`" (Kurata) — checkable by AST scan or
  grep against repository pattern.
- "No hardcoded hex/spacing/font sizes" — `check_design_consistency` already
  does this.
- "Secrets only via env vars" — `check_secrets` does this.
- "Pre-commit must reject committed secrets" — checkable.
- "`decimal` for money" (TradingBot) — AST-checkable in C#/.NET.

**Examples of current rules that need to be promoted INTO this tier:**
- "Parameterised queries only" (currently prose; needs a SAST rule).
- "Service-role keys never flow to clients" (currently prose; needs a
  build-time check that client bundles don't contain service-role env vars).

---

### Tier 2 — GATE

A point in the workflow where the agent must stop and either get permission,
produce an artifact, or transition state. Enforced by tooling (MCP, hooks, CI),
not by agent discipline.

**Properties:**
- Has a specific trigger event (file change, tool call, phase transition).
- Failure means the workflow halts; the agent cannot proceed.
- Lives in `.agent-standards.yml` under `gates:`.

**Examples from your existing standards:**
- "`.env*`, `**/migrations/**`, `**/Dockerfile`, `**/wrangler.toml`,
  `.github/workflows/**` require explicit approval."
- "Model family must match phase" (already gated by `start_task` /
  `propose_change`).
- "Deploy jobs MUST `needs:` the CI job" (gated by CI workflow validator).
- "No force-push on `main` or `dev`."

**New gates this taxonomy adds:**
- **Definition-of-ready gate.** A task cannot transition from `planning` to
  `execution` until the plan contains: scope statement, list of files
  intended-to-touch, test approach, and definition-of-done.
- **Scope-expansion gate.** During execution, if the agent edits a file not in
  the planned list, it must stop and either explicitly expand scope (with user
  approval) or revert.
- **Mid-execution uncertainty gate.** If the agent encounters something it
  doesn't understand (unknown library, ambiguous requirement, conflicting
  rule), it must surface that uncertainty before continuing — not work around it.

---

### Tier 3 — PRACTICE

A workflow discipline that should be followed but cannot be mechanically
enforced in advance. Compliance is observable after the fact and can be
audited.

**Properties:**
- No automated check, but the agent's behaviour produces evidence (commit
  history, drift-log entries, task records) that can be reviewed.
- Violations don't block merge but accumulate in the drift-log.
- Repeated violations of the same practice are a signal that the rule should
  either be promoted to a Gate (with tooling support) or demoted to Principle
  (because it's actually aspirational).
- Lives in `.agent-standards.yml` under `practices:`.

**Examples from your existing standards:**
- "Plan before coding." (Currently a rule; should be a Practice backed by a
  definition-of-ready Gate.)
- "Break tasks into 3-5 focused chunks." (Observable in `start_task` records.)
- "Find before reading. Grep first." (Observable in tool-use logs.)
- "Don't re-read files within a session." (Observable.)
- "After every two search/read ops, write findings somewhere durable."
  (Observable.)
- "Soft mode by default; sensitive projects bump to hard." (Already configured;
  the practice is following the configured mode.)

**Why this tier exists:**
Some rules are too context-dependent to gate, but their violation is still a
real cost. The drift-log makes them legible. The taxonomy makes promotion or
demotion explicit.

---

### Tier 4 — PRINCIPLE

A statement of values or taste that informs judgement. Not enforceable, not
auditable. Documented as cultural context, not as a rule.

**Properties:**
- Lives in `CLAUDE.md`, not `.agent-standards.yml`.
- Cannot generate a drift-log entry on its own.
- Used to break ties when two enforceable rules conflict or neither covers a
  situation.

**Examples that should be reclassified from rules to principles:**
- "Functions do one thing."
- "Names communicate intent."
- "DRY, SOLID, KISS, YAGNI." (The acronyms; specific applications like
  "three uses = extract" are practices.)
- "Implement exactly what was requested. No 'while I'm here' refactors."
  (This is a principle. The *gate* version is the scope-expansion gate above.)
- "Refactor only after it works." (Principle; the gate version is "no commits
  during a failing-test state.")

**Why this matters:**
By calling these principles rather than rules, you stop the agent from
treating them as checks it failed to perform, and you stop reviewers from
trying to mechanically enforce them. They're context for judgement.

---

## How rules move between tiers

```
PRINCIPLE  ──promotion──>  PRACTICE  ──promotion──>  GATE  ──promotion──>  INVARIANT
   ▲                          ▲                        ▲                       │
   │                          │                        │                       │
   └──────demotion────────────┴────────demotion────────┴───────demotion────────┘
```

- **Principle → Practice**: when the team starts tracking violations of a
  cultural rule in the drift-log because the pattern matters.
- **Practice → Gate**: when violations recur often enough that tooling becomes
  worth building (the cost of the gate is less than the cost of the misses).
- **Gate → Invariant**: when the gate's check can be expressed as a property of
  the codebase rather than a property of the workflow (e.g. "agent must check
  for secrets" → "secret-scanner runs on every commit").
- **Demotion** happens when a higher-tier rule turns out to be wrong or too
  expensive, and is documented honestly rather than quietly dropped.

This is exactly what your existing drift-log → proposal pipeline does, but
now the promotion path is explicit and the destination tier is known.

---

## Where existing rules land

I've gone through your section-2 org-defaults and classified each rule. I'm
confident on most of these but flag uncertainty where it exists.

### Section 2.1 — Model routing

- **GATE**: model family must match phase (existing).
- **GATE**: default phase is `planning`; explicit transition required.
- **PRACTICE**: choosing the right effort level for planning. (Currently
  hardcoded to `medium`; might be context-dependent.)

### Section 2.2 — Software design

- **PRINCIPLE**: DRY, SOLID, KISS, YAGNI (the acronyms).
- **PRACTICE**: "three uses = extract."
- **INVARIANT**: "No commented-out code in commits" — checkable via lint rule.
- **INVARIANT**: "No untracked TODOs" — checkable (TODO must reference an issue
  ID).
- **INVARIANT**: Conventional Commits — already enforced.
- **PRINCIPLE**: "Names communicate intent."
- **PRINCIPLE**: "Functions do one thing."

### Section 2.3 — Workflow discipline

- **GATE**: definition-of-ready before `planning` → `execution`. *(NEW)*
- **PRACTICE**: "Break tasks into 3-5 focused chunks."
- **GATE**: scope-expansion gate during execution. *(NEW)*
- **PRINCIPLE**: "Implement exactly what was requested."
- **PRACTICE**: "Refactor only after it works."
- **PRACTICE**: "Tests non-negotiable; order depends on spec."
- **PRACTICE**: "After every two search/read ops, write findings durably."
- **PRACTICE**: "If you made a mistake the user corrected, propose a rule."

### Section 2.4 — Token/context

- **PRACTICE**: "Find before reading. Grep first."
- **PRACTICE**: "Don't re-read files within a session."
- **PRACTICE**: "Use offset/limit for long files."
- **GATE**: `PreCompact` hook writes findings before compaction. *(NEW)*
- **PRACTICE**: "Prefer `/clear` over `/compact` between unrelated tasks."

### Section 2.5 — UI/component design

- **PRINCIPLE**: "Components small, single-purpose, reusable."
- **INVARIANT**: "View > 200 lines → extract subviews" — checkable.
- **PRINCIPLE**: "Components own their styling."
- **INVARIANT**: "No hardcoded hex/spacing/font sizes" — already
  `check_design_consistency`.
- **PRACTICE**: "Shared component library for cross-feature primitives."
- **PRACTICE**: "Storybook when feasible."

### Section 2.6 — Architecture (security-first)

- **PRINCIPLE**: "Input validation at every boundary."
- **INVARIANT**: "Authorisation at the resource level" — needs an automated
  check; currently prose. *Uncertainty:* I'm not sure how easy this is to check
  mechanically; it depends on your auth pattern. Might be Practice if
  unchecked.
- **INVARIANT**: "External HTTP has explicit timeouts" — AST-checkable.
- **INVARIANT**: "Logging never includes PII/credentials/tokens" — needs a
  log-format check; currently prose. *Uncertainty:* hard to check perfectly;
  could be Gate (pre-commit hook scans diff for log statements containing
  sensitive field names) rather than full invariant.
- **INVARIANT**: "Secrets only via env vars" — `check_secrets` already.
- **INVARIANT**: ".env.example for every deployable service" — checkable.
- **INVARIANT**: "Service-role keys never in clients" — needs build-time check
  (mentioned above as gap).
- **INVARIANT**: "SQL: parameterised queries only" — needs a SAST rule.
- **PRACTICE**: "Migrations forward-only and reversible (or document why)."
- **INVARIANT**: "DB access through repository/DAL" — checkable via import
  rules.
- **INVARIANT**: "HTTP services set security headers" — checkable in CI.
- **INVARIANT**: "CORS allowlist explicit per-origin" — checkable.
- **INVARIANT**: "Rate-limit every public endpoint" — checkable via route
  registry.
- **GATE**: "Auth changes reviewed against OWASP ASVS L1" — currently "mental
  review"; needs to be a Gate that produces an artifact.
- **PRACTICE**: "OWASP Top 10 mental review for auth/input/data changes" —
  same problem.
- **INVARIANT** *(NEW, generalising Kurata)*: "Every multi-tenant query filters
  by tenant ID at the repository layer."

### Section 2.7 — Coverage floors

All **INVARIANT** — already checked in CI.

### Section 2.8 — Review gates

All **GATE** — already enforced.

### Section 2.9 — Branching

All **INVARIANT** or **GATE** — already enforced.

### Section 2.10 — Investigation discipline

- **PRACTICE**: investigation mode (soft/hard).
- **INVARIANT**: `min_read_write_ratio` — checkable in task records.

### Section 2.11 — Vulnerability scanning

All **INVARIANT** — already in CI.

---

## What this gives you

1. **Reviewer clarity.** "Is this a blocker?" becomes "What tier is it?"
   Invariant or Gate violation = blocker. Practice violation = drift-log entry,
   discuss in review. Principle conflict = use judgement.

2. **Agent clarity.** The agent can read its config and know which rules to
   *check itself against* (Invariants/Gates have explicit checks) versus which
   to *be guided by* (Practices/Principles).

3. **Honest metrics.** You called out in section 9 that you have no metrics on
   which rules are load-bearing vs decorative. The taxonomy makes this
   measurable: count drift-log entries per Practice, count CI failures per
   Invariant, count Gate blocks per Gate. Rules with zero events over a quarter
   are candidates for demotion or deletion.

4. **A clean promotion path** that matches what you're already doing
   informally.

---

## What this does NOT solve

I want to be honest about the limits:

- **Model routing is still honour-system at Tier 2 (Gate).** Reclassifying it
  doesn't make it independently verifiable. The taxonomy makes the limitation
  visible but doesn't fix it.

- **Principle vs Practice is a judgement call.** I've classified some rules
  one way that you might classify the other. The taxonomy provides the
  framework; the specific assignments will need debate.

- **Some Invariants in section 2.6 (auth, logging, multi-tenant query) need
  tooling I've assumed but not specified.** Building those checks is real
  work. The taxonomy says they *should* be invariants; making them so is the
  migration plan's job.

- **The four-tier structure adds cognitive overhead.** Two tiers
  (enforceable / not-enforceable) would be simpler. I went with four because
  Gate vs Invariant is a meaningful distinction (workflow vs codebase) and
  Practice vs Principle is too (observable vs not). If after using it you
  find tiers collapsing, that's information — collapse them.

---

## Next document

Document 2 is the migration plan: which rules move where, in what order, and
what tooling needs to be built. It assumes this taxonomy.
