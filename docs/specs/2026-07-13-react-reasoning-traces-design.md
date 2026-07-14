# ReAct Reasoning Traces

**Date:** 2026-07-13  
**Status:** Approved for implementation  
**Approach:** Option A — extend existing gate calls with a `thought` field

## Problem

When an agent makes a mistake during execution, the current tooling shows *what* happened (git diff, audit log, gate outcomes) but not *why* — the reasoning that led to the wrong action is invisible. By the time implementation tests catch the mistake, the reasoning trail is cold. Diagnosis requires reverse-engineering intent from artifacts.

This applies org-wide across all projects using the agent-standards MCP server.

## Design

### 1. ReAct Trace Module

**New file:** `mcp-server/src/react-log.ts`

Same shape as `audit-log.ts` — fire-and-forget append, never throws.

```ts
interface ReactEntry {
  ts: string;
  kind: "start_task" | "propose_change" | "expand_scope";
  task_id: string;
  thought?: string;         // agent-declared — absent if not provided
  action: {
    description: string;    // what the agent is about to do
    paths?: string[];       // for propose_change / expand_scope
  };
  observation: {
    outcome: "allowed" | "blocked" | "warned";
    codes: string[];        // finding codes, e.g. ["TASK_PROPOSE_OK"]
    summary: string;        // first finding message, truncated to 200 chars
  };
}
```

**Storage:** `.agent-standards-react.jsonl` — gitignored, append-only, no rotation. Lives alongside `.agent-standards-tasks.json` and `.agent-standards-audit.jsonl`.

**New MCP tool: `get_react_log`**

Args: `repo_root`, `limit` (default 50, most recent), optional `task_id` (filter to one task).

Returns:
```ts
{
  total: number;
  thought_coverage: number;   // % of entries with a declared thought (0–100)
  entries: ReactEntry[];
}
```

### 2. Gate Wiring

`thought?: string` added to three gate call args. The distinction from existing fields:

| Gate | Existing field | New `thought` field |
|---|---|---|
| `start_task` | `hypothesis` — what the agent expects to change | Why the agent believes its hypothesis is correct |
| `propose_change` | `rationale` — what the agent is doing | Why the agent believes this specific write is the right next step |
| `expand_scope` | `reason` — why scope is expanding | Why the agent believes the original scope was wrong |

Example: `rationale: "add audit event call site"` describes the action. `thought: "task-tracking.ts is the only place propose_change fires so this covers all call sites"` exposes the belief that could be wrong — and is exactly what you'd want to read when that belief turns out to be false.

**Warning on absent thought:** when `thought` is omitted, the gate appends to its findings:

```json
{
  "severity": "warn",
  "code": "REACT_NO_THOUGHT",
  "message": "No thought declared — reasoning trace will have a gap at this decision point. Pass thought='<why you believe this is correct>' to enable post-mortem diagnosis."
}
```

This is a warning, not a block. The gate proceeds normally. Frequent `REACT_NO_THOUGHT` warnings surface in `get_react_log`'s `thought_coverage` field.

### 3. `.gitignore`

Add `.agent-standards-react.jsonl`.

### 4. Testing

**New file:** `mcp-server/src/__tests__/react-log.test.ts` — standalone `node:test` unit tests, mirroring `audit-log.test.ts`.

| Test | Assertion |
|---|---|
| `appendReactEntry` writes JSONL | entry fields present and parseable |
| `thought` present → no `REACT_NO_THOUGHT` | gate response has no warn finding with that code |
| `thought` absent → `REACT_NO_THOUGHT` warn | finding present, severity warn, gate not blocked |
| `get_react_log` returns entries + thought_coverage | 2/3 thoughts → 67% coverage |
| `get_react_log` filters by task_id | only matching entries returned |
| `get_react_log` respects limit | returns N most recent |
| `appendReactEntry` does not throw on bad repo path | fire-and-forget confirmed |

**Gate integration:** two additional tests in `react-log.test.ts` that call `proposeChange` directly — one with `thought` declared, one without — asserting `REACT_NO_THOUGHT` presence/absence in the returned findings.

## Out of scope

- Full tool-call level tracing (every MCP call, not just decision points)
- Real-time streaming of thoughts to terminal
- Hard-blocking on absent `thought` (warn only on rollout)
- Agent-writable `record_thought` tool (thoughts flow through gate calls, not standalone)
- Parsing free-form session logs

## Files changing

| File | Change |
|---|---|
| `mcp-server/src/react-log.ts` | New module |
| `mcp-server/src/task-tracking.ts` | Add `thought?` to `StartTaskArgs`, `ProposeChangeArgs`, `ExpandScopeArgs`; wire `appendReactEntry` + `REACT_NO_THOUGHT` warn |
| `mcp-server/src/server.ts` | Add `thought` field to Zod schemas + tool descriptors; register `get_react_log` tool |
| `mcp-server/src/__tests__/react-log.test.ts` | New unit tests |
| `.gitignore` | Add `.agent-standards-react.jsonl` |
