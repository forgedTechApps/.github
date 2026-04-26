# ForgedTech Agent Standards

This directory defines how AI agents (Claude Code, Cursor, etc.) work inside
forgedTechApps repos. Every product repo declares its own rules in
`.agent-standards.yml` at the repo root. The `forgedtech/agent-standards-mcp`
server reads that file and exposes it to agents at task start.

## Why

Agents make consistent mistakes when they don't know the local rules:
they invent abstractions that already exist, skip tests, touch sensitive
files without asking, follow style conventions from training data instead
of the project's. `.agent-standards.yml` makes the rules first-class —
the agent reads them before doing anything.

## What gets enforced

| Concern                          | Mechanism                          | Where           |
|----------------------------------|------------------------------------|-----------------|
| Coding standards (per-project)   | `style:` + agent reads at start    | MCP             |
| Architecture standards           | `architecture.rules:` + sensitive paths | MCP        |
| Investigate before change        | `investigation.mode: hard`         | MCP             |
| **Every repo has CI**            | `check_ci_setup` + `init_repo`     | MCP             |
| **Branching strategy**           | `check_branching` (main + dev)     | MCP             |
| Test execution before deploy     | `deploy.needs: [ci]` in caller CI  | GitHub Actions  |
| High test coverage               | `*-coverage-threshold` inputs      | quality-gate-*  |
| Vulnerability scans              | OSV / OWASP step in quality-gate-* | quality-gate-*  |
| No regressions                   | `regression_required_for:` paths   | MCP + reviewer  |

