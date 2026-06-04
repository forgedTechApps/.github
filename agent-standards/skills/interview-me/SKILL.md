---
name: interview-me
description: |
  Interview the user about a plan, design, or bugfix until you can produce a
  concrete scope with files, test approach, explicit "out of scope" list, and a
  dispatch recommendation (inline vs. one subagent vs. many, grounded in the work).
  Use this skill at the start of any non-trivial task — features, bug fixes,
  architectural changes, auth changes. Also use when the user says "let's
  build/design/fix X", "plan this", "interview me", or proposes a change with
  unclear boundaries. Trivial single-file edits skip the skill via
  size='trivial' on start_task.
---

# Interview Me — definition-of-ready interview

Most agent mistakes are scope mistakes. The plan was vague, "done" was
never defined, the file list was a guess, and the agent drifted. This
skill prevents that by making planning a conversation you lead.

## When to use

Run interview-me at the start of any task that is **not** trivial. Trivial = single
file, obvious behaviour, no architectural decision, no security implication.
For trivial tasks, the user can call `start_task` with `size: 'trivial'` and
skip the interview; the bypass is logged.

Everything else: interview first, then call `start_task`.

## The contract

The interview's job is to populate the fields `start_task` will ask for:

- `description` — what the user wants (one short sentence)
- `hypothesis` — your current best theory about how to approach it
- `task_type` — `feature` | `bugfix` | `architecture` | `auth_change`
- `scope_statement` — one-sentence what changes
- `files_intended` — explicit list of paths/globs you expect to touch
- `test_approach` — how you'll verify the change
- `definition_of_done` — observable outcome that signals completion
- `out_of_scope` — explicit list of things you'll NOT do
- `root_cause` — only for `task_type: 'bugfix'`. Your hypothesis about why the
  bug happens. Must be ≥10 chars; "unknown" / "tbd" rejected.

These are the **output** of the conversation. Don't hand the user a form;
ask one question at a time, propose a recommended answer, wait for
confirmation, move on.

## How the interview runs

For each branch below: **ask one question, recommend an answer, wait for
confirmation or correction.** If the question could be answered by reading
the code, read first then propose. Respecting the user's time produces
better recommendations and a faster interview.

### Universal branches (every task)

1. **What problem are we solving?** *Recommended: paraphrase in one sentence;
   ask if you got it right.*
2. **What's the smallest version that solves it?** *Recommended: simplest
   approach that meets the stated need; ask if anything's missing.*
3. **What's explicitly out of scope?** *Recommended: name the obvious
   "while I'm here" temptations and confirm they're off the table.*
4. **Which files will this touch?** *Grep first. Recommend the list. Ask
   if anything else.*
5. **How will we know it works?** *Recommended: test approach + observable
   outcome. Tests-first if the spec is known; build-then-test if it's
   novel.*
6. **Is this a vertical slice?** *Recommended: confirm the work cuts
   end-to-end (UI/API → logic → data) and is demonstrable on its own,
   rather than building one horizontal layer in isolation. If it's
   layer-only (e.g. "just the schema", "just the worker"), confirm that's
   deliberate and the rest of the slice is tracked elsewhere — a layer
   nobody can exercise defers integration risk to the worst moment.*
7. **What's the pattern to mirror?** *Grep for the closest existing
   example — the repository, route, widget, or test this should look like —
   and name it by path. This is the "E" in GCOE (Goal, Constraints,
   Examples, Output): when the scope is handed to an implementing agent,
   the concrete example to paste matters more than any description. "Match
   `apps/web/lib/foo.ts`" beats "follow the existing pattern." If there's
   genuinely no precedent, say so — that itself is worth surfacing.*
