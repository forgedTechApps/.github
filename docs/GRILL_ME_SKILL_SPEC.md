# grill-me Skill — Deferred Spec

**Status:** Deferred to ~W10–W11. **Do not implement yet.**

**Why deferred:** Two prerequisite MCP tools must ship first — `surface_uncertainty` and `bugfix_root_cause` — both currently flagged in IMPLEMENTATION_PLAN.md as deferred-pending-data. Shipping the skill against tools that don't exist would either fail at runtime or force premature builds of those tools.

**When to revisit:** After Increment 8 (multi-tenant generalisation) lands, build `surface_uncertainty` + `bugfix_root_cause` as Increment 8.5, then implement this spec as Increment 9 (renumbering the original Increment 9 hooks work to follow).

**Reading order:**
1. This orientation header (you are here).
2. The full spec verbatim, preserved below for fidelity.
3. When implementing, diff the spec's MCP tool signatures against what actually exists at that point — the spec was written before those tools were built, so names/params may need adjustment.

---

## Decision log (2026-05-27)

After completing Increment 5 (auth-change ASVS artifact gate), the spec below was proposed for immediate implementation. We chose to defer for these reasons:

- The full grill-me skill targets four MCP tools; only two-and-a-half exist today (DoR ✅, scope_expansion ✅ but post-start_task not in-interview, auth_change_asvs_artifact ✅ for the auth branch, bugfix_root_cause ❌, surface_uncertainty ❌).
- A scoped pilot (option 1) was considered and rejected on the grounds of sequence purity: shipping the skill twice (scoped → full) risks the second pass being deprioritised because "we already have grill-me." Better to ship once, properly.
- The intervening period (W6–W9) collects baseline data on how DoR fields are filled *without* the interview pattern. That data justifies the skill's value when it ships, and confirms whether `surface_uncertainty` is actually load-bearing or speculative.
- Higher-priority security work (Kurata tenant-isolation, W7–W8) takes precedence over workflow improvements.

## What this means in the meantime

- DoR fields on `start_task` get filled by raw form-completion. Quality is whatever the calling agent produces unaided.
- Expected to see: plausible-but-shallow `scope_statement`, overly-broad `files_intended` (e.g. `["**"]`), generic `out_of_scope`. That's the baseline.
- The drift-log captures DoR-field violations + `expand_scope` calls. Review that data before implementing the skill — it informs which decision-tree branches actually pay off.

## Pre-implementation checklist (do these before starting the skill build)

1. Confirm `surface_uncertainty` MCP tool exists, with the four categories: `ambiguous_spec`, `unknown_dependency`, `conflicting_rule`, `unexpected_state`.
2. Confirm `start_task` accepts `task_type` (or its equivalent) and `root_cause` fields.
3. Pull the latest tool signatures and diff against the spec's "Integration with existing MCP tools" section.
4. Re-read the W4–W9 drift-log entries. Specifically look at:
   - How often `size: trivial` was declared.
   - How often `expand_scope` was called per task.
   - Whether `files_intended` patterns were narrow or `["**"]`-broad.
5. Adjust the spec's decision-tree branches based on what the data shows is missing.

---

## Full Spec (verbatim, as proposed 2026-05-27)

# `grill-me` skill — forgedTechApps adaptation

**Purpose.** Implement the `definition_of_ready` gate as a structured planning
conversation rather than a form-filling exercise. Adapted from Matt Pocock's
viral `grill-me` skill, wired into the existing MCP tools.

**Scope.** This document specifies the skill file, the org-default version,
project-specific overrides for the sensitive trio (Kurata, TradingBot, Veda),
and the integration points with `start_task`, `expand_scope`, and
`surface_uncertainty`.

**Assumed already built.** The four-tier taxonomy from Document 1, the
migration plan from Document 2, and the new MCP tools (`expand_scope`,
`surface_uncertainty`, `attach_asvs_review`). Where the spec calls those tools
by name, that's the integration contract.

---

## Confidence and uncertainty notes

Before the spec itself, I want to be explicit:

- I'm confident on the **structure** of the skill (the conversation pattern,
  the integration with `start_task`, the field-population approach).