The MCP catches problems early (during the agent's work).
CI catches them at merge time. Both are required.

## Mandatory rule: every repo has CI

Every forgedTechApps repo must have a `.github/workflows/ci.yml` that
calls one of the canonical `quality-gate-*.yml` reusable workflows from
`forgedTechApps/.github`. No bespoke CI, no exceptions.

The agent's first action in **any** repo is:

1. `mcp.check_ci_setup(repo_root)` — validates the workflow exists and
   meets all standards (canonical quality-gate, coverage thresholds match
   `.agent-standards.yml`, deploy depends on CI, `issues: write` present).
2. If errors are returned, fix them **before any other work**. If
   `CI_MISSING`, the agent's first task is `mcp.init_repo(...)`, not the
   user's original ask.

`mcp.init_repo` generates the proposed workflow text — it does not write.
The agent must show the proposal, get approval, then commit. Pick `kind`:

| kind     | What it generates                                      | Examples                      |
|----------|--------------------------------------------------------|-------------------------------|
| service  | quality-gate + Railway deploy (dev + prod)             | NetworkPulse API, forge-pipe-mcp |
| library  | quality-gate only, no deploy                           | shared TS packages, Python libs |
| mobile   | quality-gate (Swift/Flutter), no deploy (App Store)    | forge-ios, eleven11           |
| web      | quality-gate-node + Railway deploy                     | NetworkPulse web, marketing sites |

## Schema

`schema/agent-standards.schema.json` — JSON Schema for `.agent-standards.yml`.
Validated by the MCP server at load time. Invalid files are rejected with
a clear error so agents can't proceed.

## Samples

`samples/forge.agent-standards.yml` — Swift/iOS, soft mode.
`samples/networkpulse.agent-standards.yml` — multi-stack monorepo, hard mode.

Copy the closest sample to your repo's root as `.agent-standards.yml` and
edit. The `repo:` field must match the GitHub `org/repo`.

## Investigation modes

`soft` (default) — agent records its hypothesis and proceeds.
Useful for low-stakes repos and small fixes.

`hard` — `mcp.check_paths` warns louder when intended writes touch
sensitive paths. Sensitive paths require an explicit hypothesis from the
agent before changes proceed.

Use `hard` for repos where a wrong assumption is expensive: payment code,
auth, schema migrations, anything customer-facing.

## CI hardening rules (enforced in `.github/workflows/`)

These are not negotiable for any product repo:

1. **Deploy jobs depend on CI**
   ```yaml
   deploy:
     needs: [ci]
     if: needs.ci.result == 'success' && github.ref == 'refs/heads/main'
     uses: forgedTechApps/.github/.github/workflows/deploy-railway.yml@v1
   ```

2. **Coverage thresholds are required inputs**, not optional. Pass
   `unit-coverage-threshold` and `integration-coverage-threshold` to every
   `quality-gate-*` call.

3. **Vulnerability scan runs on every PR** via the dependency-audit step
   built into each `quality-gate-*` workflow. No `enable-zap: false` for
   HTTP services.

4. **Branch protection requires CI to pass.** Run once per repo:
   ```bash
   gh api -X PUT \
     "/repos/forgedTechApps/<repo>/branches/main/protection" \
     -F required_status_checks.strict=true \
     -F 'required_status_checks.contexts[]=Quality Gate (<stack>)' \
     -F enforce_admins=true \
     -F required_pull_request_reviews.required_approving_review_count=1 \
     -F restrictions=
   ```

## Mandatory rule: branching strategy

Every forgedTechApps repo must have a **`main`** and **`dev`** branch on its
remote, and the remote default branch must be `main`. Feature work happens
on prefix-named branches (`feat/...`, `fix/...`, `chore/...`, etc.) and is
PR'd into `dev`; releases promote `dev` → `main`.

`mcp.check_branching` enforces this. Run it at task start alongside
`check_ci_setup`. By default violations are warnings (`mode: soft`); set
`mode: hard` in `.agent-standards.yml` for repos where wrong branches are
expensive (production services, anything with a deploy gate keyed on `main`).

When bootstrapping a new repo, pass `--ensure-branches` to `init-project`
to have the scaffolder create the `dev` branch (and push it if a remote
is configured).

## GitHub Actions free-tier constraints

forgedTechApps is on the GitHub free plan. Private repos get **2,000 Linux
minutes/month and 200 macOS minutes/month** — and macOS minutes burn at 10×
the rate (a 10-minute mobile build is effectively 100 minutes of Linux quota
worth of CI bandwidth). This shapes what every CI workflow must do:

- **`paths-ignore` is mandatory** for `docs/**`, `**/*.md`, `LICENSE`,
  `.gitignore` — documentation commits should never trigger a build.
  All `init_repo` templates include this by default.
- **Coverage thresholds anchored to current baseline**, not aspirational
  targets. Use `test_coverage.notes:` to document why a threshold sits
  where it does.
- **`actions: read` and `issues: write` cannot appear in job-level
  `permissions:` blocks** in reusable workflows on the free tier — both
  cause `startup_failure`. The org's reusable workflows have been audited
  to avoid these.
- **`workflow_call` boolean inputs** cannot use `${{ }}` expressions in
  the caller's `with:` block — use literal `true`/`false`.
- **Dynamic `runs-on: ${{ }}` expressions** are unsupported — split into
  separate jobs with static runner labels and `if:` conditions.

If your repo legitimately can't use one of the canonical
`quality-gate-*.yml` workflows (custom domain checks, framework-specific
gates), set `ci.bespoke: true` with a `ci.bespoke_reason` in
`.agent-standards.yml`. This silences `CI_NO_CANONICAL_QUALITY_GATE` and
documents the trade-off explicitly.

## How an agent uses this

1. Agent starts a task in repo `<R>`.
2. Agent calls `mcp.get_standards(repo_root="<path-to-R>")` — receives
   style, architecture, coverage targets, sensitive paths, context_pointers.
3. Agent reads the `context_pointers` files to ground itself.
4. Before writing, agent calls `mcp.check_paths(paths=[...])` to see which
   gates trigger. If any path is `approval-required`, agent pauses and asks
   the user before writing.
5. Agent writes, runs tests, opens PR.
6. CI runs the same coverage / vuln gates server-side.

The MCP is fast feedback. CI is the actual gate. Both layers must agree.
