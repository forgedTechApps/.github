---
name: handoff
description: |
  Produce a structured handoff so a fresh session (or another agent) can resume
  work without re-reading the whole conversation. Use when context is getting
  long and you're about to /clear or /compact, when ending a session mid-task,
  or when the user says "hand this off", "write a handoff", "summarise where we
  are", or "I'll continue this later". The output is a resume-doc, not a recap.
---

# Handoff — structured state transfer between sessions

A long session accumulates context that the next session pays to re-read every
turn. The token-efficient move is `/clear` at task boundaries — but clearing
loses the *state* (what's done, what's in flight, what the open decisions are).
A handoff captures that state in a small, durable doc so the next session
resumes cold without the cost of the full history.

**A handoff is a resume-doc, not a transcript summary.** It answers "what does
the next session need to *act*?" — not "what happened?".

## When to use

- Context is long and you're about to `/clear` or the harness is about to
  `/compact` (the org practice prefers `/clear` between unrelated tasks).
- Ending a work session with a task still in flight.
- Passing work to another agent or teammate.
- The user asks to hand off, pause, or resume later.

Skip it for a finished, self-contained task with nothing in flight — there's
nothing to resume.

## Where it goes

Write to a durable, findable location — default
`docs/handoffs/HANDOFF-<task-or-date>.md` in the repo, or the path the user
names. Committed if the work is shared; local if it's personal scratch. Tell the
user the path so they can point the next session at it.

## The contract — what a handoff MUST contain

Keep it short. Each section is a few lines, not paragraphs. If a section is
empty, say "none" — don't pad.

1. **Goal** — the one-sentence objective of the work. What "done" looks like.
2. **State** — done / in-progress / not-started, as a tight list. Mark the *one*
   thing currently in flight clearly; that's where the next session starts.
3. **Open PRs / branches** — number, repo, what each contains, merge state.
   Stale local branches and which branch each repo is *on* — the next session
   shouldn't guess.
4. **Open decisions** — anything awaiting the user's call, or a judgment not yet
   made. These block progress; surface them first.
5. **Key files + entry point** — the 3–8 files that matter and the *one* place to
   start reading. Paths, not descriptions. (This is GCOE's "E" for the next
   session — point at the concrete code, don't describe it.)
6. **Gotchas / constraints** — anything non-obvious the next session would
   otherwise rediscover the hard way: a footgun hit, a flaky command, a
   user instruction ("don't push without asking"), a verified fact ("the env var
   DOES expand in .mcp.json").
7. **Verification** — how the next session confirms the work so far is sound, and
   how it'll know the remaining work is done (the command to run, the test, the
   check).
8. **Next concrete step** — the single most actionable thing to do next, specific
   enough to start immediately. Not "continue the work" — "edit X to do Y, then
   run Z".

## What a handoff is NOT

- Not a play-by-play of the conversation. The next session doesn't need the
  journey, only the current position + the next move.
- Not a context dump. If it's as long as re-reading the transcript, it failed.
  Aim for something scannable in under a minute.
- Not aspirational. Record what's *actually* true and done (run the verification
  before claiming "done"), not what you intended.

## Template

```markdown
# Handoff: <goal in a few words> — <date>

**Goal:** <one sentence>

**State:**
- ✅ <done>
- 🔄 <in flight — START HERE>
- ⬜ <not started>

**Open PRs / branches:**
- #NN <repo> — <what> (<mergeable | merged | conflicting>)
- <repo> on branch <X>; stale: <branches to clean>

**Open decisions (block progress):**
- <decision awaiting user> | none

**Key files (entry point first):**
- `path/to/start/here.ts` — <why it's the entry>
- `path/...`

**Gotchas:**
- <non-obvious thing> | none

**Verification:**
- Done-so-far is sound when: `<command>` → <expected>
- Remaining work is done when: <observable outcome>

**Next concrete step:**
<one specific, immediately-actionable instruction>
```

## After writing

- Tell the user the path and that they can `/clear` and point the next session
  at it.
- If anything in the handoff is *asserted* (tests pass, PR is green), verify it
  first — a handoff that says "all green" when it isn't sends the next session
  down a wrong path. Evidence before assertions.
