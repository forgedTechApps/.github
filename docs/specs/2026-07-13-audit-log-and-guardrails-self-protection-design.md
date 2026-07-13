# Audit Log + Guardrails Self-Protection

**Date:** 2026-07-13  
**Status:** Approved for implementation  
**Approach:** Option A — two separate, minimal additions

## Problem

Two gaps identified against the org's AI guardrails framework:

1. **No append-only audit log.** MCP gates append timestamped notes to each `TaskRecord`, but that's a 50-task rolling buffer in a gitignored file. Bypass events (trivial skips, scope expansions, gate outcomes) are lost after 50 tasks. There is no durable, session-visible record of agent decisions.

2. **No self-protecting guardrails.** `sensitive_paths` is declared in `.agent-standards.yml`, but nothing enforces a review requirement when those paths are touched. A PR that modifies `.github/workflows/**` or `mcp-server/src/**` can be merged without any label or senior-review gate.

## Design

### 1. Audit Log

**Module:** `mcp-server/src/audit-log.ts`

Single exported function:

```ts
appendAuditEvent(repoRoot: string, event: AuditEvent): Promise<void>
```

Appends one JSONL line to `.agent-standards-audit.jsonl` in the repo root. Never throws — errors are silently swallowed so a logging failure never blocks the gate that triggered it.

**Event schema:**

```ts
interface AuditEvent {
  ts: string;                        // ISO 8601 timestamp
  kind: AuditEventKind;
  task_id?: string;
  detail: Record<string, unknown>;   // kind-specific payload
}

type AuditEventKind =
  | "task_started"        // start_task called (includes phase, model, task_type)
  | "trivial_bypass"      // size: 'trivial' declared (logs description)
  | "propose_change"      // every propose_change call + outcome (allowed/blocked)
  | "gate_fired"          // a gate blocked propose_change (scope, auth, uncertainty)
  | "expand_scope"        // scope expanded with user_confirmed=true
  | "surface_uncertainty" // uncertainty surfaced or resolved
```

**Call sites in `task-tracking.ts`:**

| Function | Event(s) emitted |
|---|---|
| `start_task` (standard) | `task_started` |
| `start_task` (trivial path) | `task_started` + `trivial_bypass` |
| `propose_change` (allowed) | `propose_change` (outcome: allowed) |
| `propose_change` (blocked by any gate) | `propose_change` (outcome: blocked) + `gate_fired` per block |
| `expand_scope` | `expand_scope` |
| `surface_uncertainty` (surfaced) | `surface_uncertainty` (action: surfaced) |
| `surface_uncertainty` (resolved) | `surface_uncertainty` (action: resolved) |

**Storage:** `.agent-standards-audit.jsonl` — gitignored, append-only, no rotation. Lives alongside `.agent-standards-tasks.json`.

**`.gitignore`:** add `.agent-standards-audit.jsonl`.

**Drift log integration:** `getDriftLog` in `drift-log.ts` reads the audit file, counts events by kind, and prepends a summary paragraph:

```
Audit log: 42 events — 12 task_started, 3 trivial_bypass, 18 propose_change (2 blocked), 4 gate_fired, 3 expand_scope, 2 surface_uncertainty
```

**New MCP tool: `get_audit_log`**

Thin wrapper: reads `.agent-standards-audit.jsonl`, returns parsed events array + count-by-kind summary. Args: `repo_root`, optional `limit` (default 100, most recent).

---

### 2. Guardrails CI

**New file:** `.github/workflows/guardrails-check.yml`

**Trigger:**
```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, labeled, unlabeled]
```

`labeled`/`unlabeled` ensures the check re-runs when the label is added — no forced commit needed to unblock.

**Permissions:** `contents: read` only. Label data comes from `github.event.pull_request.labels` (event payload, no API call).

**Job logic:**
1. Checkout repo
2. Get changed files: `git diff --name-only origin/${{ github.base_ref }}...HEAD`
3. Read `sensitive_paths` globs from `.agent-standards.yml` (inline shell grep — same zero-dep pattern as `session-start.mjs`)
4. Match changed files against each glob using bash glob matching
5. If any match AND `guardrails-change` label is absent → `exit 1` with message listing which sensitive paths were touched
6. Otherwise → `exit 0`

**Pattern:** mirrors `mcp-ci.yml` — same `actions/checkout`, pure shell, no pnpm/node.

**CLAUDE.md update:** one line added to the "Merge gate" section noting the `guardrails-change` label requirement.

---

### 3. Testing

**Audit log — new fixture dirs in `mcp-server/src/__tests__/`:**

| Fixture | What it tests |
|---|---|
| `audit-log-basic/` | `start_task` → `propose_change` produces `task_started` + `propose_change` events |
| `audit-log-trivial-bypass/` | `start_task` with `size: 'trivial'` produces `trivial_bypass` event |
| `audit-log-gate-fired/` | `propose_change` against out-of-scope path produces `gate_fired` event |
| `get-audit-log-tool/` | Pre-seeded JSONL → tool returns correct count-by-kind summary |

Each fixture follows the existing harness pattern: temp dir, pre-seeded files, tool call, assert JSONL file contents.

**Drift log integration:** extend existing `get-drift-log` fixture with a pre-seeded `.agent-standards-audit.jsonl` and assert the audit summary appears in tool output.

**Guardrails CI:** no unit test for the shell script. Logic is simple enough that misconfiguration surfaces on first real PR. `shellcheck` can be added later if the script grows.

---

## Out of scope

- Agent-writable `append_audit_event` MCP tool (would undermine log integrity)
- Committing audit log to git (pollutes history; local durability is sufficient)
- Audit log rotation or size cap (indefinite retention is the point)
- Warning-only guardrails CI mode (soft nudge gets ignored; hard fail is the requirement)
- Extending the guardrails check to non-PR contexts (direct push to main is already blocked by branch protection)

## Files changing

| File | Change |
|---|---|
| `mcp-server/src/audit-log.ts` | New module |
| `mcp-server/src/task-tracking.ts` | Add `appendAuditEvent` call sites |
| `mcp-server/src/drift-log.ts` | Read audit file, prepend summary |
| `mcp-server/src/server.ts` | Register `get_audit_log` tool |
| `mcp-server/src/__tests__/audit-log-basic/` | New fixture |
| `mcp-server/src/__tests__/audit-log-trivial-bypass/` | New fixture |
| `mcp-server/src/__tests__/audit-log-gate-fired/` | New fixture |
| `mcp-server/src/__tests__/get-audit-log-tool/` | New fixture |
| `mcp-server/src/__tests__/get-drift-log/` | Extend existing fixture |
| `.github/workflows/guardrails-check.yml` | New workflow |
| `.gitignore` | Add `.agent-standards-audit.jsonl` |
| `CLAUDE.md` | Add guardrails-change label note to Merge gate section |