8. **How will this be executed — inline, one subagent, or many?** *Recommend
   a dispatch grounded in the scope you just built (the files from #4, the
   triggers below), not by habit. The default is **inline in the main loop**;
   escalate only when the work shows a reason to. Decide in two steps:*
   - *Inline vs. one subagent (isolation, by risk): keep it **inline** when
     it's short and single-surface — a few edits in one repo, a read/search,
     a one-shot fix. Move it into **one dedicated subagent** when it's
     long/stateful AND any of: spans multiple repos/branches/worktrees; runs
     many edit→build→verify cycles; or performs destructive/irreversible steps
     (git reset --hard, tag moves, force-push, bulk rewrites). The reason is
     blast-radius containment, not speed — a bad reset or cwd mix-up then
     corrupts only the subagent's throwaway context.*
   - *One vs. many (independence): use **multiple agents only for genuinely
     independent units** — no shared mutable state, no ordering dependency, no
     possible write-conflict (e.g. one agent per repo for an org-wide
     read/audit, disjoint-area searches). Test: "could any two, run at once,
     read a half-written result or commit to the same place?" If yes, run them
     **sequentially in one subagent**. Number of agents follows the number of
     independent units, not a target.*
   *State the recommendation in one line — e.g. "Inline: ~3 edits in one repo,
   no destructive steps" or "One subagent: multi-repo, many verify cycles" or
   "5 agents: one per repo, read-only audit, fully independent" — and confirm.
   This is the org `dispatch_subagent_for_isolation` + `parallelize_only_independent`
   rules applied to THIS task; surfacing it here is what stops the reflexive
   default-to-subagent.*

### Bugfix branch (additional)

When `task_type: 'bugfix'`:

1. **Observed vs expected behaviour?** *State both; confirm.*
2. **Hypothesis about the cause?** *This populates `root_cause`. You MUST
   propose a hypothesis — if you genuinely can't, that's a
   `surface_uncertainty({ category: 'ambiguous_spec' })` event, not a
   reason to skip the field. State your best guess and let the
   definition_of_done verification step confirm or refute.*
3. **What test would have caught it?** *That's part of test_approach.*
4. **What's the smallest fix?** *Recommended: change the cause, not the
   symptom.*

### Architecture branch (additional)

When `task_type: 'architecture'`:

1. **What constraint is driving this?** *Confirm the change is forced by
   real friction, not aesthetic preference.*
2. **What does NOT change?** *Helps bound the blast radius.*
3. **Migration path?** *Forward-only with explicit rollback plan, or
   document why not.*
4. **Files actually changing vs files just renamed?** *Tighten
   `files_intended` to the real-change set.*

### Auth-change branch (additional)

When `task_type: 'auth_change'`:

1. **Which ASVS L1 controls does this touch?** *Reference:
   https://owasp.org/www-project-application-security-verification-standard/
   Common: V2.x session, V3.x access control, V4.x authentication.*
2. **Threat model — who could exploit a mistake here?** *Concrete actors,
   not abstract "attackers".*
3. **How is the change verified beyond unit tests?** *Integration test
   against real auth provider, manual prod verification, etc.*

The ASVS branch's output feeds `attach_asvs_review` after `start_task`
returns successfully.

### UI branch (additional)

