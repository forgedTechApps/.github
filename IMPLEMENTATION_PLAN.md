# forgedTechApps — Framework Refinement Implementation Plan

**Status:** Approved, ready for implementation.
**Owner:** Carlos.
**Created:** 2026-05-26.

This is the consolidated, sequenced plan derived from:
- `FRAMEWORK_PRACTICES.md` — current-state inventory.
- `01-rule-taxonomy.md` — tier taxonomy (Invariant / Gate / Practice / Principle).
- `02-migration-plan.md` — phased migration.
- `03-revised-org-defaults.md` — target YAML structure.
- Review pass + iterative re-sequencing.

It supersedes the phasing in `02-migration-plan.md` — same destination, safer
sequencing, each increment shippable on its own.

---

## Guiding principles

1. **Each increment is revertible.** No increment leaves the framework worse than before.
2. **Each increment produces evidence.** Drift-log, gate firings, or violation counts inform the next.
3. **No gate ships without data justifying it.** Riskiest gates wait for observation, not theory.
4. **Canary before propagation.** New mechanisms prove in one project (eleven11v2 or networkPulse) before going org-wide.
5. **Deferred items have owners on day one.** Listed-without-owner is worse than not listed.
6. **Some discipline lives in humans, not YAML.** Resist the temptation to encode everything.

---

## The 15-week build

| Week  | Increment | Lands |
|-------|-----------|-------|
| 1     | 1  | Taxonomy + Principle extraction + deferred-owner schema |
| 2     | 2  | Definition-of-ready gate on canary |
| 3     | 3  | Scope-expansion gate on canary |
| 4     | 4  | DoR + scope-expansion org-wide |
| 5     | 5  | ASVS artifact gate (auth changes) |
| 6     | 6  | `no_commented_code` / `no_untracked_todos` invariants |
| 7-8   | 7  | Tenant isolation invariant on Kurata |
| 9     | 8  | Tenant isolation generalised (TradingBot etc.) |
| 10-11 | 9  | SessionStart + PreCompact hooks |
| 12-13 | 10 | Security IOUs cashed (parameterised queries, service-role keys, PII logs, HTTP timeouts) |
| 14    | 11 | Metrics + per-rule counters |
| 15+   | 12 | First quarterly review |

Deferred (only ship if data justifies):
- `uncertainty_surfacing` gate
- `bugfix_root_cause` as Gate (starts as Practice)
- Stop hook

---

## Increment 1 — Taxonomy + Principle extraction (week 1)

**Goal:** Make the implicit structure explicit. Zero agent behavioural change.

**Deliverables:**
1. Add `tier: invariant | gate | practice` to every rule in
   `agent-standards/defaults/org-defaults.yml`.
2. Extract Principles from `org-defaults.yml` to `CLAUDE.md` template + propagate to all 11 project CLAUDE.mds:
   - "Functions do one thing"
   - "Names communicate intent"
   - "DRY, SOLID, KISS, YAGNI" (acronyms)
   - "Implement exactly what was requested" (spirit)
   - "Refactor only after it works" (spirit)
   - "Components own their styling" (spirit)
3. Header note in `org-defaults.yml`: *"This file contains only Invariants, Gates, and Practices. Principles live in CLAUDE.md."*
4. Add `deferred:` schema field (`owner`, `target`, `reason`).
5. `get_standards` MCP tool returns rules grouped by tier.
6. `get_standards` + `check_paths` surface `DEFERRED_INVARIANT_NO_CHECK` info finding.
7. Add `.agent-standards-tasks.json` and `.agent-standards-drift.jsonl` to `.gitignore` across all projects.

**Files to touch:**
- `agent-standards/defaults/org-defaults.yml`
- `agent-standards/schema/agent-standards.schema.json` (add `tier`, `deferred` fields)
- `agent-standards/templates/CLAUDE.md.template`
- `mcp-server/src/standards.ts` (tier grouping in `loadStandards()` return)
- `mcp-server/src/check-paths.ts` (deferred-invariant detection)
- `mcp-server/templates/defaults/org-defaults.yml` (synced copy)
- Each project's `CLAUDE.md`
- Each project's `.gitignore`

**Stop here means:** Framework is more honest. No new friction.

**Evidence to gather:** Read `get_standards` across 3-4 projects. Mis-classifications?

---

## Increment 2 — Definition-of-ready gate, canary (week 2)

**Goal:** Land the single highest-leverage new gate.

**Deliverables:**
1. Extend `start_task` MCP tool with required fields: `scope_statement`,
   `files_intended`, `test_approach`, `definition_of_done`, `out_of_scope`.
