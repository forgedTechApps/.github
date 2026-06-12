---
name: debugging
description: Use when investigating or fixing a bug. Enforces hypothesis-first discipline, one-variable-at-a-time fixing, and mandatory escalation after three failed attempts.
---

# Debugging

Agents thrash on bugs when they jump to fixes without a hypothesis, bundle multiple changes, and never stop to question a failing approach. This skill enforces the three org debugging practices: `hypothesis_before_fix`, `fix_one_variable`, `three_strikes_escalate`.

## Hard rules

1. **No code change before a written hypothesis.** If you can't state the observed behaviour, suspected root cause, and predicted fix in one sentence each — you are not ready to write code.
2. **One variable per attempt.** Change one thing, run the tests, read the result. If the hypothesis was wrong, form a new one before the next attempt. No bundled patches.
3. **Three failed attempts = mandatory stop.** Do not attempt fix #4 without first documenting the three attempts and declaring a new direction. Escalate to the user if you're still stuck.

## Process

### Step 1 — write the hypothesis (required before any code)

Answer these three questions out loud before touching a file:

- **Observed behaviour:** what exactly happens? (error message, wrong output, crash site)
- **Expected behaviour:** what should happen instead?
- **Root cause hypothesis:** *why* does it happen? Name the specific function, line, or condition you believe is wrong. "Something is wrong with X" is not a hypothesis. "X calls Y without awaiting the result, so Z reads stale state" is.

If you cannot form a hypothesis because you don't understand the code yet, **investigate first** — read the relevant files, run the failing test with extra logging, check git blame. Investigation is not a fix attempt.

Record the hypothesis in `start_task` as `root_cause`. The bugfix_root_cause gate blocks `propose_change` if this is missing or a placeholder.

### Step 2 — make exactly one change

Apply the minimal change that tests your hypothesis. If the fix requires touching more than one logical unit, split into sequential attempts — fix the root cause first, verify, then address follow-on effects.

Run the relevant test(s) immediately after the change.

### Step 3 — read the result honestly

- **Tests pass:** confirm the fix is complete (regression test added, no other tests broken). Move to `finishing-a-development-branch`.
- **Tests still fail:** the hypothesis was wrong. Do NOT make another change yet. Go back to Step 1 with new information.
- **Different failure:** the hypothesis was partially right. Note what changed, form a new hypothesis about the remaining failure.

### Step 4 — three-strikes protocol

After three failed attempts on the same bug:

1. **Stop all code changes.**
2. Document the three attempts and what each one revealed.
3. Answer: is the hypothesis wrong, is the architecture the real problem, does this need a different model or a human?
4. Declare a new direction to the user before attempt #4. This is not optional — three wrong guesses is a signal the approach is wrong, not just the code.

If you have no new direction, escalate to the user: "I've tried X, Y, Z. Each revealed A, B, C. I don't have a confident next hypothesis — I need your help to understand [specific gap]."

## What this skill does NOT do

- It does not skip investigation. If the root cause is genuinely unknown, investigation (reads, logs, git history) is not an attempt — it's how you earn the right to form a hypothesis.
- It does not bundle: one hypothesis → one change → one test run. Period.
- It does not auto-close. The skill ends when the fix is verified and a regression test is in place.

## Transition

When the fix is verified and tested, invoke `finishing-a-development-branch`.
