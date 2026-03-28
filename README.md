# forgedTechApps/.github

Org-wide CI/CD and standards — defined once, applied to all forgedTechApps repositories.

---

## What this repo does

GitHub treats a repo named `.github` in your org specially. Everything here
applies automatically across all repos in the `forgedTechApps` org:

| File/folder | What it does |
|---|---|
| `ISSUE_TEMPLATE/feature.yml` | Feature request template — enforces Gherkin AC on all repos |
| `ISSUE_TEMPLATE/bug.yml` | Bug report template — all repos |
| `PULL_REQUEST_TEMPLATE.md` | PR quality checklist — all repos |
| `workflows/quality-gate-node.yml` | Shared CI pipeline for TypeScript/Node.js |
| `workflows/quality-gate-flutter.yml` | Shared CI pipeline for Flutter/Dart |
| `workflows/quality-gate-swift.yml` | Shared CI pipeline for Swift/iOS |
| `workflows/quality-gate-python.yml` | Shared CI pipeline for Python |
| `workflows/quality-gate-dotnet.yml` | Shared CI pipeline for .NET |
| `workflows/security-scan.yml` | Weekly deep security scan (CodeQL + OWASP) |
| `workflows/deploy-railway.yml` | Optional reusable Railway deploy step |

---

## How product repos use the shared pipelines

Each product repo has a thin `.github/workflows/ci.yml` that calls the shared
pipeline for its stack. The full pipeline logic lives here — product repos
just configure it.

**TypeScript repos (Alula, NetworkPulse):**
```yaml
jobs:
  ci:
    uses: forgedTechApps/.github/.github/workflows/quality-gate-node.yml@v1
    with:
      node-version: '20'
      unit-coverage-threshold: '80'
      integration-coverage-threshold: '70'
    secrets: inherit
```

**Flutter repo (eleven11):**
```yaml
jobs:
  ci:
    uses: forgedTechApps/.github/.github/workflows/quality-gate-flutter.yml@v1
    with:
      flutter-version: '3.x'
      unit-coverage-threshold: '80'
      integration-coverage-threshold: '70'
    secrets: inherit
```

**Swift repo (FORGE):**
```yaml
jobs:
  ci:
    uses: forgedTechApps/.github/.github/workflows/quality-gate-swift.yml@v1
    with:
      scheme: 'FORGE'
      unit-coverage-threshold: '80'
      integration-coverage-threshold: '70'
    secrets: inherit
```

See `product-ci-examples/` for the complete CI file for each product.

---

## Quality gates (every commit, every repo)

| Gate | Fails on | Stack |
|---|---|---|
| Lint / format | Any error | All |
| Type check | Any type error | Node.js, Flutter, Swift, Python, .NET |
| Generated files current | Out-of-date `.g.dart` files | Flutter |
| Unit tests | Any failure | All |
| Unit coverage | Below threshold (default 80%) | All |
| Integration tests | Any failure | All |
| Integration coverage | Below threshold (default 70%) | All |
| E2E tests | Any failure | Node.js (opt-in) |
| UI tests | Any failure | Swift (opt-in, main only) |
| OWASP Dependency-Check | CVSS ≥ 7 vulnerability | All |
| npm / pub / NuGet / Safety audit | High+ vulnerability | Per stack |
| Bandit security scan | High/critical finding | Python |
| CodeQL (weekly) | Security finding | All |
| Build | Compile failure | All |

---

## Branching model

All repos follow GitFlow:

```
feature/* ──┐
fix/*       ├──▶ dev ──▶ main
hotfix/*  ──┘
```

- CI runs on every push to `dev` or `main`, and on every PR targeting either branch
- Deploy to `development` environment on merge to `dev`
- Deploy to `production` environment on merge to `main`
- Direct pushes to `main` are blocked — all changes must flow through a PR from `dev`

---

## Workflow versioning

Reusable workflows are versioned using Git tags (`v1`, `v2`, etc.). Product repos pin to a
major version tag rather than `@main`.

**Strategy:**
- `@v1` is the current stable tag — all product repos should reference this
- `@main` must **not** be used in production; it is an unstable moving reference
- When a breaking change is introduced, a new `@v2` tag is cut and the old `@v1` tag
  continues to work until product repos are ready to upgrade
- To ship a non-breaking update to all repos simultaneously: commit to `main`, then move
  the `v1` tag: `git tag -f v1 && git push --force origin v1`
- To cut a new major version: `git tag v2 && git push origin v2`, then update each
  product repo's CI file to reference `@v2`

---

## Updating a shared pipeline

Edit the relevant `workflows/quality-gate-*.yml` file in this repo.
Move the `v1` tag to the new commit so all product repos pick up the change on their next CI run.
No changes needed in product repos for non-breaking updates.

---

## Org-level branch protection

Two rulesets configured at: `github.com/organizations/forgedTechApps/settings/rules`

- `protect-main` — strict: PR required, 1 approval, linear history, no direct pushes by anyone
- `protect-dev` — standard: PR required, 1 approval, force push blocked

See `docs/SETUP.md` for step-by-step instructions.

---

## Adding a new product repo

1. Create the repo under `forgedTechApps`
2. Create a `dev` branch from `main`
3. Copy the relevant CI example from `product-ci-examples/` into `.github/workflows/ci.yml`
4. Add a `CLAUDE.md` at the repo root
5. Configure `development` and `production` GitHub Environments (Settings → Environments)
6. Add any repo-specific secrets (deploy tokens etc.) — `NVD_API_KEY` at org level covers all repos
7. Open a test PR — the pipeline runs automatically
