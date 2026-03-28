# Setup Guide

Step-by-step instructions to activate the shared CI/CD pipeline across all forgedTechApps repos.

---

## Workflow versioning

Reusable workflows in this repo are versioned using Git tags (`v1`, `v2`, etc.).

- **`@v1`** is the stable tag — all product CI files must reference `@v1`, not `@main`
- **`@main`** is an unstable moving reference and must not be used in production
- To ship a patch or non-breaking improvement to all repos: push to `main`, then
  move the tag: `git tag -f v1 && git push --force origin v1`
- To introduce a breaking change: cut a new `@v2` tag and migrate product repos
  individually

After the initial push (Step 1 below), create the `v1` tag:

```bash
git tag v1
git push origin v1
```

---

## Step 1 — Create the `.github` repo

1. Go to `github.com/forgedTechApps`
2. Create a new repository named exactly `.github`
3. Set visibility to **Private**
4. Do not initialise with a README

Then push the contents of this package:

```bash
cd forgedTechApps   # the extracted package directory

git init
git add .
git commit -m "feat: initialise forgedTechApps org-wide CI configuration"
git branch -M main
git remote add origin https://github.com/forgedTechApps/.github.git
git push -u origin main
```

From this moment:
- Issue templates apply to every repo in the org
- PR template applies to every repo
- Reusable workflows are available for product repos to call

---

## Step 2 — Add the org-level secret

One secret set at org level is shared by all repos automatically.

`NVD_API_KEY` — used by OWASP Dependency-Check for faster CVE database access.
Optional but recommended — without it scans are slower and may rate-limit.

**Get the key:**
Go to `nvd.nist.gov/developers/request-an-api-key` → fill in name and email → key arrives by email within minutes.

**Add to org:**
Go to `github.com/organizations/forgedTechApps/settings/secrets/actions`
→ New organisation secret → Name: `NVD_API_KEY` → paste value
→ Repository access: **All repositories**

---

## Step 3 — Add the CI file to each product repo

Copy the relevant file from `product-ci-examples/` into each product repo:

| Product repo | CI example file | Destination in that repo |
|---|---|---|
| `forge-pipe-mcp` | `forge-pipe-mcp-ci.yml` | `.github/workflows/ci.yml` |
| `alula` | `alula-ci.yml` | `.github/workflows/ci.yml` |
| `networkpulse` | `networkpulse-ci.yml` | `.github/workflows/ci.yml` |
| `eleven11` | `eleven11-ci.yml` | `.github/workflows/ci.yml` |
| `forge` | `forge-ci.yml` | `.github/workflows/ci.yml` |

For each product repo:

```bash
# Example for forge-pipe-mcp
mkdir -p .github/workflows
cp /path/to/forge-pipe-mcp-ci.yml .github/workflows/ci.yml
git add .github/workflows/ci.yml
git commit -m "ci: add shared pipeline"
git push
```

---

## Step 4 — Add per-repo secrets

Some repos need their own secrets (deploy tokens etc.).

**forge-pipe-mcp:**

| Secret | Where to get it |
|---|---|
| `RAILWAY_TOKEN` | Railway dashboard → Account Settings → Tokens (production service) |
| `RAILWAY_TOKEN_DEV` | Railway dashboard → Account Settings → Tokens (dev service) |
| `RAILWAY_PUBLIC_URL` | Railway dashboard → your service → Settings → Domains |

Add at: `github.com/forgedTechApps/forge-pipe-mcp/settings/secrets/actions`

Other products: add deployment secrets as you configure each product's deploy step.

---

## Step 5 — Configure GitHub Environments

Each product repo that deploys needs two environments configured in GitHub.

For each repo go to: **Settings → Environments → New environment**

**`development` environment:**
- No required reviewers (deploys automatically on merge to `dev`)
- Add any dev-specific secrets (e.g. `RAILWAY_TOKEN_DEV`)

**`production` environment:**
- Required reviewers: add at least 1 (prevents accidental production deploys)
- Add production secrets (e.g. `RAILWAY_TOKEN`, `RAILWAY_PUBLIC_URL`)

---

## Step 6 — Configure org-level branch protection

Two rulesets — one strict for `main`, one permissive for `dev`.

Go to: `github.com/organizations/forgedTechApps/settings/rules`

### Ruleset 1: `protect-main`

Click **New ruleset → New branch ruleset** and configure:

| Setting | Value |
|---|---|
| Ruleset name | `protect-main` |
| Enforcement | Active |
| Target repositories | All repositories |
| Target branches | `main` |
| Require pull request | ✅ · Required approvals: 1 |
| Dismiss stale reviews on push | ✅ |
| Require status checks | ✅ |
| Require branches to be up to date | ✅ |
| Require conversation resolution | ✅ |
| Require linear history | ✅ |
| Block force pushes | ✅ |
| Restrict deletions | ✅ |
| **Restrict who can push** | ✅ · **No one** — all changes via PR from `dev` only |

### Ruleset 2: `protect-dev`

Click **New ruleset → New branch ruleset** and configure:

| Setting | Value |
|---|---|
| Ruleset name | `protect-dev` |
| Enforcement | Active |
| Target repositories | All repositories |
| Target branches | `dev` |
| Require pull request | ✅ · Required approvals: 1 |
| Dismiss stale reviews on push | ✅ |
| Require status checks | ✅ |
| Require branches to be up to date | ✅ |
| Require conversation resolution | ✅ |
| Block force pushes | ✅ |
| Restrict deletions | ✅ |

> `dev` intentionally omits **Require linear history** to allow merge commits from feature branches.
> Force push is still blocked to protect shared history.

**Required status checks:** After your first CI run on any repo, the check
names appear in autocomplete. The check name is the `name:` field in the
reusable workflow's job — e.g. `Quality Gate (Node.js)`, `Quality Gate (Flutter)`, `Quality Gate (Swift/iOS)`.

You must run CI at least once before adding required checks — GitHub needs
to have seen the check name to accept it.

---

## Step 7 — Verify everything works

Open a test PR in any product repo:
- Issue template should appear when creating issues
- PR template should pre-fill the PR description
- CI should run and all gates should appear as checks
- Direct push to `main` should be rejected
- Merging should be blocked until CI passes and PR is approved

---

## Branching model

All repos follow GitFlow:

```
feature/* ──┐
fix/*       ├──▶ dev ──▶ main
hotfix/*  ──┘
```

- **Feature/fix work:** branch from `dev`, PR back to `dev`
- **Release:** PR from `dev` to `main` — triggers production deploy
- **Hotfix:** branch from `main`, PR to both `main` and `dev`
- **Direct pushes to `main` are blocked** — all changes flow through PRs

---

## Adding a new repo later

1. Create the repo under `forgedTechApps`
2. Create a `dev` branch from `main`
3. Copy the relevant CI example into `.github/workflows/ci.yml`
4. Add a `CLAUDE.md` at the repo root
5. Configure `development` and `production` GitHub Environments
6. Add any repo-specific secrets (deploy tokens etc.)
7. The org-level branch protection and issue templates apply automatically
8. Open a test PR — done
