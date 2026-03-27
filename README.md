# forgedTech/.github

Org-wide GitHub configuration — applies to all repositories in the organisation.

## What lives here

```
.github/
  ISSUE_TEMPLATE/
    feature.yml              ← Gherkin AC enforced on all feature issues
    bug.yml                  ← Structured bug reports
    config.yml               ← Disables blank issues
  PULL_REQUEST_TEMPLATE.md   ← Quality checklist on every PR
  workflows/
    reusable-quality-gate-node.yml      ← TypeScript/Node.js CI
    reusable-quality-gate-flutter.yml   ← Flutter/Dart CI
    reusable-quality-gate-swift.yml     ← Swift/iOS CI
    reusable-quality-gate-dotnet.yml    ← .NET 8 CI
    reusable-quality-gate-python.yml    ← Python CI
    reusable-security-scan.yml          ← Weekly CodeQL + ZAP + OWASP
    reusable-deploy-railway.yml         ← Railway deployment

packages/
  eslint-config/             ← Shared ESLint rules (@forgedTech/eslint-config)

docs/
  SETUP-GUIDE.md             ← How to use these workflows in a new repo
  PER-PRODUCT-CI-EXAMPLES.md ← Copy-paste CI files for each product
```

## How product repos use this

Each product repo needs only a thin CI file:

```yaml
# product-repo/.github/workflows/ci.yml
jobs:
  quality-gate:
    uses: forgedTech/.github/.github/workflows/reusable-quality-gate-node.yml@main
    with:
      node-version: '20'
      coverage-threshold: '80'
    secrets: inherit
```

See `docs/PER-PRODUCT-CI-EXAMPLES.md` for copy-paste examples for each stack.

## Updating a shared workflow

Edit the relevant workflow file in this repo. All product repos pick up the
change on their next CI run — no changes needed in product repos.

## Find and replace

All files use `forgedTech` as a placeholder. Replace it globally with your
actual GitHub organisation slug before pushing.

```bash
# macOS / Linux
grep -rl 'forgedTech' . | xargs sed -i 's/forgedTech/your-actual-org/g'
```