2. Escape hatch: `size: trivial` skips the gate but logs.
3. Phase transition `planning` → `execution` blocked until fields present.
4. Ship on **eleven11v2** (canary).

**Files to touch:**
- `mcp-server/src/task-tracking.ts`
- `mcp-server/src/server.ts` (tool schema update)
- `eleven11v2/.agent-standards.yml` (enable DoR gate)

**Stop here means:** Canary has DoR. Other 10 projects unchanged.

**Evidence to gather (2 weeks):** Field-quality audit. `size: trivial` frequency. If `out_of_scope` is "nothing" or `files_intended` is `["**"]` on >30% of tasks, refine before propagating.

---

## Increment 3 — Scope-expansion gate, canary (week 3)

**Goal:** Pair with DoR. Same canary.

**Deliverables:**
1. New MCP tool `expand_scope(file_path, reason)` requiring user confirmation.
2. `propose_change` blocks with `TASK_SCOPE_EXPANSION` when target file not in `files_intended`.
3. Ship on **eleven11v2** alongside DoR.

**Files to touch:**
- `mcp-server/src/task-tracking.ts` (scope check in `proposeChange`)
- `mcp-server/src/expand-scope.ts` (new file)
- `mcp-server/src/server.ts` (register new tool)

**Stop here means:** Canary has the full plan-then-stay-in-scope loop.

**Evidence to gather (2 weeks):** `expand_scope` frequency. >1/task average means
`files_intended` is too narrow — consider directory-globs in DoR fields.

---

## Increment 4 — Propagate DoR + scope-expansion (week 4)

**Goal:** Roll proven gates to the remaining 10 projects.

**Deliverables:**
1. Enable DoR + scope_expansion across all 11 projects.
2. Sensitive trio (Kurata, TradingBot, Veda*) get stricter modes if canary data supports.
3. Update CLAUDE.md template to document the gates.

**Files to touch:**
- All project `.agent-standards.yml` files
- `agent-standards/templates/CLAUDE.md.template`

**Stop here means:** Two load-bearing workflow gates live everywhere. Meaningfully better framework.

---

## Increment 5 — Auth-change ASVS artifact gate (week 5)

**Goal:** Replace "mental review" with an artifact.

**Deliverables:**
1. New MCP tool `attach_asvs_review(task_id, controls, verification)`.
2. CI check: PR touching `**/auth/**`, `**/permissions/**`, `**/session/**` fails without attached ASVS artifact.
3. Roll org-wide (no canary — auth changes too infrequent for observation).

**Files to touch:**
- `mcp-server/src/attach-asvs-review.ts` (new)
- `forgedTechApps/.github/.github/workflows/security-scan.yml` (add check)
- `agent-standards/defaults/org-defaults.yml` (add `auth_change_asvs_artifact` gate)

**Stop here means:** Auth changes produce audit trail.

---

## Increment 6 — `no_commented_code` + `no_untracked_todos` (week 6)

**Goal:** Land easy Invariants without breaking 11 codebases.

**Deliverables:**
1. Both checks shipped as `severity: warn`.
2. Cleanup pass per project (one PR each): delete commented code, link TODOs.
3. After cleanup, promote both to `severity: error`.

**Files to touch:**
- `agent-standards/scripts/check-no-commented-code.sh` (new)
- `agent-standards/scripts/check-todos-tracked.sh` (new)
- `agent-standards/defaults/org-defaults.yml` (add invariants)
- All project repos (cleanup PRs)

**Stop here means:** Two more invariants. Codebase hygiene improved.

---

## Increment 7 — Multi-tenant invariant on Kurata (weeks 7-8)

**Goal:** Spike the highest-value Invariant on the project that needs it most.

**Deliverables:**
1. Build `check_tenant_isolation` for Drizzle/TypeScript on Kurata:
   - Configure: `tenant_id_field: "householdId"`, `data_layer_paths: ["packages/api/src/db/queries/**"]`.
   - AST scan + bypass-comment support (`// tenant-isolation: bypass <reason>`).
2. Wire into Kurata CI. Verify no false positives on existing code.
3. Promote `multi_tenant_query_isolation` from `deferred:` to enforced in Kurata.
4. Document as reference implementation for other projects.

**Files to touch:**
- `mcp-server/src/check-tenant-isolation.ts` (new)
- `kurata/.agent-standards.yml`
- `kurata/.github/workflows/ci.yml`

**Stop here means:** Kurata's highest-value invariant enforced mechanically.

