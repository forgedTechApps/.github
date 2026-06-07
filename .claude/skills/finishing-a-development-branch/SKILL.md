---
name: finishing-a-development-branch
description: Use when implementation is complete, all tests pass, and you need to decide how to integrate the work - guides completion of development work by presenting structured options for merge, PR, or cleanup
---

# Finishing a Development Branch

Guide completion of development work: verify tests, present options, execute the choice.

**Announce at start:** "I'm using the finishing-a-development-branch skill to complete this work."

## Step 1: Verify Tests

```bash
pnpm --filter ./mcp-server test
pnpm --filter ./mcp-server lint
```

If either fails, stop. Fix before presenting options.

## Step 2: Detect Environment

```bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
BRANCH=$(git branch --show-current)
```

- `GIT_DIR != GIT_COMMON` (and not a submodule): already in a linked worktree — note the path
- `GIT_DIR == GIT_COMMON`: normal repo checkout

## Step 3: Present Options

**Normal branch work — present exactly these 4 options:**

```
Implementation complete. What would you like to do?

1. Open a PR into main (recommended — branch-protected, PRs required)
2. Open a PR into dev (if this is a dev→main release branch)
3. Keep branch as-is (handle later)
4. Discard this work
```

**Detached HEAD — present exactly 3 options (no PR/merge):**

```
Implementation complete. Detached HEAD — externally managed workspace.

1. Push as new branch and open a PR
2. Keep as-is (handle later)
3. Discard this work
```

## Step 4: Execute Choice

### Option 1 / 2: Open a PR

```bash
git push -u origin <branch>

gh pr create \
  --base <main|dev> \
  --title "<title>" \
  --body "$(cat <<'EOF'
## Summary
- <bullet 1>
- <bullet 2>

## Test plan
- [ ] pnpm test passes
- [ ] pnpm lint passes
- [ ] <manual verification step if needed>

🤖 Generated with Claude Code
EOF
)"
```

Pass `--auto` — it waits for mergeability before merging, so it's safe on our protected `main`.

**Do NOT clean up the worktree** — keep it alive for PR iteration.

### Option 3: Keep As-Is

Report: "Branch `<name>` kept. Worktree preserved at `<path>` if applicable."

### Option 4: Discard

**Confirm first:**

```
This will permanently delete:
- Branch <name>
- All commits: <list>
- Worktree at <path> (if applicable)

Type 'discard' to confirm.
```

Wait for exact typed confirmation. Then:

```bash
# Move to main repo root before removing worktree
MAIN_ROOT=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)
cd "$MAIN_ROOT"
git worktree remove "$WORKTREE_PATH"   # only if in a worktree
git worktree prune
git branch -D <branch>
```

## Step 5: Worktree Cleanup (Options 1-discard only after merge confirmed)

Only clean up worktrees this session created (under `.worktrees/` or `worktrees/`). Do NOT touch harness-managed worktrees.

```bash
MAIN_ROOT=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)
cd "$MAIN_ROOT"
git worktree remove "$WORKTREE_PATH"
git worktree prune
```

## Branch Model Reference

- `main` is branch-protected: PRs required, no direct push, no force-push
- `--auto` is safe — waits for mergeability before auto-merging
- Work branches → PR into `main` (for features/fixes) or `dev` (for staged releases)
- `dev` → `main` is a release PR

## Red Flags

**Never:**
- Push directly to `main`
- Force-push without explicit user request
- Remove a worktree before a PR is merged (keep it for iteration)
- Skip test + lint verification before presenting options
- Run `git worktree remove` from inside the worktree — always `cd` to main root first
- Clean up worktrees the harness created (check path provenance)

**Always:**
- Verify tests AND lint before presenting options
- Require typed "discard" confirmation for Option 4
- Run `git worktree prune` after any removal
