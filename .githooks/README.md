# Git hooks (local pre-flight)

Committed hooks that run the fast local checks **before** code reaches GitHub,
so avoidable failures never cost Actions minutes.

- **pre-commit** — lint + typecheck (seconds; blocking). Not tests.
- **pre-push** — test suite (blocking).

## Enable (once per clone)

```sh
git config core.hooksPath .githooks
```

That's it — the hooks are tracked in the repo, so everyone runs the same checks.
A hook degrades gracefully (skips with a warning) if a tool isn't installed.

## Bypass (rare)

`git commit --no-verify` / `git push --no-verify` skips them — use only when you
genuinely must (e.g. committing a WIP checkpoint). The CI gate still enforces.
