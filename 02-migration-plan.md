# forgedTechApps — Migration Plan

**Document 2 of 3.** Assumes the taxonomy from Document 1. Specifies what
changes, in what order, with rationale.

---

## Guiding principles for this plan

Three things I want to be honest about up front:

1. **Don't break what works.** Your framework is in production across 11
   projects. The plan does not rip and replace; it restructures and adds.

2. **Sequence matters.** Some changes depend on others. The order below is
   chosen so that each phase produces value on its own — you can stop after
   any phase and have a better framework than you started with.

3. **Some of this is speculative.** Where I'm guessing about your tooling's
   internals or what's easy versus hard to implement, I say so. You'll need to
   validate against the actual codebase.

---

## Phase 0 — Pre-work (1-2 days)

Before any rule changes, make the taxonomy legible in the existing system.

### 0.1 Add a `tier` field to every rule in `org-defaults.yml`

Each rule entry gets `tier: invariant | gate | practice | principle`. No
behavioural change yet — this is purely metadata so the MCP server can later
report on it.

### 0.2 Update `get_standards` MCP tool to return rules grouped by tier

The agent now sees rules organised by enforcement type. This alone changes
behaviour: rules tagged `principle` get treated as context, not checklist items.

### 0.3 Add a "tier reclassification" entry type to the drift-log schema

So when a rule is promoted or demoted, the log captures it. This is the audit
trail for taxonomy decisions.

### Why this first

Cheap, reversible, doesn't change agent behaviour beyond making categories
explicit. Gives you a working baseline before any structural change.

**Risk:** None I can see, beyond the time to edit YAML. **Confidence:** High.

---

## Phase 1 — Fill the gaps you flagged (3-5 days)

These are the rules that don't exist yet but should. Each is a Gate or
Invariant — meaning each needs tooling, not just prose.

### 1.1 Definition-of-ready Gate

