---
name: to-issues
description: |
  Decompose a PRD (or a clear feature spec) into thin, vertical-slice GitHub
  issues that an agent can implement one at a time. Use when the user says
  "break this into issues", "decompose the PRD", "create the tickets", or after
  to-prd has produced a PRD. Produces actionable, independently-buildable work
  items — not a horizontal layer-by-layer task list.
---

# To-Issues — decompose a PRD into vertical slices

A PRD describes the destination; issues are the journey. This skill turns a PRD
(or a clear spec) into a set of GitHub issues an agent can pick up and build —
each a **thin vertical slice** that cuts end-to-end, not a horizontal layer.

**It completes the pipeline:** grill-me (interview) → to-prd (requirements) →
**to-issues** (buildable slices).

## When to use

- After to-prd, to turn the PRD into tickets.
- When a user has a clear spec and wants it decomposed into work items.

Skip it when the work is a single slice already — one grill-me scope is the
issue; decomposing it adds overhead.

## The core principle: vertical slices, not horizontal layers

This is the whole point, and it's an org principle (PRINCIPLES.md, the grill-me
vertical-slice branch). **Each issue should cut through all layers** — UI/API →
logic → data — and be demonstrable on its own. NOT "do all the schema", then
"do all the API", then "do all the UI" (horizontal layers defer integration risk
to the worst moment and produce nothing exercisable until the end).

A good slice:
- Is **independently buildable and demonstrable** — closing it shows a working
  thin path, however narrow.
- **Surfaces unknowns early** — order slices so the riskiest/least-understood
  one comes first, not last.
- Is **small enough for one focused task** (~the 3–5 chunk rule) but **whole
  enough to exercise end-to-end**.

## Process

1. **Locate and read the PRD.** Fetch the issue or `docs/prd/` file. If there's
   no PRD and the spec is thin, that's a to-prd gap — go back.
2. **Analyse the codebase structure** so slices land in the real architecture
   (grep-verify the paths the PRD references).
3. **Cut vertical slices.** For each user story (or group), define the thinnest
   end-to-end path that delivers observable value. Name the files each touches
   (GCOE's "E" — point at the concrete code to mirror).
4. **Order by risk + dependency.** Riskiest/unknown-surfacing slices first.
   Establish blocking relationships only where genuinely sequential — independent
   slices can run in parallel.
5. **File the issues** (`gh issue create`), each with: title, the user story +
   acceptance criteria, the files in scope, the test approach, and a link back to
   the PRD. Set `blocks`/`blocked-by` where real. Confirm before creating.

## Issue template

```markdown
# <slice title — a thin end-to-end capability>

**From PRD:** <link>

**User story:** As a <role>, I want <capability>, so that <benefit>.

**Acceptance:** GIVEN <context> WHEN <action> THEN <outcome>.

**Vertical slice:** <the end-to-end path this cuts — UI→logic→data, and what's
demonstrable when it's done.>

**Files in scope:** `path/...`, `path/...` (grep-verified)

**Test approach:** <unit/integration/e2e — what proves it works>

**Out of scope for this slice:** <what's deliberately left to another slice>

**Depends on:** #NN | none
```

## What this skill does NOT do

- It doesn't write code — it produces the issues that scope the code.
- It doesn't create horizontal-layer tickets ("the schema", "the API") — if you
  catch yourself doing that, re-cut vertically.
- It doesn't silently drop PRD requirements — every user story maps to at least
  one slice, or you note why it's deferred.

## Next

Each issue is now a grill-me-able unit: pick one up, run the interview against
its acceptance criteria, build the slice, verify, merge. The pipeline closes.
