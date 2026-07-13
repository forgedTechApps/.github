---
name: debugging
description: Use when investigating or fixing a bug. Enforces hypothesis-first discipline, one-variable-at-a-time fixing, and mandatory escalation after three failed attempts.
---

# Debugging

Agents thrash on bugs when they jump to fixes without a hypothesis, bundle multiple changes, and never stop to question a failing approach. This skill enforces three org debugging practices — `hypothesis_before_fix`, `fix_one_variable`, `three_strikes_escalate` — and provides the investigative framework to find root causes before any fix is attempted.

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If you haven't completed Phase 1, you cannot propose fixes.

## Hard Rules (MCP-enforced)

1. **No code change before a written hypothesis.** If you can't state the observed behaviour, suspected root cause, and predicted fix in one sentence each — you are not ready to write code.
2. **One variable per attempt.** Change one thing, run the tests, read the result. If the hypothesis was wrong, form a new one before the next attempt. No bundled patches.
3. **Three failed attempts = mandatory stop.** Do not attempt fix #4 without first documenting the three attempts and declaring a new direction. Escalate to the user if you're still stuck.

Record the hypothesis in `start_task` as `root_cause`. The `bugfix_root_cause` gate blocks `propose_change` if this is missing or a placeholder.

## When to Use

Use for ANY technical issue:
- Test failures
- Bugs in production
- Unexpected behaviour
- Performance problems
- Build failures
- Integration issues

**Use this ESPECIALLY when:**
- Under time pressure (emergencies make guessing tempting)
- "Just one quick fix" seems obvious
- You've already tried multiple fixes
- A previous fix didn't work
- You don't fully understand the issue

**Don't skip when:**
- The issue seems simple (simple bugs have root causes too)
- You're in a hurry (rushing guarantees rework)

## Red Flags — STOP and follow the process

If you catch yourself thinking any of these, return to Phase 1:

| Thought | Reality |
|---------|---------|
| "Quick fix for now, investigate later" | Symptom fixes always resurface. |
| "Just try changing X and see if it works" | Guessing is not a hypothesis. |
| "Add multiple changes, run tests" | Violates one-variable rule. |
| "It's probably X, let me fix that" | Probably ≠ hypothesis. |
| "I don't fully understand but this might work" | You are not ready. Investigate first. |
| "One more fix attempt" (after 2+ failed) | 3+ failures = architectural problem. |
| Each fix reveals a new problem in a different place | Wrong architecture, not wrong fix. |

## The Four Phases

Complete each phase before proceeding to the next.

### Phase 1: Root Cause Investigation

**Before attempting ANY fix:**

1. **Read error messages carefully** — don't skim stack traces. Note line numbers, file paths, error codes. They often contain the exact solution.

2. **Reproduce consistently** — can you trigger it reliably? What are the exact steps? If not reproducible, gather more data before forming a hypothesis.

3. **Check recent changes** — git diff, recent commits, new dependencies, config changes, environmental differences.

4. **Gather evidence in multi-component systems**

   When the system has multiple components (CI → build → signing, API → service → database), add diagnostic instrumentation at each boundary before proposing fixes:

   ```bash
   # Layer 1: entry point
   echo "=== Env available: ${VAR:+SET}${VAR:-UNSET} ==="

   # Layer 2: first component
   echo "=== Env in component: ===" && env | grep VAR || echo "VAR not in environment"

   # Layer 3: downstream component
   echo "=== State at layer 3: ===" && <inspect state>
   ```

   Run once to gather evidence showing WHERE it breaks. Then investigate that specific component.

5. **Trace data flow** — when the error is deep in the call stack, use `root-cause-tracing.md` in this directory. Quick version: where does the bad value originate? What called this with the bad value? Keep tracing up until you find the source. Fix at source, not at symptom.

### Phase 2: Pattern Analysis

**Find the pattern before fixing:**

1. Find working examples of similar code in the same codebase.
2. Compare against references — read the reference implementation completely, not skimming.
3. List every difference between working and broken, however small.
4. Understand all dependencies: settings, config, environment, assumptions.

### Phase 3: Hypothesis and Testing

**Answer these three questions before touching a file:**

- **Observed behaviour:** what exactly happens? (error message, wrong output, crash site)
- **Expected behaviour:** what should happen instead?
- **Root cause hypothesis:** *why* does it happen? Name the specific function, line, or condition. "Something is wrong with X" is not a hypothesis. "X calls Y without awaiting the result, so Z reads stale state" is.

Then:
1. Make the **smallest possible change** to test the hypothesis. One variable at a time.
2. Run the relevant tests immediately.
3. If wrong, form a **new** hypothesis — do NOT stack changes on top.

If you cannot form a hypothesis because you don't understand the code yet, investigate first. Investigation (reads, logs, git history) is not a fix attempt.

### Phase 4: Implementation

1. **Create a failing test case** — simplest possible reproduction, automated if possible, before fixing. Use `superpowers:test-driven-development` for proper failing tests.
2. **Implement a single fix** — address the root cause identified. No "while I'm here" improvements. No bundled refactoring.
3. **Verify the fix** — test passes, no other tests broken, issue actually resolved.

**If the fix doesn't work:**
- Count: how many fixes have you tried?
- If < 3: return to Phase 1 with new information.
- If ≥ 3: **stop and question the architecture** (see below).

**Three-strikes protocol:**
After three failed attempts:
1. Stop all code changes.
2. Document the three attempts and what each one revealed.
3. Answer: is the hypothesis wrong, is the architecture the real problem, does this need a different model or a human?
4. Declare a new direction to the user before attempt #4. This is not optional.

If you have no new direction: "I've tried X, Y, Z. Each revealed A, B, C. I don't have a confident next hypothesis — I need your help to understand [specific gap]."

**Pattern indicating architectural problem (not a fixable bug):**
- Each fix reveals new shared state/coupling/problem in a different place
- Fixes require massive refactoring to implement
- Each fix creates new symptoms elsewhere

Stop and question fundamentals: is this pattern sound? Are we stuck through inertia? Should we refactor the architecture rather than continue fixing symptoms? Discuss with your human partner before attempting more fixes.

## What this skill does NOT do

- It does not skip investigation. If the root cause is genuinely unknown, investigation is not an attempt — it's how you earn the right to form a hypothesis.
- It does not bundle: one hypothesis → one change → one test run. Period.
- It does not auto-close. The skill ends when the fix is verified and a regression test is in place.

## Supporting Techniques

- **`root-cause-tracing.md`** — trace bugs backward through the call stack to the original trigger
- **`defense-in-depth.md`** — add validation at multiple layers after finding root cause
- **`condition-based-waiting.md`** — replace arbitrary timeouts with condition polling

## Quick Reference

| Phase | Key Activities | Success Criteria |
|-------|---------------|------------------|
| **1. Root Cause** | Read errors, reproduce, check changes, gather evidence | Understand WHAT and WHY |
| **2. Pattern** | Find working examples, compare differences | Identify what's different |
| **3. Hypothesis** | State theory, test minimally, one variable | Confirmed or new hypothesis |
| **4. Implementation** | Create failing test, fix, verify | Bug resolved, tests pass |

## Transition

When the fix is verified and tested, invoke `finishing-a-development-branch`.

## Related Skills

- **`superpowers:test-driven-development`** — for creating the failing test case (Phase 4, Step 1)
- **`superpowers:verification-before-completion`** — verify fix worked before claiming success
