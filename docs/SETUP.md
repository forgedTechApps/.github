# Setup Guide

Step-by-step instructions to activate the shared CI/CD pipeline across all forgedTech repos.

---

## Step 1 — Create the `.github` repo

1. Go to `github.com/forgedTech`
2. Create a new repository named exactly `.github`
3. Set visibility to **Private**
4. Do not initialise with a README

Then push the contents of this package:

```bash
cd forgedtech   # the extracted package directory

git init
git add .
git commit -m "feat: initialise forgedTech org-wide CI configuration"
git branch -M main
git remote add origin https://github.com/forgedTech/.github.git
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
Go to `github.com/organizations/forgedTech/settings/secrets/actions`
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
| `RAILWAY_TOKEN` | Railway dashboard → Account Settings → Tokens |
| `RAILWAY_PUBLIC_URL` | Railway dashboard → your service → Settings → Domains |

Add at: `github.com/forgedTech/forge-pipe-mcp/settings/secrets/actions`

Other products: add deployment secrets as you configure each product's deploy step.

---

## Step 5 — Configure org-level branch protection

One ruleset protects `main` across all repos.

1. Go to: `github.com/organizations/forgedTech/settings/rules`
2. Click **New ruleset → New branch ruleset**
3. Configure:

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

**Required status checks:** After your first CI run on any repo, the check
names appear in autocomplete. The check name is the `name:` field in the
reusable workflow's job — e.g. `CI`, `CI (Flutter)`, `CI (Swift/iOS)`.

You must run CI at least once before adding required checks — GitHub needs
to have seen the check name to accept it.

---

## Step 6 — Verify everything works

Open a test PR in any product repo:
- Issue template should appear when creating issues
- PR template should pre-fill the PR description
- CI should run and all gates should appear as checks
- Merging should be blocked until CI passes

---

## Adding a new repo later

1. Create the repo under `forgedTech`
2. Copy the relevant CI example into `.github/workflows/ci.yml`
3. Add a `CLAUDE.md` at the repo root
4. The org-level branch protection and issue templates apply automatically
5. Add any repo-specific secrets (deploy tokens etc.)
6. Open a test PR — done
