---
name: subagent-driven-development
description: Use when executing implementation plans with independent tasks in the current session
---

# Subagent-Driven Development

Execute a plan by dispatching a fresh subagent per task, with a code-quality review after each. The subagent gets full task text and context — never the session history.

**Core principle:** Fresh context per task + review checkpoint = high quality, no context drift.

**Continuous execution:** Do not pause between tasks to check in. Execute all tasks from the plan without stopping. Stop only when: blocked and cannot resolve, ambiguity prevents progress, or all tasks are complete.

## When to Use

```dot
digraph when {
    "Have a plan?" [shape=diamond];
    "Tasks mostly independent?" [shape=diamond];
    "subagent-driven-development" [shape=box];
    "Inline execution" [shape=box];
    "Brainstorm / interview-me first" [shape=box];

    "Have a plan?" -> "Tasks mostly independent?" [label="yes"];
    "Have a plan?" -> "Brainstorm / interview-me first" [label="no"];
    "Tasks mostly independent?" -> "subagent-driven-development" [label="yes"];
    "Tasks mostly independent?" -> "Inline execution" [label="no — tightly coupled"];
}
```

## The Process

```dot
digraph process {
    rankdir=TB;

    "Read plan, extract all tasks, create TodoWrite" [shape=box];
    "Dispatch implementer subagent" [shape=box];
    "Subagent needs context?" [shape=diamond];
    "Answer, re-dispatch" [shape=box];
    "Subagent implements, tests, commits" [shape=box];
    "Dispatch code-quality reviewer" [shape=box];
    "Reviewer approves?" [shape=diamond];
    "Subagent fixes, re-review" [shape=box];
    "Mark task complete" [shape=box];
    "More tasks?" [shape=diamond];
    "finishing-a-development-branch" [shape=doublecircle];

    "Read plan, extract all tasks, create TodoWrite" -> "Dispatch implementer subagent";
    "Dispatch implementer subagent" -> "Subagent needs context?";
    "Subagent needs context?" -> "Answer, re-dispatch" [label="yes"];
    "Answer, re-dispatch" -> "Dispatch implementer subagent";
    "Subagent needs context?" -> "Subagent implements, tests, commits" [label="no"];
    "Subagent implements, tests, commits" -> "Dispatch code-quality reviewer";
    "Dispatch code-quality reviewer" -> "Reviewer approves?" ;
    "Reviewer approves?" -> "Subagent fixes, re-review" [label="no"];
    "Subagent fixes, re-review" -> "Dispatch code-quality reviewer";
    "Reviewer approves?" -> "Mark task complete" [label="yes"];
    "Mark task complete" -> "More tasks?";
    "More tasks?" -> "Dispatch implementer subagent" [label="yes"];
    "More tasks?" -> "finishing-a-development-branch" [label="no"];
}
```

## Model Selection

Match model to task complexity — Opus is expensive, use it only when judgment is required:

| Task type | Model |
|-----------|-------|
| Isolated function, clear spec, 1–2 files | Haiku |
| Multi-file coordination, integration concerns | Sonnet |
| Architecture, design, debugging, review | Opus |

## Implementer Subagent Prompt

Provide the subagent:
1. **Full task text** from the plan — don't make it read the file
2. **Scene-setting context**: where this task fits in the overall plan
3. **Pattern to mirror**: exact file path of closest existing example
4. **Constraints**: don't touch files outside the task scope
5. **Expected output**: "commit the change, report status + what changed"

## Handling Implementer Status

- **DONE** — proceed to code-quality review
- **DONE_WITH_CONCERNS** — read concerns; if correctness/scope, address before review; if observations, note and proceed
- **NEEDS_CONTEXT** — provide missing context, re-dispatch
- **BLOCKED** — assess: context problem → more context + re-dispatch; task too large → break it down; plan is wrong → escalate to user

## Code-Quality Reviewer Prompt

Give the reviewer:
- The task spec (what should have been built)
- The git diff (`git diff HEAD~1..HEAD` or specific SHAs)
- Checklist: correctness, scope (nothing extra built), test coverage, consistency with existing patterns, no lint errors

Severity tiers: **Critical** (fix now), **Important** (fix before next task), **Minor** (note for later).

## Red Flags

**Never:**
- Start implementation on `main` without explicit user consent — work on a branch
- Skip the code-quality review
- Dispatch multiple implementer subagents in parallel (write conflicts)
- Pass the plan file path to the subagent — provide the full task text
- Accept "close enough" when the reviewer flagged issues
- Move to the next task while the reviewer has open findings

**If the subagent reports BLOCKED twice on the same task:** escalate to the user rather than re-dispatching again.

## Integration

- **Before this skill:** `brainstorming` → `interview-me` → `writing-plans`
- **After this skill:** `finishing-a-development-branch`
- **Subagents should use:** `test-driven-development` for each task