When the task touches a screen, component, or view (any stack — web,
mobile, SwiftUI). Reference: [`UI_UX_GUIDELINES.md`](https://github.com/forgedTechApps/.github/blob/main/agent-standards/templates/UI_UX_GUIDELINES.md)
(cross-cutting UI contracts). For mobile/native work also walk
[`MOBILE_GUIDELINES.md`](https://github.com/forgedTechApps/.github/blob/main/agent-standards/templates/MOBILE_GUIDELINES.md)
(touch targets, safe areas, platform split, lifecycle, on-device sensitive data).
For web work walk [`WEB_GUIDELINES.md`](https://github.com/forgedTechApps/.github/blob/main/agent-standards/templates/WEB_GUIDELINES.md)
(Core Web Vitals, RSC/hydration, server-authoritative validation, no secrets in
the client bundle, a11y/SEO).

1. **Does this perform a mutation (create/update/delete)?** *If yes, walk
   the mutation→UI contract: which views show this data, how does each
   refresh after the write (invalidate/revalidate/context-save), and is it
   optimistic or pessimistic? A mutation with no refresh path is a
   stale-screen bug. Include server/realtime caches, not just the query
   layer.*
2. **Loading / error / empty — all three handled?** *Every async surface
   shows progress while loading, a recoverable message on error (Retry,
   never navigate away), and a designed empty state distinct from both.*
3. **What feedback does the user get?** *No silent actions — pressed state,
   progress on submit, visible success AND failure. Destructive actions
   confirm or offer undo.*
4. **Does it fit the project's design system + navigation rules?** *Tokens
   not magic values; the project's router conventions (CLAUDE.md);
   accessibility floor (contrast, touch targets, semantic labels).*

Skip this branch for non-UI work (pure logic, API, infra).

## When to call surface_uncertainty

During the interview, if a question can't be resolved by reading code or
asking the user, call `surface_uncertainty` with the right category:

- `ambiguous_spec` — user's answer is still ambiguous after follow-up
- `unknown_dependency` — needed library/service/data isn't documented
- `conflicting_rule` — proposed approach conflicts with `.agent-standards.yml`
- `unexpected_state` — codebase doesn't match assumptions

In strict-mode projects, surfacing blocks subsequent `propose_change` calls
until resolved. In log-only projects, it just records. Either way, the
interview can usually continue once the uncertainty is documented.

## Closing the interview

When all required fields have non-placeholder answers and any open
uncertainties are resolved (in strict mode) or logged (in log-only),
summarise the populated fields and ask the user to confirm. Then call:

```
start_task({
  description: "<from interview>",
  hypothesis: "<from interview>",
  phase: "planning",
  current_model: "<your declared model>",
  task_type: "feature" | "bugfix" | "architecture" | "auth_change",
  scope_statement: "<from interview>",
  files_intended: [...],
  test_approach: "<from interview>",
  definition_of_done: "<from interview>",
  out_of_scope: [...],
  // bugfix only:
  root_cause: "<from interview>",
})
```

If `task_type === 'auth_change'`, after `start_task` returns successfully:

```
attach_asvs_review({
  controls_touched: [...ASVS L1 IDs from interview...],
  verification: "<what was checked, how>",
  reviewer: "interview-me"
})
```

The phase stays `planning` until the user explicitly dispatches execution.
Don't auto-transition.

**Carry the pattern-to-mirror AND the dispatch decision forward.** `start_task`
has no dedicated field for the example reference (branch 7) or the dispatch
recommendation (branch 8), so fold both into `scope_statement` — e.g.
"…mirroring the shape of `apps/web/lib/foo.ts`; execute inline (single repo,
~3 edits, no destructive steps)." When you later dispatch an implementing
subagent, paste the example into the prompt (GCOE's "E"). Naming the pattern
and the dispatch in the interview but dropping them before execution wastes the
most useful things the interview produced — and the dropped dispatch line is
exactly where the reflexive default-to-subagent creeps back in.

## During execution: expand_scope

The skill's job ends at `start_task`. But the `files_intended` list it
produced is consumed during execution by the scope-expansion gate. If the
agent (or a Sonnet subagent) needs to touch a file outside that list:

1. The agent's `propose_change` will block with `TASK_SCOPE_EXPANSION`.
2. Ask the user whether the new file should be in scope.
3. If yes, call `expand_scope({ path, reason, user_confirmed: true })`.
4. If no, revert and complete the original scope first.

The skill should produce a `files_intended` list tight enough that
`expand_scope` only fires for genuine new discoveries — not a list so
broad it never fires (e.g. `['**']`), and not so narrow that every task
needs three expansions.

## What this skill does NOT do

- It doesn't write code. The interview is the whole job.
- It doesn't call `propose_change`. That comes after execution starts.
- It doesn't skip questions because the user "seems to know what they're
  doing". The fields are the contract.
- It doesn't produce a plausible-sounding `scope_statement` when the user
  was vague. If they can't articulate scope, the interview continues or
  `surface_uncertainty` fires.

## Bailout

The user can end the interview at any time with "skip" or "trivial". This
sets `size: 'trivial'` on the task and logs the skip. Frequent trivial
declarations on non-trivial tasks show up in the drift log (`get_drift_log`
+ `get_rule_metrics`) — that's the signal that this skill's trigger
threshold needs tuning.

## Sensitive-project overrides

If the project has additional interview-me rules in its CLAUDE.md (search for
"interview-me overrides"), apply them on top of the universal branches.
Examples:

- **Kurata**: must ask about cross-household paths, receipts, briefing,
  FairShare weighting.
- **TradingBot**: must ask about domain layer, OrderService, protective
  stops, decimal types, live-trading code path.
- **Veda**: must ask about Claude call sites, domain purity, Vitruvian
  gating, paywall, health-adjacent claims.

In sensitive projects, `surface_uncertainty` runs in strict mode by
config — the interview can't move past unresolved ambiguity.