**Rule (Gate):** A task cannot transition from `planning` to `execution`
until its plan record contains:
- `scope_statement`: one-sentence description of what changes.
- `files_intended`: explicit list of paths the agent expects to touch.
- `test_approach`: how the change will be verified.
- `definition_of_done`: observable outcome (e.g. "test X passes", "endpoint
  Y returns 200 with payload Z").
- `out_of_scope`: explicit list of things the agent will NOT do during this
  task. This is the antidote to "while I'm here" refactors.

**Tooling change:** `start_task` adds these required fields. Phase transition
is blocked until they're filled. The existing `TASK_PLANNING_PHASE_WRITE` error
code is the precedent.

**Why this matters:** Half of scope creep happens because "done" was never
defined. The other half happens because "out of scope" was never explicit.
This addresses both.

**Risk:** Annoyance. Some tasks are too small to warrant this overhead. Add an
escape hatch: tasks declared `size: trivial` skip the gate but get logged.
**Confidence:** High that this catches real mistakes. Moderate that the
specific fields above are the right ones — they're a starting set, refine
based on what gets skipped or filled with junk.

### 1.2 Scope-expansion Gate

**Rule (Gate):** During `execution` phase, if `propose_change` is called for a
file not in `files_intended`, the call is blocked with error
`TASK_SCOPE_EXPANSION`. The agent must either:
- Call a new tool `expand_scope(file_path, reason)` which logs the expansion
  and requires user confirmation, OR
- Revert and complete the original scope first.

**Tooling change:** Add `expand_scope` MCP tool. Modify `propose_change` to
check against `files_intended`.

**Why this matters:** This is the single highest-leverage gate I can identify.
It catches the most common class of agent mistake (drift) at the moment it
happens, not in code review.

**Risk:** Friction on tasks that genuinely need to touch unanticipated files.
The `expand_scope` escape hatch handles this; the logging makes the frequency
visible. If `expand_scope` is called more often than not, the
definition-of-ready process needs improvement, not the gate.
**Confidence:** High.

### 1.3 Mid-execution uncertainty surface

**Rule (Practice, backed by tooling):** When the agent encounters something
outside its understanding (unknown library, ambiguous spec, conflicting rules,
unexpected file state), it must call a new MCP tool `surface_uncertainty`
which logs the situation and, unless the user has set
`allow_uncertain_progress: true` for this project, blocks further
`propose_change` calls until the user responds.

**Tooling change:** New `surface_uncertainty(category, description,
proposed_options)` tool. Categories at minimum: `ambiguous_spec`,
`unknown_dependency`, `conflicting_rule`, `unexpected_state`.

**Why this matters:** Per your `userPreferences`, surfacing uncertainty is
something the agent should do explicitly. This makes it a workflow step, not a
habit. It also creates a dataset: what does the agent actually find
uncertain?

**Risk:** Agent over-reports trivial uncertainty and becomes annoying. Mitigate
by setting `allow_uncertain_progress: true` as the default; the tool still
logs but doesn't block. Sensitive projects (Kurata, TradingBot, Veda) set it
to `false`.
**Confidence:** Moderate. I think this is valuable but it's the most novel
piece and might need iteration.

### 1.4 Multi-tenant invariant (generalising Kurata)

**Rule (Invariant):** For any project with `multi_tenant: true` in its
standards, every query function in the data-access layer must accept a tenant
identifier and use it as a filter. Violations detected by AST scan.

**Tooling change:** New check `check_tenant_isolation` that:
- Reads the project's `tenant_config`: `{ tenant_id_field: "householdId",
  data_layer_paths: ["packages/db/queries/**"] }`
- Parses each query function in the configured paths.
- Verifies tenant_id_field is in the parameter list AND used in a `where`
  clause or equivalent.
- Reports violations.

**Why this matters:** Kurata's `householdId` rule is the highest-value
project-specific rule you have. Generalising it means TradingBot can set
`tenant_id_field: "accountId"`, Veda can set its equivalent, and future
projects get the protection by default if they opt in.

**Risk:** False positives where the query layer legitimately doesn't need
tenant filtering (admin queries, system queries). Handle with an explicit
`# tenant-isolation: bypass <reason>` comment that's checked in CI.
**Confidence:** High that the rule is right. Moderate on the AST check
complexity — depends on language and query library. For Kurata's case
(Drizzle ORM I'd guess?) it's doable; for raw SQL projects it's harder.

### 1.5 Debugging discipline Practice

**Rule (Practice):** When fixing a bug, the agent's task record must include
a `root_cause` field before any `propose_change` that claims to fix it. The
field cannot be "unknown" or "unclear" — it must state a hypothesis about
why the bug occurs.

**Tooling change:** `start_task` with `task_type: bugfix` requires
`root_cause` field. `propose_change` with `claims_fixes: <task_id>` blocks if
`root_cause` is empty.

**Why this matters:** This is the obra/Superpowers debugging methodology
adapted to your existing primitives. The agent that fixes a symptom without
identifying the cause produces a different class of mistake than one that
guesses at the root cause and is wrong — and they need different responses.
Making root cause explicit is the cheapest version of this discipline.

**Risk:** Agent writes plausible-sounding root causes that aren't actually the
cause. Mitigate by requiring a verification step in `definition_of_done`
that would have caught the bug under the hypothesised cause.
**Confidence:** Moderate. I'm extrapolating from Superpowers' approach without
having used it; the principle is sound but the specific implementation is a
guess.

### 1.6 Auth-change artifact Gate (replacing "mental review")

**Rule (Gate):** Any change touching files matching `**/auth/**`,
`**/permissions/**`, or `**/session/**` requires an `asvs_review` artifact to
exist in the task record before merge. The artifact lists which ASVS L1
controls the change touches (e.g. V2.1, V3.4) and what verification was done.

**Tooling change:** New `attach_asvs_review(task_id, controls, verification)`
tool. CI check that fails if auth-path changes lack an attached review.

**Why this matters:** "Mental review" is not a check; this makes the review an
artifact that can be audited.

**Risk:** Becomes a box-tick. Mitigate by spot-checking reviews in retros and
demoting back to Practice if the artifacts are uniformly low-quality.
**Confidence:** High on the need. Moderate on whether ASVS L1 is the right
checklist — it's what you already use, so I'm keeping it.

---

## Phase 2 — Hooks integration (3-5 days)

Move enforcement from honour-system MCP-tool-calls to event-driven hooks where
possible. This is what I think is the biggest architectural improvement
available.

### 2.1 `SessionStart` hook: phase + model declaration

Injects the phase-appropriate model routing reminder. If the current model
doesn't match the configured phase's expected family, the hook surfaces a
warning the agent must acknowledge. Doesn't fix the honour-system problem (the
model self-reports) but adds a check at session start that's hard to skip.

