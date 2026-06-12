---
name: writing-plans
description: Use when you already have an approved spec or clear requirements and want a detailed step-by-step implementation plan doc before coding. Standalone — does not replace brainstorming (which routes to interview-me) or interview-me (which calls start_task). Invoke directly when a plan document is explicitly wanted.
---

# Writing Plans

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for our codebase and questionable taste. Document everything they need: which files to touch, actual code, test commands, expected output, how to verify. Bite-sized tasks. DRY. YAGNI. TDD. Frequent commits.

**Announce at start:** "I'm using the writing-plans skill to create the implementation plan."

**Save plans to:** `docs/plans/YYYY-MM-DD-<feature-name>.md`

## Scope Check

If the spec covers multiple independent subsystems, suggest breaking into separate plans — one per subsystem. Each plan should produce working, testable software on its own.

## File Structure

Before defining tasks, map which files will be created or modified.

- One clear responsibility per file; well-defined interfaces between them
- Files that change together live together — split by responsibility, not layer
- Follow existing patterns in the codebase; don't unilaterally restructure
- This repo's test harness: `mcp-server/src/__tests__/<check-name>/` with fixture dirs + `expected.json`

## Bite-Sized Task Granularity

**Each step is one action (2–5 minutes):**
- "Write the failing test" — step
- "Run it to confirm it fails" — step
- "Write minimal implementation" — step
- "Run tests, confirm pass" — step
- "Commit" — step

## Plan Document Header

**Every plan MUST start with:**

```markdown
# [Feature Name] Implementation Plan

**Goal:** [One sentence]

**Architecture:** [2–3 sentences on approach]

**Tech stack:** pnpm workspace, TypeScript, Node test runner, fixture-based harness

---
```

## Task Structure

````markdown
### Task N: [Component Name]

**Files:**
- Create: `exact/path/to/file.ts`
- Modify: `exact/path/to/existing.ts`
- Test: `mcp-server/src/__tests__/<name>/01-case/` + `expected.json`

- [ ] **Step 1: Write the failing test**

```typescript
// fixture: mcp-server/src/__tests__/<name>/01-case/some-file.ts
// expected.json: { "findings": [...] }
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm --filter ./mcp-server test
```
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// actual code here — no placeholders
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
pnpm --filter ./mcp-server test
```
Expected: PASS

- [ ] **Step 5: Lint**

```bash
pnpm --filter ./mcp-server lint
```

- [ ] **Step 6: Commit**

```bash
git add <files>
git commit -m "feat(<scope>): <description>"
```
````

## No Placeholders

Every step must contain what an engineer actually needs. These are **plan failures**:
- "TBD", "TODO", "implement later"
- "Add appropriate error handling" without showing the code
- "Write tests for the above" without fixture content
- "Similar to Task N" — repeat the code, task order is not guaranteed
- Steps describing what to do without showing how

## Self-Review

After writing the complete plan:

1. **Spec coverage** — can you point to a task for each requirement? List gaps.
2. **Placeholder scan** — search for any pattern from "No Placeholders" above. Fix them.
3. **Type consistency** — do method signatures in later tasks match what earlier tasks define?

Fix inline. No need to re-review — just fix and move on.

## Execution Handoff

After saving the plan, ask:

> "Plan saved to `docs/plans/<filename>.md`. Execute inline (main loop, sequential tasks) or via subagent-driven-development (fresh subagent per task, review checkpoints)?"

- **Inline:** work through tasks in this session
- **Subagent-driven:** invoke the `subagent-driven-development` skill

## Remember

- Exact file paths always
- Complete code in every step — if a step changes code, show the code
- Exact commands with expected output
- DRY, YAGNI, TDD, frequent commits
- For this repo: `pnpm --filter ./mcp-server <cmd>`, fixture harness, `tsc --noEmit` for lint
