# Org-Level Ruleset — Apply Once, Covers All Repos

## Option A — GitHub UI (simpler)

1. Go to: `github.com/organisations/forgedTech/settings/rules`
2. Click **New ruleset → New branch ruleset**
3. Configure as below

## Option B — GitHub API (repeatable, scriptable)

```bash
# Replace forgedTech and YOUR_GITHUB_TOKEN
curl -X POST \
  -H "Authorization: Bearer YOUR_GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/orgs/forgedTech/rulesets \
  -d @org-ruleset.json
```

---

## Ruleset configuration (apply in UI or paste as JSON)

**Ruleset name:** `main-branch-protection`
**Enforcement:** Active
**Target:** All repositories → Branch `main`

### Rules to enable

| Rule | Setting | Reason |
|---|---|---|
| Require pull request | Required approvals: 1 | No direct pushes to main |
| Dismiss stale reviews on push | Enabled | New commits invalidate approvals |
| Require status checks | See list below | CI must pass before merge |
| Require branches up to date | Enabled | Branch must be current before merge |
| Require conversation resolution | Enabled | No unresolved review comments |
| Require linear history | Enabled | Squash/rebase only — clean history |
| Block force pushes | Enabled | Prevents history rewriting on main |
| Restrict deletions | Enabled | Prevents accidental main deletion |

### Required status checks

Add these check names. They appear after your first CI run:

| Check name | Applies to |
|---|---|
| `Quality Gate (Node.js)` | forge-pipe-mcp, Alula, NetworkPulse |
| `Quality Gate (Flutter)` | eleven11 |
| `Quality Gate (Swift/iOS)` | FORGE |
| `Quality Gate (.NET)` | .NET products |
| `Quality Gate (Python)` | Python products |

**Important:** Status check names must match exactly what appears in your GitHub Actions runs. Run CI once before adding required checks — GitHub needs to have seen the check name to accept it.

---

## JSON payload for API approach

```json
{
  "name": "main-branch-protection",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/main"],
      "exclude": []
    },
    "repository_name": {
      "include": ["~ALL"],
      "exclude": [],
      "protected": false
    }
  },
  "rules": [
    {
      "type": "deletion"
    },
    {
      "type": "non_fast_forward"
    },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true
      }
    },
    {
      "type": "required_linear_history"
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "required_status_checks": [
          {
            "context": "Quality Gate (Node.js)",
            "integration_id": null
          },
          {
            "context": "Quality Gate (Flutter)",
            "integration_id": null
          },
          {
            "context": "Quality Gate (Swift/iOS)",
            "integration_id": null
          }
        ],
        "strict_required_status_checks_policy": true
      }
    }
  ]
}
```

**Note on status check names:** The names above must exactly match what GitHub Actions reports. After your first CI run on any repo, check `github.com/forgedTech/REPO/actions` — the job name shown there is the check name. Update the JSON accordingly.

---

## What the org ruleset does NOT handle

Per-repo configuration still needed in each product repo:
- `sonar-project.properties` — SonarCloud project key (different per repo)
- `.owasp/dependency-check-suppression.xml` — product-specific suppressions
- `CLAUDE.md` — product-specific rules and context

These are intentionally per-repo because they are product-specific by nature.

---

## How to use the shared ESLint config package

After publishing `@forgedTech/eslint-config` to GitHub Packages:

**In each TypeScript product repo's `.eslintrc.json`:**

```json
{
  "extends": ["@forgedTech/eslint-config"],
  "parserOptions": {
    "project": "./tsconfig.json"
  }
}
```

**In each repo's `.npmrc` (to pull from GitHub Packages):**

```
@forgedTech:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

**To publish the package:**

```bash
cd packages/eslint-config
npm publish
```

GitHub Packages is free for public repos and included in all paid plans for private repos.

---

## Publishing the .github repo

1. Create a new repo in your GitHub org named exactly `.github`
2. Push the contents of this directory to it
3. GitHub automatically uses it as the org default for:
   - Issue templates (ISSUE_TEMPLATE/)
   - PR template (PULL_REQUEST_TEMPLATE.md)
   - Reusable workflows (workflows/)

No configuration needed — the repo name `.github` is the convention GitHub recognises.