- I'm less confident on the **exact MCP tool call syntax** because I haven't
  seen your actual tool signatures. The names and parameters below match the
  taxonomy/migration docs but should be diffed against the real implementation.
- The **trigger phrasing** in the description is calibrated to be "pushy enough
  to fire when it should" per the skill-creator guidance, but Claude Code's
  triggering behaviour varies — expect to iterate this once it's in use.
- I'm **uncertain** how grill-me's interview style interacts with your
  two-phase model routing in practice. Theoretically it lines up (planning =
  opus = thoughtful interview); in practice the conversation length may push
  context limits in ways worth measuring.

---

## File layout

```
.claude/
└── skills/
    └── grill-me/
        └── SKILL.md
```

Per-project overrides live in the project's own `.claude/skills/grill-me/` if
they need different behaviour, but the recommended pattern is to keep
overrides in the project's `CLAUDE.md` (which the skill reads at runtime)
rather than fork the skill file.

---

## The skill file: `.claude/skills/grill-me/SKILL.md`

This is the org-default version. Drop into the org's shared
`.claude/skills/` directory or vendor into each project.

```markdown
---
name: grill-me
description: |
  Interview the user relentlessly about a plan, design, or bugfix until a
  shared understanding is reached, walking down each branch of the decision
  tree. Use this skill whenever the user wants to start a non-trivial task,
  needs to define scope before coding, mentions "grill me", asks to "plan
  this out", proposes a change with unclear boundaries, or says anything like
  "let's build/design/fix X". This is the standard entry point for the
  definition_of_ready gate — non-trivial tasks must go through this before
  start_task can transition to execution phase.
---

# Grill Me — definition-of-ready conversation

This skill exists because most agent mistakes are scope mistakes. The plan
was vague, "done" was never defined, and the agent drifted. This skill
prevents that by making planning a conversation that the agent drives.

## When this skill applies

Trigger this skill at the start of any task that isn't trivial. A trivial
task is one that:

- Touches a single file
- Has obvious, well-defined behaviour
- Requires no architectural decision
- Has no security, multi-tenant, or auth implications

For trivial tasks, the user can declare `size: trivial` when calling
`start_task` and skip this skill. The skip is logged.

Everything else goes through grill-me first.

## The interview pattern

The goal is to populate five fields that `start_task` requires:

- `scope_statement` — one sentence describing what changes
- `files_intended` — explicit list of paths the agent expects to touch
- `test_approach` — how the change will be verified
- `definition_of_done` — observable outcome that signals completion
- `out_of_scope` — explicit list of things the agent will NOT do

These are not a form to hand the user. They are the *output* of a
conversation the agent leads.

### Conversation structure

Walk down the decision tree branch by branch. For each branch:

1. Ask one question
2. Provide your recommended answer
3. Wait for confirmation or correction
4. Move to the next branch

If a question can be answered by exploring the codebase, explore the
codebase first and use what you find to inform your recommended answer.

When you've covered all branches, summarise the five fields and ask the
user to confirm before calling `start_task`.

### Decision tree branches

For a feature:

- What problem is this solving? (one sentence)
- What's the smallest version that solves it?
- What's explicitly out of scope?
- Which files will this touch? (grep first, recommend a list)
- How will we know it works? (test approach + observable outcome)
- What's the rollout? (does anyone need to know? any migration?)

For a bugfix (also triggers `bugfix_root_cause` gate):

- What's the observed behaviour vs the expected behaviour?
- What's your hypothesis about the cause? (this becomes `root_cause`)
- How can the hypothesis be verified before changing code?
- What's the smallest fix that addresses the cause?
- What test would have caught this?
- What's out of scope? (the temptation to fix related things)

For an architectural change:

- What constraint or pain point is driving this?
- What's the proposed change in one sentence?
- What does NOT change?
- What's the migration path for existing code/data?
- What's the rollback plan if this is wrong?
- Which files does the change actually touch vs which files just need
  search-and-replace?

For an auth/permissions/session change (also triggers
`auth_change_asvs_artifact` gate):

- Which ASVS L1 controls does this change touch? (V2.x session,
  V3.x access control, V4.x authentication, etc.)
- What's the threat model — who could exploit a mistake here?
- How will the change be verified beyond unit tests?
- What's the audit trail for this change in production?

## Recommended-answer pattern

Every question must come with your recommended answer. This is the change
from Pocock's original that makes the interview fast: the user can say
"yes" instead of explaining from scratch.

Examples:

- Q: "Which files will this touch?"
  Recommended: "Based on grepping for `applyDiscount`: `pricing/discount.ts`,
  `pricing/discount.test.ts`, and the calling site in `cart/checkout.ts`.
  Anything else?"

- Q: "What's the smallest version that solves it?"
  Recommended: "Add a feature flag that gates the new flow. Old flow stays
  in place until the flag is fully rolled out. Acceptable?"

- Q: "What's out of scope?"
  Recommended: "Refactoring the surrounding code, renaming variables that
  bother me, adding tests for unrelated existing behaviour. Confirm?"

When a question has an obviously good answer, the user can just say "yes".
When the recommendation is wrong, the user corrects it and the conversation
progresses. Either way, the field gets populated with a real answer, not a
placeholder.

## Codebase exploration before asking

Before asking the user a question that could be answered by reading code,
read the code. Specifically:

- For "which files will this touch?" — grep for the function/class/route
  being changed and propose the list yourself.
- For "what tests exist?" — find the test file pattern and check what's
  already there.
- For "what's the existing pattern?" — find similar code elsewhere in the
  codebase.

This respects the user's time and produces better recommendations.

## When to surface uncertainty during the interview

If during the interview the agent encounters something it can't resolve by
reading the codebase or asking the user — conflicting rules, missing
context, ambiguous spec the user can't disambiguate — it calls
`surface_uncertainty` with the relevant category before continuing.

Specifically:

- `ambiguous_spec` — the user gives an answer that's still ambiguous after
  follow-up
- `unknown_dependency` — a needed library/service/data isn't documented
- `conflicting_rule` — the proposed approach conflicts with a rule in
  `.agent-standards.yml`
- `unexpected_state` — the codebase doesn't match assumptions the
  conversation is built on

In strict-mode projects (Kurata, TradingBot, Veda), uncertainty blocks
progress until the user responds. In other projects, it logs and
proceeds.

## Reaching shared understanding

The interview ends when:

1. All five required fields have non-placeholder answers
2. Any triggered sub-gates (bugfix_root_cause, auth_change_asvs_artifact)
   have their required fields
3. No `surface_uncertainty` calls are outstanding in strict-mode projects
4. The user has confirmed the summary

At that point, call `start_task` with the populated fields. The phase will
remain `planning` until the user explicitly transitions to `execution`.

## What this skill does NOT do

- It does not write code. The interview is the whole job.
- It does not call `propose_change`. That comes after `start_task` and the
  phase transition.
- It does not skip questions because the user "seems to know what they're
  doing". The fields are the contract; they must be filled.
- It does not produce a plausible-sounding scope_statement when the user
  was vague. If the user can't articulate scope, the interview continues
  or `surface_uncertainty` fires.

## Bailout

The user can end the interview at any time with "skip" or "trivial". This
sets `size: trivial` on the task and logs the skip. Repeated trivial
declarations on tasks that turn out to be non-trivial show up in the
drift-log — that's the signal that this skill's trigger threshold needs
tuning.
```

