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
  defer integration risk to the worst moment. The grill-me interview asks
  this; this principle is the spirit.

## UI

- **Components own their styling.** Never reach into a parent or sibling.
  Communicate via props/inputs and events/callbacks. The mechanical version
  of this is the design-token Invariants (`design_tokens_only`,
  `view_size_limit`); this principle is the spirit.
- **A mutation owns the screens it changes.** Every create/update/delete
  must refresh the views that show its data (invalidate / revalidate /
  context-save) — at every cache layer, not just the query layer. A mutation
  with no refresh path is a stale-screen bug. The grill-me UI branch asks
  this; this principle is the spirit.
- **Every async surface handles loading, error, and empty** — not just the
  happy path. Errors recover in place; they never navigate the user away.

The broader, durable guidance — mutation→UI contract, state handling,
feedback, navigation feel, perceived performance, accessibility — lives in
[`UI_UX_GUIDELINES.md`](UI_UX_GUIDELINES.md). Read it when doing UI work.
It is guidance, not enforcement: UI quality is judgment, and the session's
recurring lesson is that mechanically "checking" judgment produces noise.

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
