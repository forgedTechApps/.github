---
name: to-prd
description: |
  Turn an explored idea or a grill-me interview into a Product Requirements
  Document — filed as a GitHub issue (or a docs/prd/ file). Use when the user
  says "write a PRD", "turn this into a spec", "document these requirements",
  or after a grill-me/brainstorm has surfaced enough to crystallise. Produces a
  durable requirements artifact, not code.
---

# To-PRD — crystallise requirements into a durable artifact

A conversation explores; a PRD commits. This skill takes the shared
understanding from a grill-me interview or a brainstorm and writes it down as a
Product Requirements Document — the durable contract the work is judged against.

**It pairs with grill-me and to-issues.** grill-me interviews until the scope is
clear → **to-prd** writes the requirements → to-issues decomposes them into
buildable slices. Each stage skips redundant work if the previous one was done
thoroughly.

## When to use

- After grill-me or brainstorming, when the idea is understood well enough to
  document.
- When the user wants a spec/PRD before implementation.
- When a piece of work is big enough that "just build it" would lose the thread
  — a PRD is the anchor.

Skip it for small, well-understood changes — a grill-me scope statement is
enough; a PRD would be ceremony.

## Process

1. **Start from what exists.** If a grill-me interview just ran, reuse its
   outputs (goal, scope, out-of-scope, files). Don't re-interview. If not, ask
   the user for a detailed description first.
2. **Explore the repo to ground claims.** Validate that referenced routes,
   models, and patterns actually exist (the org rule: grep-verify paths, don't
   assert from intuition). A PRD that cites a non-existent endpoint is worse than
   none.
3. **Sketch the major modules** the work touches — the architectural shape, not
   the line-level design.
4. **Write the PRD** (template below). Center it on **user stories** with
   acceptance criteria — written so an implementing agent can act on them.
5. **File it.** Default: a GitHub issue (`gh issue create`), so it's trackable
   and to-issues can decompose it. Alternative: `docs/prd/<name>.md` if the user
   prefers a file. Confirm before creating outward-facing artifacts.

## PRD template

```markdown
# PRD: <feature name>

## Problem
<What's broken or missing, for whom, and why it matters. One paragraph.>

## Goal & non-goals
- **Goal:** <the observable outcome that means success>
- **Non-goals:** <explicitly out of scope — the antidote to "while I'm here">

## User stories
- As a <role>, I want <capability>, so that <benefit>.
  - **Acceptance:** GIVEN <context> WHEN <action> THEN <outcome>.
  - (repeat — each story independently testable)

## Architecture sketch
<The major modules/files involved and how they connect. Grep-verified paths.
Not line-level design — the shape.>

## Constraints & invariants
<Project rules this must honour (from .agent-standards.yml / CLAUDE.md):
tenant isolation, design tokens, auth/ASVS, the relevant load-bearing rules.>

## Open questions
<Anything unresolved that needs a decision before or during build.>

## Definition of done
<The acceptance criteria rolled up: tests, observable outcomes, the readiness
posture if this is deploy-bound.>
```

## What this skill does NOT do

- It doesn't write code. The PRD is the whole job.
- It doesn't invent requirements the user didn't agree to — if the scope is
  unclear, that's a grill-me gap; go back and interview, don't guess.
- It doesn't duplicate a grill-me scope for a small task — use judgment about
  when a full PRD earns its weight.

## Next

Once the PRD exists, **to-issues** decomposes it into thin vertical-slice issues
ready for implementation.