---

## Project-specific overrides

The skill file above is the org-default. The three sensitive projects need
stricter behaviour, achieved through project `CLAUDE.md` rather than
forking the skill.

### Kurata `CLAUDE.md` addendum

```markdown
## grill-me overrides (Kurata)

In addition to the standard interview branches, grill-me MUST ask:

- "Does this touch any cross-household query path?"
- "What's the householdId filter strategy? (recommend: tenant-isolation
  invariant covers it)"
- "Does this change touch receipts? If yes, are signed URLs preserved?"
- "Does this affect the briefing? (max 3 items, canonical priority)"
- "Does this affect FairShare weighting? (equal weights are an invariant)"

Strict mode is on: `surface_uncertainty` blocks progress until user
responds.

Trivial bypass requires explicit confirmation: "I confirm this touches no
household data, no receipts, no briefing, no FairShare logic, no auth."
```

### TradingBot `CLAUDE.md` addendum

```markdown
## grill-me overrides (TradingBot)

In addition to the standard interview branches, grill-me MUST ask:

- "Does this touch the domain layer? (it depends on nothing else — confirm)"
- "Does this touch OrderService? (the only place orders are placed)"
- "If this places an order, what's the protective stop?"
- "Are any monetary values involved? (decimal type required, not double)"
- "Is this changing any live-trading code path? (deploys are manual via
  script — confirm you're not assuming auto-deploy)"

Strict mode is on. Trivial bypass not available for any task touching:
`order/`, `domain/`, `money/`, `deploy/`.
```

