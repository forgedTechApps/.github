# Three-Tier Model Enforcement

**Date:** 2026-07-14  
**Status:** Approved for implementation  

## Problem

The agent-standards framework documents a three-tier model routing system (planning → Opus, execution → Sonnet, lightweight → Haiku) but enforcement has two gaps:

1. **Two missing tiers.** Complex cross-file refactoring and deep analysis tasks (stranger review, security review, threat modeling) have no designated phase or model. Agents doing these on Sonnet miss the reasoning ceiling that Fable 5 provides.
2. **No fallback chain.** If the primary model for a phase isn't available, there's no declared acceptable alternative — the gate either blocks or passes silently with no signal.

Additionally, concrete model IDs in `CLAUDE.md.template` are pinned to specific versions (`claude-opus-4-7`) rather than the latest of each family.

## Design

### 1. Schema changes (3 surfaces — must stay in sync)

**`mcp-server/src/standards.ts`:**

```ts
export type ModelFamily = "fable" | "opus" | "sonnet" | "haiku";

export interface ModelSpec {
  model: ModelFamily;
  effort?: "low" | "medium" | "high";
  fallback?: ModelFamily[];   // ordered: first match wins
}

export type Phase = "planning" | "execution" | "refactor" | "analysis";
```

`AgentStandards.models` adds `refactor?: ModelSpec` and `analysis?: ModelSpec`.

`classifyModel` adds: `if (n.includes("fable")) return "fable"` (before the existing checks).

**`agent-standards/defaults/org-defaults.yml`:**

```yaml
models:
  planning:
    model: opus
    effort: medium
    fallback: [sonnet]
  execution:
    model: sonnet
    fallback: [opus]
  refactor:
    model: fable
    effort: medium
    fallback: [opus, sonnet]
  analysis:
    model: fable
    effort: medium
    fallback: [opus, sonnet]
```

**`agent-standards/schema/` (JSON Schema):** update `ModelSpec` definition (`model` enum adds `"fable"`, `fallback` array added) and `Phase` enum to match.

---

### 2. Enforcement logic in `task-tracking.ts`

New helper extracted for testability:

```ts
function checkModelAlignment(
  declared: ModelFamily | null,
  spec: ModelSpec
): { ok: boolean; isFallback: boolean; message?: string }
```

Logic:
1. Build acceptable set: `[spec.model, ...(spec.fallback ?? [])]`
2. If `declared` is null → `{ ok: true, isFallback: false }` (advisory; existing tip fires separately)
3. If `declared` in acceptable set:
   - primary match → `{ ok: true, isFallback: false }`
   - fallback match → `{ ok: true, isFallback: true, message: "Running on fallback model '${declared}' (primary: '${spec.model}'). Results may be less thorough." }`
4. If `declared` not in acceptable set → `{ ok: false, message: "Phase '${phase}' requires one of [${acceptableSet.join(', ')}]; you are running '${declared}'." }`

The `proposeChange` model check (which re-reads `task.declared_model`) inherits the fix automatically once `checkModelAlignment` is used there too.

---

### 3. Model ID currency in `CLAUDE.md.template`

The model routing table updates to current latest and adds the two new tiers:

| Logical | Concrete (today) | Effort |
|---|---|---|
| `fable`  | `claude-fable-5`            | medium |
| `opus`   | `claude-opus-4-8`           | medium |
| `sonnet` | `claude-sonnet-4-6`         | (default) |
| `haiku`  | `claude-haiku-4-5-20251001` | (default) |

Note added: *"Use the latest available version of each family. Update this table when a new version ships — `classifyModel` matches by substring, so `claude-opus-4-9` works without a code change."*

The session workflow steps update to show `refactor` and `analysis` phases alongside `planning` and `execution`.

`classifyModel` is already version-agnostic (substring match). `org-defaults.yml` uses logical names. No changes needed in either.

---

### 4. Testing

New fixture directories in `mcp-server/src/__tests__/`:

| Fixture | What it tests |
|---|---|
| `start-task/refactor-fable-ok/` | `phase: "refactor"`, `current_model: "claude-fable-5"` → allowed, no tip |
| `start-task/refactor-opus-fallback/` | `phase: "refactor"`, `current_model: "claude-opus-4-8"` → allowed, fallback tip fires |
| `start-task/refactor-sonnet-blocked/` | `phase: "refactor"`, `current_model: "claude-sonnet-4-6"` → blocked |
| `start-task/analysis-fable-ok/` | `phase: "analysis"`, `current_model: "claude-fable-5"` → allowed |
| `start-task/analysis-opus-fallback/` | `phase: "analysis"`, `current_model: "claude-opus-4-8"` → allowed, fallback tip |

Unit tests for `checkModelAlignment`:
- Primary match → `isFallback: false`
- First fallback match → `isFallback: true`, correct message
- Second fallback match → `isFallback: true`
- Out-of-set declared → `ok: false`
- Null declared → `ok: true, isFallback: false`

One existing fixture update: `planning-wrong-model` block message now references acceptable set format.

---

## Out of scope

- Haiku as a declared phase (it's a subagent dispatch target, not a session phase)
- Automatic model switching (the MCP can't change the running model — it can only block or tip)
- Per-project fallback overrides in `.agent-standards.yml` (inherits from `org-defaults`; project can override the full `models` block if needed — no new mechanism required)
- Tracking which fallback was used in the audit log (the `task_started` event already records `declared_model`)

## Files changing

| File | Change |
|---|---|
| `mcp-server/src/standards.ts` | Add `fable` to `ModelFamily`, `fallback` to `ModelSpec`, expand `Phase`, update `classifyModel` |
| `mcp-server/src/task-tracking.ts` | Extract `checkModelAlignment`, use it in `startTask` and `proposeChange` model checks |
| `agent-standards/defaults/org-defaults.yml` | Add `refactor` and `analysis` phases with fallback chains, update `planning`/`execution` with fallbacks |
| `agent-standards/schema/` | Update JSON Schema: `ModelSpec`, `Phase` enum |
| `agent-standards/templates/CLAUDE.md.template` | Update model table (add fable, update IDs to latest), add `refactor`/`analysis` to workflow steps |
| `mcp-server/src/__tests__/start-task/refactor-fable-ok/` | New fixture |
| `mcp-server/src/__tests__/start-task/refactor-opus-fallback/` | New fixture |
| `mcp-server/src/__tests__/start-task/refactor-sonnet-blocked/` | New fixture |
| `mcp-server/src/__tests__/start-task/analysis-fable-ok/` | New fixture |
| `mcp-server/src/__tests__/start-task/analysis-opus-fallback/` | New fixture |
| `mcp-server/src/__tests__/start-task/planning-wrong-model/` | Update expected block message |
| `mcp-server/src/__tests__/check-model-alignment.test.ts` | New unit test file |
