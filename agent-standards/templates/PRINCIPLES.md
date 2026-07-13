# forgedTechApps — Principles

These are cultural guidelines, not enforceable rules. They inform judgement
when the rulebook is silent. They live here, not in `.agent-standards.yml`,
because they cannot be mechanically checked — and pretending otherwise
encourages reviewers to either over-index on culture or mistake aspiration
for enforcement.

Each project's `CLAUDE.md` should link to this file under a "Principles"
section. Project-specific principles can be appended after the link.

---

## Software design

- **Functions do one thing.** If a function name uses "and", split it.
- **Names communicate intent.** Single-letter variables only in tight loops
  or well-known math (i, j, x, y).
- **DRY, SOLID, KISS, YAGNI.** Build for current requirements. No speculative
  abstraction. Three similar lines beats a premature factory.
  (The Practice "three uses = extract" is the actionable version.)

## AI / LLM call sites

For projects that call an LLM (most of the suite):

- **LLM call sites are observable.** Every call logs what matters — inputs (or
  a redacted shape of them), outputs, latency, token counts, and cost — behind
  the same redaction rules as everything else (no PII/secrets in logs). You
  cannot operate, debug, or budget what you can't see. This is the first thing
  that separates a prototype from a product.
- **There is an objective way to judge output quality.** An eval harness — even
  a small set of golden input→expected-shape cases — beats "it looked right in
  testing." LLM behaviour drifts across model versions and prompt edits; evals
  are the regression test for non-deterministic output.
- **One chokepoint per provider.** All calls to a given model route through a
  single client/service (Veda's 4 Claude sites, Kurata's `KurataAgent`), never
  scattered `messages.create()` across features. The chokepoint is where
  observability, caching, redaction, and rate-limiting live — once.
- **Cost is a design input, not an afterthought.** Cache aggressively (prompt
  caching, result caching), route lightweight work to cheaper models, and know
  the per-action cost before shipping. (See the Model-routing tiers — the same
  "cheap work to Haiku" logic applies to the app's own LLM calls.)
- **External content is data, not instructions.** Anything that crossed a trust
  boundary before reaching an LLM call site — user text, tool results, MCP
  responses, web scrapes, uploaded files — must be treated as potentially
  adversarial. Separate it from the system prompt with explicit delimiters and
  label it untrusted. The one-chokepoint rule is the structural defence: a
  single call site means injection mitigations need to be applied exactly once.
- **LLM outputs that drive actions must be validated.** An LLM output is a
  suggestion from an untrusted channel, not a verified instruction. Parse and
  validate the structure before acting on it; reject anything outside the
  expected schema. The requirements-engineer's propose/confirm gate is the
  reference pattern — any project where an LLM output triggers a write,
  deletion, or external call needs an equivalent structural guard, not just a
  prompt instruction to "be careful".

## Error handling

- **Every error state is designed, not accidental.** Errors surface in place
  with a recoverable action — never silent, never navigating the user away.
  This applies at every layer: API error responses, mobile error states, worker
  failures, CLI output. "It probably won't fail" is not a failure mode.
- **Caught exceptions log the error shape, not the raw input.** Exception catch
  sites are as likely to contain PII as any other code path — a request body,
  a receipt scan, a user message. Log the error type and a safe context
  description; never the raw input or user-supplied content.
- **Every async operation has an explicit error path.** Unhandled promise
  rejections, uncaught async exceptions, and silently swallowed errors are
  defects, not edge cases. If a code path can fail, the failure must be handled
  and logged — even if the only handling is "log and surface a generic message."

## Scope and refactoring

- **Implement exactly what was requested.** No "while I'm here" refactors.
  If you spot something else worth doing, mention it and stop. The Gate
  version of this is `scope_expansion` (Increment 3, Week 3) — this
  principle is the spirit.
- **Refactor only after it works.** Make the change pass tests first;
  restructure second. Refactoring mid-feature loses the thread for both the
  agent and the human reviewing it.
- **Vertical slices over horizontal layers.** Prefer work that goes
  end-to-end and is demonstrable over building a whole layer that can't be
  exercised yet. Thin slices surface unknowns early; horizontal layers
  defer integration risk to the worst moment. The interview-me interview asks
  this; this principle is the spirit.

## UI

- **Components own their styling.** Never reach into a parent or sibling.
  Communicate via props/inputs and events/callbacks. The mechanical version
  of this is the design-token Invariants (`design_tokens_only`,
  `view_size_limit`); this principle is the spirit.
- **A mutation owns the screens it changes.** Every create/update/delete
  must refresh the views that show its data (invalidate / revalidate /
  context-save) — at every cache layer, not just the query layer. A mutation
  with no refresh path is a stale-screen bug. The interview-me UI branch asks
  this; this principle is the spirit.
- **Every async surface handles loading, error, and empty** — not just the
  happy path. Errors recover in place; they never navigate the user away.

The broader, durable guidance — mutation→UI contract, state handling,
feedback, navigation feel, perceived performance, accessibility — lives in
[`UI_UX_GUIDELINES.md`](UI_UX_GUIDELINES.md). Read it when doing UI work.
It is guidance, not enforcement: UI quality is judgment, and the session's
recurring lesson is that mechanically "checking" judgment produces noise.

---

## Enforcement hygiene

These principles address a specific class of failure the org has repeated across projects.
Each has a corresponding enforcement rule in `org-defaults.yml`; the principle here is
the *why*, the rule there is the *how*.

- **Prose-only invariants are not invariants.** Any rule that would cause a real bug if
  violated must have a mechanical enforcement path — a check, a gate, a hook, or an
  interview-me question that fires before code is written. CLAUDE.md prose is a reminder,
  not enforcement. If a rule has been violated more than once, it must graduate to a
  check or gate via `propose_claude_md_rule`. A rule written down but not enforced gives
  false confidence: the team believes the guardrail exists; the agent doesn't see it.

- **Quality thresholds have a direction.** Any threshold set below the org default
  (`unit_min: 80`, `integration_min: 40`) must include a target date and increment in
  the config comment. New code in a PR must individually meet the org default even if
  the project aggregate is below it — you cannot borrow coverage headroom from existing
  code to ship new code undertested. A threshold frozen at "current baseline" is a
  threshold that will never rise.

- **If a document governs all work, it must be loaded at session start.** Any file
  that claims to apply to every task in a project must appear in `context_pointers`.
  If it isn't loaded when the agent starts, it doesn't govern anything — agents follow
  rules they read, not rules that exist somewhere in the repo. The discipline: when you
  write "this applies to ALL work", immediately check that the file is in
  `context_pointers`.

- **A multi-site fix must be followed by a check.** When a bug is fixed across
  multiple files in a single cleanup commit, that is proof the pattern will recur —
  another agent, another file, the same mistake. The fix must be followed (in the same
  PR or the next) by a check, hook, or interview-me question that would have caught
  the original violation. Otherwise the next agent writing that pattern restarts the
  cycle. "We fixed it in the code" and "we prevented it from coming back" are two
  different things.

---

## How to use principles in practice

- When two enforceable rules conflict, principles are the tie-breaker.
- When no rule covers a situation, principles inform the judgement call.
- If you find yourself repeatedly invoking a principle to justify a
  decision, that's signal — consider proposing a Practice or Gate via
  `propose_claude_md_rule`. Repeated invocation means the principle should
  probably be promoted.

## What is NOT a principle

If a rule can be mechanically checked, it's an Invariant, not a Principle.
If a rule defines a workflow checkpoint, it's a Gate. If a rule is
observable in records, it's a Practice. Principles are reserved for the
genuinely unenforceable.