### Veda `CLAUDE.md` addendum

```markdown
## grill-me overrides (Veda)

In addition to the standard interview branches, grill-me MUST ask:

- "Does this involve a Claude call site? (only 4 exist — confirm which)"
- "Does this touch the domain? (must stay pure — no IO, no side effects)"
- "Does this touch Vitruvian gating?"
- "Does this touch paywall logic? (centralised — single source)"
- "If health-adjacent: what's the user-facing claim? (no diagnostic
  language)"

Strict mode is on. No auto-deploy to Cloudflare or App Store —
grill-me explicitly confirms the user is not assuming deployment.

Trivial bypass not available for any task touching:
`claude/`, `paywall/`, `vitruvian/`, `domain/`.
```

---

## Integration with existing MCP tools

The skill doesn't replace tool calls; it produces the inputs to them.

### `start_task` — the primary integration

After the interview, the agent calls `start_task` with the populated fields.
Expected signature (inferring from the migration plan):

```
start_task(
  task_id: <generated>,
  task_type: feature | bugfix | architecture | auth_change | trivial,
  phase: "planning",
  current_model: <self-declared>,
  scope_statement: <from interview>,
  files_intended: <list from interview>,
  test_approach: <from interview>,
  definition_of_done: <from interview>,
  out_of_scope: <list from interview>,
  size: normal | trivial,
  # optional, depending on task_type:
  root_cause: <required if task_type == bugfix>,
  asvs_controls: <required if task_type == auth_change>,
)
```

The DoR gate blocks the call if any required field is empty or contains a
forbidden placeholder ("tbd", "unknown", "tba", empty string).

### `expand_scope` — the escape hatch

During execution, if the agent needs to touch a file not in
`files_intended`, it calls `expand_scope`:

```
expand_scope(
  task_id: <current>,
  file_path: <the new file>,
  reason: <why this file is now in scope>,
  user_confirmation: <must be obtained before call returns success>
)
```

The skill mentions this in its "what this does NOT do" section: grill-me
doesn't pre-emptively expand scope; it produces a tight `files_intended`
list and lets `expand_scope` handle additions during execution.

### `surface_uncertainty` — when the interview hits walls

Called from within the interview when a question can't be resolved.
Expected signature:

```
surface_uncertainty(
  task_id: <current, may be pre-start_task>,
  category: ambiguous_spec | unknown_dependency | conflicting_rule | unexpected_state,
  description: <what's unclear>,
  proposed_options: <list of possible resolutions, if any>,
)
```

In strict-mode projects, the call blocks further `propose_change` until the
user responds. In log-only mode, it records and the interview continues.

### `attach_asvs_review` — auth task branch

When `task_type: auth_change`, the interview's ASVS questions populate the
required `asvs_controls` field on `start_task` AND trigger
`attach_asvs_review`:

```
attach_asvs_review(
  task_id: <current>,
  controls_touched: <list of ASVS L1 control IDs>,
  verification: <what was checked, how>,
  reviewer: "grill-me-interview" | <human reviewer name>
)
```

Note: `reviewer: "grill-me-interview"` is the agent-driven case. The
auth_change_asvs_artifact gate may require a human reviewer for certain
control changes — that's a project-config decision, not a skill decision.

### `propose_claude_md_rule` — feedback loop

If during the interview the agent hits the same friction repeatedly
(particular question always confuses users, particular branch always
needs the same follow-up), it should propose a refinement via
`propose_claude_md_rule` so the drift-log captures it.

---

## How this fits the migration plan

This skill is the implementation of Phase 1 step 1 (definition_of_ready).
Specifically:

