---
name: using-git-worktrees
description: Use when starting feature work that needs isolation from current workspace or before executing implementation plans - ensures an isolated workspace exists via native tools or git worktree fallback
---

# Using Git Worktrees

## Overview

Ensure work happens in an isolated workspace. Prefer native worktree tools. Fall back to manual git worktrees only when no native tool is available.

**Core principle:** Detect existing isolation first. Then use native tools. Then fall back to git. Never fight the harness.

## Step 0: Detect Existing Isolation

Before creating anything, check if you are already in an isolated workspace:

```bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
BRANCH=$(git branch --show-current)
```

**Submodule guard:** `GIT_DIR != GIT_COMMON` is also true inside git submodules. Verify you are not in a submodule:

```bash
# If this returns a path, you're in a submodule — treat as normal repo
git rev-parse --show-superproject-working-tree 2>/dev/null
```

**If `GIT_DIR != GIT_COMMON` (and not a submodule):** Already in a linked worktree. Skip to Step 2. Do NOT create another worktree.

**If `GIT_DIR == GIT_COMMON`:** Normal repo checkout — proceed to Step 1.

Ask for consent before creating a worktree unless the user has already indicated a preference:

> "Would you like me to set up an isolated worktree? It protects your current branch from changes."

If the user declines, work in place and skip to Step 2.

## Step 1: Create Isolated Workspace

### 1a. Native Worktree Tools (preferred)

If a native tool is available (`EnterWorktree`, `/worktree`, `--worktree` flag), use it and skip to Step 2. Native tools handle directory placement, branch creation, and cleanup automatically.

Only proceed to Step 1b if no native tool is available.

### 1b. Git Worktree Fallback

Use this only when no native worktree tool is available.

**Directory selection priority** (explicit user preference always wins):
1. Declared preference in instructions
2. Existing `.worktrees/` at project root (preferred)
3. Existing `worktrees/` at project root
4. Default to `.worktrees/` at project root

**Safety verification (project-local directories only):**

```bash
git check-ignore -q .worktrees 2>/dev/null || git check-ignore -q worktrees 2>/dev/null
```

If NOT ignored: add to `.gitignore`, commit, then proceed. This prevents worktree contents from being tracked.

**Create the worktree:**

```bash
path="$LOCATION/$BRANCH_NAME"
git worktree add "$path" -b "$BRANCH_NAME"
cd "$path"
```

**Sandbox fallback:** If `git worktree add` fails with a permission error, tell the user and work in the current directory instead.

## Step 2: Project Setup

Auto-detect and run appropriate setup:

```bash
if [ -f package.json ]; then npm install; fi
if [ -f Cargo.toml ]; then cargo build; fi
if [ -f requirements.txt ]; then pip install -r requirements.txt; fi
if [ -f pyproject.toml ]; then poetry install; fi
if [ -f go.mod ]; then go mod download; fi
```

## Step 3: Verify Clean Baseline

Run the project test suite. If tests fail, report and ask whether to proceed or investigate. If tests pass, report ready.

## Quick Reference

| Situation | Action |
|-----------|--------|
| Already in linked worktree | Skip creation (Step 0) |
| In a submodule | Treat as normal repo |
| Native worktree tool available | Use it (Step 1a) |
| No native tool | Git worktree fallback (Step 1b) |
| `.worktrees/` exists | Use it (verify ignored) |
| `worktrees/` exists | Use it (verify ignored) |
| Neither exists | Default to `.worktrees/` |
| Directory not ignored | Add to .gitignore + commit |
| Permission error on create | Work in place |
| Tests fail during baseline | Report + ask |

## Red Flags

**Never:**
- Create a worktree when Step 0 detects existing isolation
- Use `git worktree add` when a native tool (`EnterWorktree`) is available
- Create a project-local worktree directory without verifying it's ignored
- Proceed with failing baseline tests without asking
