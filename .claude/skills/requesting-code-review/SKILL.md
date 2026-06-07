---
name: requesting-code-review
description: Use when completing tasks, implementing major features, or before merging to verify work meets requirements
---

# Requesting Code Review

Dispatch a reviewer subagent to catch issues before they compound. The reviewer gets crafted context — never the session history.

**Core principle:** Review early, review often. Fix before moving on.

## When to Request Review

**Mandatory:**
- After each task in subagent-driven-development
- After completing a major feature
- Before opening a PR

**Optional but valuable:**
- When stuck (fresh perspective)
- After fixing a complex bug

## How to Request

**1. Get the diff range:**

```bash
BASE_SHA=$(git rev-parse origin/main)   # or the commit before your work started
HEAD_SHA=$(git rev-parse HEAD)
git diff $BASE_SHA..$HEAD_SHA --stat
```

**2. Dispatch a reviewer subagent** (general-purpose, Opus model) with this context:

```
You are a code reviewer. Review the changes between {BASE_SHA} and {HEAD_SHA}.

Context: {DESCRIPTION of what was built and why}
Requirements: {the task spec or acceptance criteria}

Run: git diff {BASE_SHA}..{HEAD_SHA}

Check for:
- Correctness: does this do what the spec says?
- Scope: anything built that wasn't asked for?
- Test coverage: are new paths tested with the fixture harness?
- Lint: would `pnpm --filter ./mcp-server lint` pass?
- Consistency: does it match existing patterns in the codebase?
- Security: any new inputs that bypass validation?

Rate findings: Critical (fix now) / Important (fix before PR) / Minor (note for later).
Return a structured report.
```

**3. Act on findings:**

| Severity | Action |
|----------|--------|
| Critical | Fix immediately, re-review |
| Important | Fix before next task or PR |
| Minor | Log, address in a follow-up |

Push back if the reviewer is wrong — with technical reasoning, not defensiveness.

## Integration

- **In subagent-driven-development:** review after each task; the implementer subagent fixes findings
- **Before PR:** run once covering the full branch diff vs `origin/main`
- **After complex bug fix:** confirm the fix is targeted and doesn't introduce regressions

## Red Flags

**Never:**
- Skip review because "it's a small change"
- Ignore Critical findings
- Proceed to the next task with open Important findings
- Trust a reviewer finding without checking it against the actual code