- **Phase 0 (taxonomy metadata)**: this skill assumes `tier:` metadata is
  present so it can identify which rules it might conflict with during the
  interview.
- **Phase 1.1 (definition_of_ready gate)**: this skill is the primary
  workflow that populates the gate's required fields.
- **Phase 1.2 (scope_expansion gate)**: this skill's tight `files_intended`
  list is the input to scope_expansion's check.
- **Phase 1.3 (uncertainty surfacing)**: this skill calls
  `surface_uncertainty` from within the interview.
- **Phase 1.5 (bugfix root cause)**: when `task_type: bugfix`, the
  interview's hypothesis question populates `root_cause`.
- **Phase 1.6 (auth ASVS artifact)**: when `task_type: auth_change`, the
  interview's ASVS questions produce the artifact.

The skill is the user-facing surface for most of the new gates. Build the
skill, and four gates' worth of input collection comes for free.

---

## Rollout plan

Same conservative approach as the rest of the framework:

1. **Pilot on one low-stakes project first.** eleven11v2 or networkPulse.
   Drop the skill in, see how the interview feels, tune the trigger
   description if it under- or over-fires.
2. **Adjust based on actual conversations.** The decision-tree branches
   above are my best guess at the right questions. Real interviews will
   show which branches are skipped, which are repeated, which generate the
   most uncertainty.
3. **Roll to medium-sensitivity projects** (forgev2, forge-ios, Viyr,
   networkPulse, forgedtech itself).
4. **Roll to sensitive trio LAST.** Kurata, TradingBot, Veda need the
   strict-mode overrides above and benefit from skill maturity. Don't
   make these the test bed.

Per the skill-creator guidance, after rollout, write 2-3 test prompts and
run them to verify the skill triggers correctly. Example prompts to try:

- "Help me add a 10% discount to checkout for new users." (should trigger)
- "Fix this typo in the README." (should NOT trigger — trivial)
- "I want to redesign how we handle session timeouts." (should trigger,
  with auth_change branch)
- "Just give me the SQL to count active users." (should NOT trigger —
  not a code change to the system)

If the skill fires on the trivial ones, the description is too pushy. If
it misses the non-trivial ones, it's not pushy enough.

---

## What I'm uncertain about

Calling out the speculative parts honestly:

- **The exact branch questions** are my best guess at what produces good
  plans. They'll need refinement. The Pocock skill is famously short; mine
  is longer because it's tied to the gate fields. Worth experimenting with
  collapsing branches if the conversation feels bureaucratic.

- **The interaction between grill-me and Claude Code's natural conversation
  flow.** Claude Code will sometimes start coding before the user has
  finished talking. The skill description tries to prevent that with the
  trigger phrasing, but it may need a more explicit `// DO NOT WRITE CODE
  YET` marker. I'd rather see it in practice before adding that.

- **Whether `domain-model` should replace or supplement grill-me.** The
  latest Pocock guidance is to use domain-model as the primary planning
  skill, with grill-me as a lighter alternative. For your framework, the
  domain-model approach (grounding in CLAUDE.md, ADRs, ubiquitous
  language) is probably the better long-term fit, but it's more work to
  build and requires conventions you may not have yet. Starting with
  grill-me adapted as above is the pragmatic move; promote to a
  domain-model variant once you see what's missing.

- **The trigger description's phrasing.** Per skill-creator guidance, it
  should be "pushy" to combat undertriggering. I've made it moderately
  pushy. Watch how often it fires on tasks that are genuinely trivial and
  dial back if needed.

---

## What this is not

- **Not a replacement for code review.** The interview produces a good
  plan; review still catches plan-to-implementation drift.
- **Not a substitute for the user's expertise.** Recommended answers are
  starting points; the user can always override.
- **Not a way to make every task heavyweight.** The trivial escape hatch
  is essential. If it's never used, the threshold for "non-trivial" is
  set wrong.
- **Not aligned with Pocock's exact original.** His version is famously
  4-5 lines. Mine is longer because it integrates with your MCP tools and
  the gate fields. If the integration feels like overhead, strip it back
  toward Pocock's minimal form — the integration is the most modifiable
  part.
