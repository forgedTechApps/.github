---
name: test-driven-development
description: Use when implementing any feature or bugfix, before writing implementation code
---

# Test-Driven Development (TDD)

Write the test first. Watch it fail. Write minimal code to pass.

**Core principle:** If you didn't watch the test fail, you don't know if it tests the right thing.

**Violating the letter of the rules is violating the spirit of the rules.**

## The Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

Write code before the test? Delete it. Start over. No exceptions — not "keep as reference", not "adapt it while writing tests". Delete means delete.

## Red-Green-Refactor

```dot
digraph tdd {
    rankdir=LR;
    red [label="RED\nWrite failing test", shape=box, style=filled, fillcolor="#ffcccc"];
    verify_red [label="Verify fails\ncorrectly", shape=diamond];
    green [label="GREEN\nMinimal code", shape=box, style=filled, fillcolor="#ccffcc"];
    verify_green [label="All green?", shape=diamond];
    refactor [label="REFACTOR\nClean up", shape=box, style=filled, fillcolor="#ccccff"];

    red -> verify_red;
    verify_red -> green [label="yes"];
    verify_red -> red [label="wrong failure"];
    green -> verify_green;
    verify_green -> refactor [label="yes"];
    verify_green -> green [label="no"];
    refactor -> verify_green [label="stay green"];
}
```

### RED — Write Failing Test

One minimal test showing what should happen. One behavior. Clear name. No mocks unless unavoidable.

### Verify RED — Watch It Fail (MANDATORY, never skip)

```bash
pnpm --filter ./mcp-server test
```

Confirm the test fails **because the feature is missing**, not because of a typo or syntax error.

Test passes immediately? You're testing existing behavior — fix the test.

### GREEN — Minimal Code

Write the simplest code that makes the test pass. No extra features, no YAGNI violations, no "while I'm here" improvements.

### Verify GREEN (MANDATORY)

```bash
pnpm --filter ./mcp-server test
pnpm --filter ./mcp-server lint   # tsc --noEmit
```

All tests pass, no lint errors, output clean.

### REFACTOR

Remove duplication, improve names, extract helpers — without adding behavior. Keep tests green.

## Fixture Harness (this repo)

This repo's test harness is **fixture-based**, not unit-test-based. For MCP check implementations:

```
mcp-server/src/__tests__/<check-name>/
  01-ok/                    ← fixture directory
    some-relevant-file.ts   ← source file the check reads
    expected.json           ← { "findings": [...] }
  02-violation/
    some-file.ts
    expected.json
```

**TDD with the fixture harness:**
1. Create a new fixture directory with the file that should trigger (or not trigger) the check
2. Write `expected.json` with the findings you expect (RED — test will fail because check doesn't match yet)
3. Run `pnpm --filter ./mcp-server test` — confirm it fails
4. Implement or modify the check logic
5. Run again — confirm it passes (GREEN)
6. Refactor if needed

Match the shape of the nearest existing fixture set (grep `src/__tests__/` for examples).

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code breaks. 30 seconds to add a fixture. |
| "I'll test after" | Tests after pass immediately — prove nothing. |
| "Already manually tested" | Ad-hoc ≠ systematic. No record, can't re-run. |
| "Deleting hours of work is wasteful" | Sunk cost. Unverified code is the real waste. |
| "TDD will slow me down" | TDD is faster than debugging. Pragmatic = test-first. |

## Red Flags — STOP

- Code written before test
- Test passes immediately without any implementation
- Can't explain why the test failed
- "I'll add tests later"
- "This is different because…"

**All of these mean: Delete code. Start over with TDD.**

## Verification Checklist

Before marking work complete:

- [ ] Every new function/path has a test (fixture or unit)
- [ ] Watched each test fail before implementing
- [ ] Each test failed for expected reason (feature missing, not typo)
- [ ] Wrote minimal code to pass
- [ ] All tests pass: `pnpm --filter ./mcp-server test`
- [ ] Lint clean: `pnpm --filter ./mcp-server lint`
- [ ] Edge cases and error paths covered

Can't check all boxes? You skipped TDD. Start over.