---

## Increment 8 — Multi-tenant generalisation (week 9)

**Goal:** Roll Kurata pattern to TradingBot and any other multi-tenant project.

**Deliverables:**
1. Adapt `check_tenant_isolation` for C#/.NET on TradingBot (`accountId`).
2. Configure per-project tenant fields where applicable.
3. Promote from deferred to enforced for each adopting project.

**Files to touch:**
- `mcp-server/src/check-tenant-isolation.ts` (C# AST support)
- `MS .NET/TradingBot/.agent-standards.yml`
- Any other multi-tenant projects identified

**Stop here means:** Multi-tenant isolation enforced where it matters.

---

## Increment 9 — SessionStart + PreCompact hooks (weeks 10-11)

**Goal:** Move enforcement from honour-system to event-driven.

**Deliverables:**
1. `SessionStart` hook: surface current phase + model family. Warn on mismatch.
   - Canary on eleven11v2, 1 week, propagate if stable.
2. `PreCompact` hook: dump task state + open questions + recent findings to `.agent-state/pre-compact-{timestamp}.md`.
   - Canary on eleven11v2, 1 week, propagate if stable.

**Files to touch:**
- `agent-standards/hooks/session-start.sh` (new)
- `agent-standards/hooks/pre-compact.sh` (new)
- `eleven11v2/.claude/settings.json` (register hooks first)
- All projects' `.claude/settings.json` (after canary)

**Stop here means:** Two of four planned hooks live. Model-routing honour-system partially mitigated.

**Note:** Verify Claude Code hooks API before committing to specific hook names — Doc 2 explicitly flagged uncertainty here.

---

## Increment 10 — Deferred-invariant tooling sprint (weeks 12-13)

**Goal:** Cash the security IOUs. The Phase 0 `deferred:` items must not become permanent.

**Deliverables, in this order by leverage:**

### 10.1 `service_role_keys_not_in_client`
- Bundle scanner: inspect compiled client output for service-role key patterns.
- Compare against `.env.example` patterns; fail build on match.
- Files: `agent-standards/scripts/check-client-bundle-secrets.sh`, CI wiring.

### 10.2 `parameterised_queries_only`
- **Try Semgrep first.** Off-the-shelf rules likely cover 80% of cases.
- TypeScript: Semgrep `javascript.lang.security.audit.sqli`.
- Python: Bandit `B608`.
- C# (TradingBot): Semgrep rules + custom for any gaps.
- Fall back to custom analyser only where off-the-shelf is wrong.

### 10.3 `no_pii_in_logs`
- Pre-commit hook scanning log statements for sensitive field names.
- Configurable sensitive-field list (`email`, `password`, `token`, `ssn`, etc.).
- Ship as `warn`, promote to `error` after one cycle of cleanup.

### 10.4 `external_http_has_timeout`
- AST check for `fetch()` / `axios()` / `http.get()` without timeout.
- Ship last — lower security stakes than 10.1–10.3.

**Stop here means:** Three real security gaps from framework section 9 closed. No more "listed but unenforced" security invariants.

**Time-box:** if any single check exceeds 1 week, descope (ship the regex/Semgrep 80%, log gaps) or escalate (use commercial SAST).

---

## Increment 11 — Metrics + per-rule counters (week 14)

**Goal:** Make rule effectiveness measurable.

**Deliverables:**
1. Add `rule_id` field to every drift-log entry.
2. New MCP tool `get_rule_metrics(rule_id?, since?)` returning counts per rule.
3. CI emits drift entries on Invariant violations with rule IDs.
4. Document quarterly review rhythm in `agent-standards/REVIEW.md`.

**Files to touch:**
- `mcp-server/src/drift-log.ts` (add `rule_id`)
- `mcp-server/src/get-rule-metrics.ts` (new)
- `mcp-server/src/server.ts` (register tool)
- `agent-standards/REVIEW.md` (new)

**Stop here means:** Data exists to drive every future framework change.

---

## Increment 12 — First quarterly review (week 15+)

**Goal:** Use the metrics. Promote, demote, delete based on evidence.

**Process:**
1. Run `get_rule_metrics` for the past quarter.
2. Categorise:
   - Zero events → demote or delete.
   - High-violation Practices → consider promotion to Gate (tooling investment now justified).
   - Never-blocking Gates → leave or formalise as Invariants.
3. Log decisions in `.agent-standards-decisions.md`.
4. Schedule next review (90 days out).

**Automate:** scheduled GitHub Action runs `get_rule_metrics` and opens a quarterly-review issue. Issue is the agenda — skipping the meeting doesn't skip the artifact.

**Stop here means:** Framework is self-tuning based on real usage.

---

## Beyond week 15 — Mitigations for the unsolved gaps

The 15-week build closes most of the gap between claimed and enforced. These 5
extra weeks address the limits that remain.

### Week 16 — Model-routing observed-vs-declared

**Outcome (2026-05-27):** Investigated. `forge-pipe-mcp` is a project in the
org, not a proxy intercepting Claude Code → Anthropic API traffic. There's
no in-path component this framework controls. Cost-side detection would
require Anthropic billing API access, also outside scope.

**Accepted limitation:** model routing remains honour-system at this site.
Mitigations already in place:
  - `start_task` blocks when declared `current_model` doesn't match the
    phase's expected family (Increment 2).
  - `propose_change` blocks for execution-phase model mismatch.
  - SessionStart hook surfaces the expected routing at session start
    (Increment 9).

These don't catch a lying agent, but they catch a forgetful one — which is
the realistic failure mode. The honest documentation of the gap (in
FRAMEWORK_PRACTICES.md §9 and elsewhere) is the substantive deliverable.

---

#### Original W16 spec (kept for posterity)


**Only solve for the honour-system problem.** Wire forge-pipe to write the
observed model to a session log the MCP server reads. `start_task` cross-checks
declared vs observed, fails on mismatch.

If forge-pipe isn't in the path: ship the cost-side check instead (monthly
report broken down by project, comparing actual Opus/Sonnet ratio to configured).

