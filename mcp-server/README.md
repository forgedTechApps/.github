# @forgedtech/agent-standards-mcp

MCP server that exposes `.agent-standards.yml` to AI coding agents
(Claude Code, Cursor, etc.) running inside forgedTechApps repos.

## Tools

### `get_standards`

Load and validate `.agent-standards.yml` for a repo. Returns the full
parsed object: style, architecture, coverage thresholds, sensitive paths,
review gates, investigation mode, context pointers.

Args: `{ repo_root: string }`

Call this **at the start of every task**. The agent should then read
`context_pointers` to ground itself in the repo's conventions.

### `check_ci_setup`

Validate the repo's `.github/workflows/ci.yml` against the org's standards.
Returns findings (severity: error/warn/info) with fix hints.

Checks:
- File exists and parses as YAML
- Calls a canonical `quality-gate-*.yml@v1` (no bespoke CI)
- Coverage thresholds meet `.agent-standards.yml`
- Top-level permissions includes `issues: write`
- Deploy jobs depend on a quality-gate job (no test-skipping deploys)
- `ci.kind` matches what the workflow actually does

Args: `{ repo_root: string }`

Call this **at task start in every repo, before any other work**. If errors
are returned, fix them first.

### `check_branching`

Validate the repo against its branching policy:

- Required branches exist on origin (default: `main` + `dev`)
- The remote default branch matches `branching.default_branch`
- Current branch name matches `branching.feature_branch_pattern` (or is one of the required branches)

Args: `{ repo_root: string }`

Degrades gracefully when offline or remote is unreachable — emits warnings
instead of erroring. `branching.mode: hard` upgrades real violations to errors.

### `init_repo`

Generate a proposed `.github/workflows/ci.yml` for a repo that lacks one.
Returns the workflow text — does **not** write to disk.

Args: `{ language, kind, unit_coverage_threshold?, integration_coverage_threshold?, swift_scheme?, working_directory?, railway_service_name? }`

`kind` is one of:
- `service` — API + Railway deploy (dev + prod)
- `library` — code-only, no deploy
- `mobile` — Swift/Flutter, no deploy (app stores)
- `web` — Next.js/Vite + Railway deploy

The agent must present the output to the user, get approval, then commit.

### `check_paths`

Given a list of paths the agent intends to write, return which standards
gates each path triggers:

- `sensitive:<glob>` — path matches `architecture.sensitive_paths`
- `approval-required:<glob>` — path matches `review.explicit_approval_required_for`
- `regression-test-required:<glob>` — path matches `test_coverage.regression_required_for`

Args: `{ repo_root: string, paths: string[] }`

Call this **before writing**. If any path is `approval-required`, pause
and ask the user.

## Install

```bash
cd mcp-server
pnpm install
pnpm build
```

## Configure as an MCP server

Add to your Claude Code settings (`~/.claude/settings.json` or per-project
`.claude/settings.json`):

```json
{
  "mcpServers": {
    "agent-standards": {
      "command": "node",
      "args": ["/Users/dev/Development/forgedtech/mcp-server/dist/index.js"]
    }
  }
}
```

Or via the `claude mcp add` CLI:

```bash
claude mcp add agent-standards \
  node /Users/dev/Development/forgedtech/mcp-server/dist/index.js
```

## Develop

```bash
pnpm dev          # tsx watch mode
pnpm build        # compile to dist/
pnpm lint         # tsc --noEmit
```

## Roadmap

Currently shipped:
- `get_standards` — load + validate
- `check_paths` — gate detection
- `check_ci_setup` — workflow validation against standards
- `check_branching` — required branches + feature-branch-name policy
- `init_repo` — scaffold canonical CI for service/library/mobile/web

Next pass (designed, not built):
- `start_task` — record hypothesis, return contextual info, open task ID
- `propose_change` — validate scope against hypothesis, enforce hard mode
- `commit_checkpoint` — token budget tracking, read/write ratio