### 2.2 `PreToolUse` hook on Write/Edit: invariant pre-check

For each Invariant that has a fast local check (commented-out code, hardcoded
hex, secret patterns), run the check on the diff before the write commits. If
it fails, block the write and surface the violation to the agent.

This is the move from "MCP server enforces if called" to "system enforces
regardless of agent compliance."

### 2.3 `PreCompact` hook: durable findings

Before the conversation history compacts, dump current task state, open
questions, and recent findings to a file in the project workspace. This
implements the existing "after every two search/read ops, write findings
durably" practice as an actual gate.

### 2.4 `Stop` hook: completion check

Borrowed from Ralph's pattern but applied conservatively. Before the agent
exits a session with an open task, the hook checks: does the task have a
recorded outcome? Did `definition_of_done` get verified? If not, surface
the omission. Does NOT force re-execution like Ralph; just surfaces.

### Why hooks specifically

Your section 9 calls out that model routing enforcement is honour-system.
Hooks don't fix that, but they fix the broader problem the honour-system
critique points at: rules that depend on the agent remembering to call a tool
are weaker than rules that fire on system events. Anything that can move from
MCP-tool-call to hook should.

**Risk:** Hooks add latency and can break in surprising ways. Roll out one at
a time in one project (probably eleven11v2 or networkPulse — lower-stakes than
the sensitive trio).
**Confidence:** High on the approach. Low on the specific hook APIs — I
haven't built Claude Code hooks; check the docs before committing to
specific names.

---

## Phase 3 — Clean up vague rules (2-3 days)

Now reclassify rules that the taxonomy says are Principles, not Gates or
Practices.

### 3.1 Move to CLAUDE.md (as Principles)

These come OUT of `.agent-standards.yml` and into the prose part of CLAUDE.md:

- "Functions do one thing."
- "Names communicate intent."
- "DRY, SOLID, KISS, YAGNI" (the acronyms; specific applications stay as
  Practices).
- "Implement exactly what was requested" (the *spirit*; the Gate is
  scope-expansion).
- "Refactor only after it works" (the *spirit*; the Gate version is no commits
  in failing-test state).
- "Components own their styling" (the spirit; the Invariants are
  design-token checks).

### 3.2 Promote vague rules that should be Invariants

These get tooling built in Phase 4:

- "Parameterised queries only" → SAST rule.
- "Service-role keys never flow to clients" → build-time check.
- "Authorisation at the resource level" → see Phase 4 note.
- "Logging never includes PII" → log-format pre-commit check.

### 3.3 Demote rules that aren't actually being enforced or referenced

This requires data you don't have yet (you flagged it as section 9). Defer
to Phase 5 once metrics exist.

**Risk:** Reclassification feels political. Make it boring: each rule moves
once based on the taxonomy, with the move logged. No moralising.
**Confidence:** High on the moves above; low on the demotions which need data.

---

## Phase 4 — Build the missing checks (1-2 weeks)

The Phase 3 promotions identified Invariants without tooling. Build them.

### 4.1 SAST rule for parameterised queries

Language-specific. Easiest in TypeScript/Python via existing linters
(`@typescript-eslint/no-misused-promises` has cousins; Python has Bandit).
For C#/Swift, custom analyser needed.

### 4.2 Service-role-key build-time check

Bundle scanner: inspect compiled client output for any string matching the
service-role key pattern declared in `.env.example`. Fail build if found.