### Weeks 17-18 — Cross-tenant integration test as Invariant

Kurata already has the pattern. Generalise: every project with multi-tenant
data must include a parameterised integration test that hits every
authenticated route with a foreign tenant ID and asserts 403.

This is the only general check that catches OWASP A01 (broken access control)
mechanically. The test IS the check.

### Week 19 — Reversibility field in definition-of-ready

Add `reversibility: easy | moderate | hard` to DoR fields. Hard-to-reverse
changes (migrations, deploys, data deletions) trigger an additional
confirmation step. Forces explicit thought about cost-of-being-wrong.

### Week 20 — Automate quarterly review issue

Scheduled GitHub Action posts the review report as an issue. Removes "did
anyone remember to run the review?" from the failure modes.

### Quarter 2 of running new framework — First adversarial test session

Take an agent into a project, try to ship a known-bad PR. SQL injection, leaked
secret, cross-tenant query. See what catches it. Gaps found = next rules.

### Annual — External framework review

Schedule 12 months out so it doesn't slip. Share framework with a security
consultant or peer at a company doing similar work. They see things you can't.

---

## What this delivers (recap)

After week 15:
- ~3 real security gaps closed (parameterised queries, service-role keys, multi-tenant isolation).
- 2 load-bearing workflow gates org-wide (DoR, scope-expansion).
- Self-tuning ruleset with measurable effectiveness.
- Audit trail for auth changes.
- Hooked enforcement of model routing, context hygiene, compaction.
- Data to drive every future change.

After week 20:
- Model-routing honour-system mitigated.
- Cross-tenant integration test as Invariant (OWASP A01 mechanical check).
- Reversibility surfaced at planning time.
- Quarterly review can't be skipped silently.

What this will NOT solve (and accepted):
- Bad judgement that passes all gates (mitigated only by adversarial review).
- Unanimous mistakes (mitigated only by external review).
- Cultural rules ignored under pressure (mitigated by measurable proxies, not solved).

---

## Implementation kickoff checklist

Before week 1 begins:

- [ ] Confirm canary project: eleven11v2 or networkPulse.
- [ ] Confirm `forge-pipe` model-observation feasibility (informs week 16).
- [ ] Identify owner for each deferred-invariant (week 1 schema change requires this).
- [ ] Decide: monthly or sprint-aligned check-ins on increment progress.
- [ ] Block calendar for week 15+ quarterly review (90 days from week 14).
- [ ] Confirm: ship one increment at a time, do not parallelise.

Once these are confirmed, increment 1 can begin.

---

## Owner

Carlos. Implementation in `~/Development/forgedtech/`.

## Reference documents

- `FRAMEWORK_PRACTICES.md` — current-state inventory.
- `01-rule-taxonomy.md` — tier definitions and rationale.
- `02-migration-plan.md` — original phasing (superseded by this file).
- `03-revised-org-defaults.md` — target YAML structure.

## Change log

- 2026-05-26: Initial plan. Approved for implementation.
