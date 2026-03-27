# forgedTech/.github

Org-wide CI/CD and standards — defined once, applied to all forgedTech repositories.

---

## What this repo does

GitHub treats a repo named `.github` in your org specially. Everything here
applies automatically across all repos in the `forgedTech` org:

| File/folder | What it does |
|---|---|
| `ISSUE_TEMPLATE/feature.yml` | Feature request template — enforces Gherkin AC on all repos |
| `ISSUE_TEMPLATE/bug.yml` | Bug report template — all repos |
| `PULL_REQUEST_TEMPLATE.md` | PR quality checklist — all repos |
| `workflows/reusable-ci-node.yml` | Shared CI pipeline for TypeScript/Node.js |
| `workflows/reusable-ci-flutter.yml` | Shared CI pipeline for Flutter/Dart |
| `workflows/reusable-ci-swift.yml` | Shared CI pipeline for Swift/iOS |

---

## How product repos use the shared pipelines

Each product repo has a thin `.github/workflows/ci.yml` that calls the shared
pipeline for its stack. The full pipeline logic lives here — product repos
just configure it.

**TypeScript repos (forge-pipe-mcp, Alula, NetworkPulse):**
```yaml
jobs:
  ci:
    uses: forgedTech/.github/.github/workflows/reusable-ci-node.yml@main
    with:
      node-version: '20'
      coverage-threshold: '80'
    secrets: inherit
```

**Flutter repo (eleven11):**
```yaml
jobs:
  ci:
    uses: forgedTech/.github/.github/workflows/reusable-ci-flutter.yml@main
    with:
      flutter-version: '3.x'
    secrets: inherit
```

**Swift repo (FORGE):**
```yaml
jobs:
  ci:
    uses: forgedTech/.github/.github/workflows/reusable-ci-swift.yml@main
    with:
      scheme: 'FORGE'
    secrets: inherit
```

See `product-ci-examples/` for the complete CI file for each product.

---

## Quality gates (every commit, every repo)

| Gate | Fails on | Stack |
|---|---|---|
| Lint | Any error | All |
| Type check | Any type error | Node.js, Flutter, Swift |
| Generated files current | Out-of-date `.g.dart` files | Flutter |
| Tests | Any failure | All |
| Coverage | Below threshold (default 80%) | All |
| OWASP Dependency-Check | CVSS ≥ 7 vulnerability | All |
| npm audit / pub audit | High+ vulnerability | Node.js, Flutter |
| CodeQL | Security finding | All |
| Build | Compile failure | All |

---

## Updating a shared pipeline

Edit the relevant `workflows/reusable-ci-*.yml` file in this repo.
Every product repo picks up the change on their next CI run.
No changes needed in product repos.

---

## Org-level branch protection

Configure once at: `github.com/organizations/forgedTech/settings/rules`

Recommended ruleset for `main` across all repos:
- Require pull request (1 approval)
- Dismiss stale reviews on new commits
- Require status checks: `CI` (or `CI (Node.js)` / `CI (Flutter)` / `CI (Swift/iOS)`)
- Require branches up to date
- Require conversation resolution
- Require linear history
- Block force pushes

See `docs/SETUP.md` for step-by-step instructions.

---

## Adding a new product repo

1. Create the repo under `forgedTech`
2. Copy the relevant CI example from `product-ci-examples/` into `.github/workflows/ci.yml`
3. Add a `CLAUDE.md` at the repo root (use the template from the relevant product)
4. Add required secrets to the repo (`NVD_API_KEY` at org level covers all repos)
5. Open a test PR — the pipeline runs automatically