### 4.3 Tenant-isolation AST check

Per 1.4 above. Real complexity here is per-language.

### 4.4 Log-format check

Pre-commit hook that scans diff for log statements (`log.info`, `console.log`,
`logger.warn`, etc.) and warns if their arguments contain any field name from
a configured sensitive-field list (`email`, `password`, `token`, `ssn`,
`accountNumber`, etc.). Not perfect — strings are dynamic — but catches the
obvious cases.

### 4.5 Authorisation-at-resource-level check

I'm honestly uncertain how to do this generically. My instinct is that this
needs to be a per-project rule: each project declares its resource-access
pattern, and the check verifies routes touch only resources owned by the
caller. This is closer to a code review checklist than an automated check.
**Suggestion:** Leave it as a Practice for now, with a checklist artifact
requirement (similar to ASVS gate). Promote to Invariant only if a clear
check pattern emerges.

**Risk:** This phase is the most work. Spread across several weeks; do not
block other phases on it.
**Confidence:** Mixed. High on what to build, lower on time estimates for
each check.

---

## Phase 5 — Metrics and pruning (ongoing)

Address section 9's "no metrics" gap.

### 5.1 Per-rule event counters

The drift-log already exists. Add a `rule_id` field to every entry. Each
Invariant/Gate gets a unique ID. The MCP server gains a
`get_rule_metrics` tool that returns counts per rule over a time window.

### 5.2 Quarterly review

Once metrics exist (give it a month or two of data), do a quarterly review:
- Rules with zero events: candidates for demotion or deletion.
- Rules with high event counts and low promotions to higher tier: investigate
  whether the rule is too strict or the codebase has a systemic issue.
- Rules with high promotions: investigate whether the Gate should become an
  Invariant (i.e. should the check happen earlier).

### 5.3 Document the demotions

When rules get demoted or removed, log it in a `decisions.md` file (not just
drift-log). The reasoning matters for future rule debates.

**Risk:** Quarterly reviews get skipped. Mitigate by attaching them to an
existing rhythm (e.g. quarterly planning).
**Confidence:** High on the value. Moderate on whether it actually gets done.

---

## What I'm deliberately NOT doing

- **Adopting Superpowers wholesale.** The debugging discipline (1.5) borrows
  the principle, not the plugin. Adopting the plugin would conflict with your
  MCP enforcement layer in ways I can't predict without testing.

- **Adopting Ralph anywhere by default.** The Stop hook in 2.4 is a tiny piece
  of Ralph's pattern applied conservatively. Ralph's actual loop is not for
  your sensitive projects and shouldn't be a framework-wide default.

- **Restructuring the per-project standards.** Each project's `.agent-standards.yml`
  inherits from org-defaults; the tier reclassification flows down
  automatically. Project-specific rules get tier'd as part of normal updates,
  not in a big-bang migration.

- **Touching the CI architecture.** Your reusable workflows in
  `.github/.github/workflows/` are working; nothing here changes them. New
  checks (parameterised-query SAST, tenant-isolation, etc.) get added as new
  jobs in the existing reusable workflows.

---

## Sequencing summary

| Phase | What | Days | Blocker for |
|-------|------|------|-------------|
| 0 | Taxonomy metadata | 1-2 | All others |
| 1 | New rules (DoR, scope, uncertainty, tenant, debug, auth-artifact) | 3-5 | — |
| 2 | Hooks integration | 3-5 | — |
| 3 | Reclassify vague rules | 2-3 | Phase 4 |
| 4 | Build missing checks | 1-2 weeks | — |
| 5 | Metrics + pruning | Ongoing | — |

Phases 1, 2, and 3 can proceed in parallel once Phase 0 is done. Phase 4
depends on Phase 3 (you need to know which rules need checks). Phase 5 needs
data from Phases 1, 2, 4.

---

## Next document

Document 3 is the revised `org-defaults.yml`, structured around the taxonomy
from Document 1 and including the new rules from Phase 1 of this plan. Where
I'm inferring the structure of your existing YAML, I'll mark it clearly.
