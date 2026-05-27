# Increment 1 PR Plan — Taxonomy + Principle Extraction

**Tracking issue:** [#1](https://github.com/forgedTechApps/.github/issues/1)
**Target:** Week 1
**Branch:** `feat/taxonomy-tier-metadata`
**PR scope:** schema + org-defaults + MCP server + CLAUDE.md template + 11 project propagations + gitignores

Zero agent behavioural change. Adds tier metadata, extracts principles to CLAUDE.md, surfaces deferred invariants.

---

## Pre-flight (10 min)

```bash
cd /Users/dev/Development/forgedtech
git checkout -b feat/taxonomy-tier-metadata
git status  # confirm clean working tree
```

If `.DS_Store` modifications are showing, stash or discard — not part of this PR.

---

## Step 1 — Schema changes

**File:** `agent-standards/schema/agent-standards.schema.json`

### 1a. Add a reusable `$defs/tieredRule` definition

In the `$defs` block (alongside `modelSpec`), add:

```json
"tieredRule": {
  "oneOf": [
    { "type": "string", "description": "Legacy plain-string rule. Treated as tier: practice. Schema v2 will deprecate this form." },
    {
      "type": "object",
      "additionalProperties": false,
      "required": ["rule", "tier"],
      "properties": {
        "rule": { "type": "string", "description": "The rule text shown to agents." },
        "tier": {
          "type": "string",
          "enum": ["invariant", "gate", "practice"],
          "description": "Enforcement tier. Principles do not live in this file — they live in CLAUDE.md."
        },
        "id": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9_]*$",
          "description": "Stable rule identifier for metrics and drift-log correlation."
        },
        "check_command": {
          "type": "string",
          "description": "Command, MCP tool, or CI job that enforces this rule. Format: 'mcp:tool_name', 'ci:job_name', or 'scripts/path.sh'."
        },
        "severity": {
          "type": "string",
          "enum": ["error", "warn", "info"],
          "default": "error"
        },
        "deferred": {
          "type": "object",
          "additionalProperties": false,
          "required": ["owner", "target"],
          "properties": {
            "owner": { "type": "string", "description": "Person accountable for landing the check." },
            "target": { "type": "string", "description": "Target window or milestone (e.g. 'W12', '2026-Q3')." },
            "reason": { "type": "string", "description": "Why the check isn't built yet." },
            "issue": { "type": "string", "description": "Tracking issue URL or number." }
          },
          "description": "Present when the rule is declared but its check_command isn't yet built. get_standards surfaces these as DEFERRED_INVARIANT_NO_CHECK info findings."
        }
      }
    }
  ]
}
```

### 1b. Update rule arrays to accept `tieredRule`

Change `style.items`, `style_ui.items`, `architecture.rules.items`, `architecture.rules_ui.items` from `{ "type": "string" }` to `{ "$ref": "#/$defs/tieredRule" }`.

This is **backwards compatible** — every existing plain-string rule still validates. New entries can be objects.

### 1c. Bump schema version

Change `version.const` from `1` to `2`. Update description: *"Schema version. v2 adds tier metadata on rules; plain strings still accepted as legacy form (tier: practice)."*

Set `oneOf: [{ const: 1 }, { const: 2 }]` to keep v1 valid during transition.

---

## Step 2 — `standards.ts` type + normalisation

**File:** `mcp-server/src/standards.ts`

### 2a. Add types (after `ModelSpec` interface)

```typescript
export type Tier = "invariant" | "gate" | "practice";

export interface DeferredCheck {
  owner: string;
  target: string;
  reason?: string;
  issue?: string;
}

export interface NormalisedRule {
  rule: string;
  tier: Tier;
  id?: string;
  check_command?: string;
  severity: "error" | "warn" | "info";
  deferred?: DeferredCheck;
}

export type RawRule = string | (Omit<NormalisedRule, "severity"> & { severity?: "error" | "warn" | "info" });
```

### 2b. Update `AgentStandards` interface

Change array types from `string[]` to `RawRule[]` for `style`, `style_ui`, `architecture.rules`, `architecture.rules_ui`.

Bump version field type: `version: 1 | 2`.

### 2c. Add normalisation helper (after `foldUiRules`)

```typescript
function normaliseRule(r: RawRule): NormalisedRule {
  if (typeof r === "string") {
    return { rule: r, tier: "practice", severity: "error" };
  }
  return { severity: "error", ...r };
}

/**
 * Returns standards with all rule arrays normalised + grouped by tier for
 * convenient consumption. Original arrays preserved on the root object so
 * existing consumers don't break.
 */
export interface StandardsWithTiers extends AgentStandards {
  rules_by_tier: {
    invariant: NormalisedRule[];
    gate: NormalisedRule[];
    practice: NormalisedRule[];
  };
  deferred_invariants: Array<NormalisedRule & { source: "style" | "style_ui" | "architecture.rules" | "architecture.rules_ui" }>;
}

export function groupRulesByTier(s: AgentStandards): StandardsWithTiers {
  const groups: StandardsWithTiers["rules_by_tier"] = { invariant: [], gate: [], practice: [] };
  const deferred: StandardsWithTiers["deferred_invariants"] = [];

  const collect = (arr: RawRule[] | undefined, source: "style" | "style_ui" | "architecture.rules" | "architecture.rules_ui") => {
    for (const raw of arr ?? []) {
      const n = normaliseRule(raw);
      groups[n.tier].push(n);
      if (n.tier === "invariant" && n.deferred) {
        deferred.push({ ...n, source });
      }
    }
  };

  collect(s.style, "style");
  collect(s.style_ui, "style_ui");
  collect(s.architecture?.rules, "architecture.rules");
  collect(s.architecture?.rules_ui, "architecture.rules_ui");

  return { ...s, rules_by_tier: groups, deferred_invariants: deferred };
}
```

### 2d. Update `loadStandards` return type signature

Optional — can be done in same PR or deferred. If done now, `loadStandards` returns `Promise<AgentStandards>` still; new helper `loadStandardsWithTiers(repoRoot)` returns `Promise<StandardsWithTiers>`.

---

## Step 3 — Update `get_standards` and `check_paths` handlers

**File:** `mcp-server/src/server.ts`

### 3a. `get_standards` handler (around line 365)

```typescript
if (req.params.name === "get_standards") {
  const args = GetStandardsArgs.parse(req.params.arguments ?? {});
  const standards = await loadStandards(args.repo_root);
  const grouped = groupRulesByTier(standards);
  return { content: [{ type: "text", text: JSON.stringify(grouped, null, 2) }] };
}
```

Add `groupRulesByTier` to the import from `./standards.js`.

### 3b. `check_paths` handler — surface deferred invariants

After the existing `result` mapping (around line 425), add:

```typescript
const grouped = groupRulesByTier(standards);
const deferredFindings = grouped.deferred_invariants.map((d) => ({
  severity: "info" as const,
  code: "DEFERRED_INVARIANT_NO_CHECK",
  message: `Invariant '${d.id ?? d.rule.slice(0, 60)}' declared but check not built. Owner: ${d.deferred!.owner}, target: ${d.deferred!.target}${d.deferred!.issue ? `, issue: ${d.deferred!.issue}` : ""}.`,
}));

return {
  content: [{
    type: "text",
    text: JSON.stringify({ paths: result, deferred_invariants: deferredFindings }, null, 2)
  }]
};
```

---

## Step 4 — Update `org-defaults.yml` with tier metadata

**Files (sync these two together):**
- `agent-standards/defaults/org-defaults.yml` (source of truth)
- `mcp-server/templates/defaults/org-defaults.yml` (bundled copy — must match)

### 4a. Add header note

```yaml
# forgedTechApps org-wide defaults.
#
# This file contains only Invariants, Gates, and Practices.
# Principles (cultural rules: "functions do one thing", "names communicate
# intent") live in each project's CLAUDE.md — see the Principles section
# of agent-standards/templates/CLAUDE.md.template.
#
# Each rule has a tier:
#   - invariant: mechanically verifiable. Has check_command. Violation = bug.
#   - gate:      workflow checkpoint. Halts until satisfied.
#   - practice:  observable in records, not pre-checked. Drift-log catches.
#
# (Plain-string rules are treated as tier: practice for backwards compat.)
```

### 4b. Convert `style:` rules

Remove principles (Functions do one thing, Names communicate intent, DRY/SOLID/KISS/YAGNI acronyms, "Scope discipline: implement exactly what was requested" spirit, "Refactor only after it works" spirit).

Convert remaining rules to object form with `tier:`. Example:

```yaml
style:
  - rule: "No commented-out code in committed changes. Delete it — git history is the archive."
    tier: invariant
    id: no_commented_code
    check_command: "scripts/check-no-commented-code.sh"
    severity: error
    deferred:
      owner: "Carlos"
      target: "W6"
      reason: "Script not yet built — Increment 6"

  - rule: "No TODOs without a linked tracking issue (e.g. `// TODO(#123): ...`)."
    tier: invariant
    id: no_untracked_todos
    check_command: "scripts/check-todos-tracked.sh"
    severity: error
    deferred:
      owner: "Carlos"
      target: "W6"
      reason: "Script not yet built — Increment 6"

  - rule: "Conventional Commits: feat:, fix:, chore:, test:, docs:, ci:, refactor:, perf:, style:."
    tier: invariant
    id: conventional_commits
    check_command: "ci:commitlint"
    severity: error

  - rule: "Three uses = extract to shared module (packages/shared, common utilities)."
    tier: practice
    id: three_uses_extract

  # Workflow discipline (practices)
  - rule: "Plan before coding. State hypothesis + intended file changes + test approach BEFORE writing code."
    tier: practice
    id: plan_before_code

  - rule: "Break tasks into 3–5 focused chunks. >5 file changes or >2 unrelated areas → split."
    tier: practice
    id: task_chunking

  - rule: "Tests are non-negotiable. Known behaviour → test-first. Unknown behaviour → build-then-test."
    tier: practice
    id: test_order_by_spec

  - rule: "After every two search/read operations, write findings somewhere durable."
    tier: practice
    id: durable_findings

  - rule: "If you made a mistake the user had to correct, propose a one-line addition to CLAUDE.md or .agent-standards.yml via propose_claude_md_rule."
    tier: practice
    id: propose_rule_after_correction

  # Token/context discipline (practices)
  - rule: "Find before reading. Use Grep / search for symbols and keywords first."
    tier: practice
    id: find_before_read

  - rule: "Don't re-read files within a session unless you suspect they've changed."
    tier: practice
    id: no_redundant_reads

  - rule: "Long file or huge log? Read with offset/limit, or filter through grep / head / tail."
    tier: practice
    id: offset_limit_for_long_files

  - rule: "Between unrelated tasks, prefer /clear over patching forward."
    tier: practice
    id: clear_between_unrelated_tasks

  - rule: "Prefer /clear over /compact when stale context is hurting accuracy."
    tier: practice
    id: compact_only_for_same_task
```

### 4c. Convert `style_ui:` rules

```yaml
style_ui:
  - rule: "Component-driven design: views composed from small, single-purpose, reusable components."
    tier: practice
    id: component_driven_design

  - rule: "A view file > 200 lines is a smell — extract subviews."
    tier: invariant
    id: view_size_limit
    check_command: "scripts/check-view-size.sh"
    severity: warn
    deferred:
      owner: "Carlos"
      target: "Beyond W15"
      reason: "Not on critical path; promote when metrics justify."

  - rule: "Design tokens (colors, spacing, typography, radii) come from a single source."
    tier: invariant
    id: design_tokens_only
    check_command: "mcp:check_design_consistency"
    severity: error

  - rule: "Shared component library is the home for cross-feature primitives. Feature folders consume from it."
    tier: practice
    id: shared_component_library

  - rule: "Storybook / catalog page / preview app for the component library when feasible."
    tier: practice
    id: component_catalog
```

(Removed: "Components own their styling…" → moved to CLAUDE.md principles.)

### 4d. Convert `architecture.rules:` similarly

Key conversions:

```yaml
architecture:
  rules:
    - rule: "Input validation at every system boundary: HTTP, queue, file I/O, IPC."
      tier: practice
      id: input_validation_at_boundary
      # Generic check too hard; remains Practice.

    - rule: "Authorisation at the resource level, not just the route."
      tier: practice
      id: authorisation_at_resource_level
      deferred:
        owner: "Carlos"
        target: "W18"
        reason: "Generic AST check infeasible. Mitigated via cross-tenant integration test as Invariant."
        issue: "https://github.com/forgedTechApps/.github/issues/7"

    - rule: "External HTTP calls must set explicit timeouts."
      tier: invariant
      id: external_http_has_timeout
      check_command: "scripts/check-http-timeouts.sh"
      severity: error
      deferred:
        owner: "Carlos"
        target: "W13"
        issue: "https://github.com/forgedTechApps/.github/issues/6"

    - rule: "Logging never includes PII, credentials, tokens, or full request bodies."
      tier: practice
      id: no_pii_in_logs
      deferred:
        owner: "Carlos"
        target: "W13"
        reason: "Will promote to Invariant when log-format pre-commit ships."
        issue: "https://github.com/forgedTechApps/.github/issues/5"

    - rule: "Secrets via environment variables or a secret store ONLY. Never in committed files."
      tier: invariant
      id: no_committed_secrets
      check_command: "mcp:check_secrets"
      severity: error

    - rule: "All deployable services declare a complete .env.example."
      tier: invariant
      id: env_example_present
      check_command: "scripts/check-env-example.sh"
      severity: error
      deferred:
        owner: "Carlos"
        target: "Beyond W15"

    - rule: "Service-role keys / admin tokens never flow to clients. Server-only."
      tier: invariant
      id: service_role_keys_not_in_client
      check_command: "scripts/check-client-bundle-secrets.sh"
      severity: error
      deferred:
        owner: "Carlos"
        target: "W12"
        issue: "https://github.com/forgedTechApps/.github/issues/3"

    - rule: "SQL: parameterised queries only. String concatenation in queries is rejected."
      tier: invariant
      id: parameterised_queries_only
      check_command: "ci:semgrep-sqli"
      severity: error
      deferred:
        owner: "Carlos"
        target: "W12"
        issue: "https://github.com/forgedTechApps/.github/issues/4"

    - rule: "Schema migrations are forward-only and reversible (or document why not)."
      tier: practice
      id: migrations_forward_only

    - rule: "Database access goes through a repository / data-access layer."
      tier: invariant
      id: db_access_via_dal
      check_command: "scripts/check-dal-only.sh"
      severity: error
      deferred:
        owner: "Carlos"
        target: "Beyond W15"

    - rule: "HTTP services set security headers: HSTS, CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy."
      tier: invariant
      id: http_security_headers
      check_command: "scripts/check-security-headers.sh"
      severity: error
      deferred:
        owner: "Carlos"
        target: "Beyond W15"

    - rule: "CORS allowlist is explicit per-origin. No `*` for credentialed endpoints."
      tier: invariant
      id: cors_explicit_origins
      check_command: "scripts/check-cors-config.sh"
      severity: error
      deferred:
        owner: "Carlos"
        target: "Beyond W15"

    - rule: "Rate-limit every public endpoint. Surface 429 with Retry-After."
      tier: practice
      id: public_endpoints_rate_limited

    - rule: "Auth changes reviewed against OWASP ASVS Level 1."
      tier: gate
      id: auth_change_asvs_artifact
      check_command: "mcp:attach_asvs_review"
      severity: error
      deferred:
        owner: "Carlos"
        target: "W5"

    - rule: "Auth/input/data/templating changes trigger OWASP Top 10 mental review."
      tier: practice
      id: owasp_top_10_mental_review
```

### 4e. Keep non-rule blocks unchanged

`sensitive_paths`, `test_coverage`, `review`, `investigation`, `branching`, vulnerability-scanning comment block — all stay as-is.

### 4f. Sync to bundled copy

```bash
cp agent-standards/defaults/org-defaults.yml mcp-server/templates/defaults/org-defaults.yml
```

---

## Step 5 — CLAUDE.md template: add Principles section

**File:** `agent-standards/templates/CLAUDE.md.template`

Add a new section near the top (after the project-context paragraph, before model routing):

```markdown
## Principles

These are cultural guidelines, not enforceable rules. They inform judgement
when the rulebook is silent. They live here, not in `.agent-standards.yml`,
because they cannot be mechanically checked.

- **Functions do one thing.** If a function name uses "and", split it.
- **Names communicate intent.** Single-letter variables only in tight loops or
  well-known math (i, j, x, y).
- **DRY, SOLID, KISS, YAGNI.** Build for current requirements. No speculative
  abstraction. Three similar lines beats a premature factory.
- **Implement exactly what was requested.** No "while I'm here" refactors. The
  Gate version of this is `scope_expansion` (W3); the principle is the spirit.
- **Refactor only after it works.** Make the change pass tests first;
  restructure second. Refactoring mid-feature loses the thread.
- **Components own their styling.** Never reach into a parent or sibling.
  Communicate via props/inputs and events/callbacks. (The mechanical version
  of this is the design-token Invariants.)

Conflicts between principles are resolved by judgement, not by the rulebook.
If you find yourself repeatedly invoking a principle to justify a decision,
that's signal — consider proposing a Practice or Gate via
`propose_claude_md_rule`.
```

---

## Step 6 — Propagate to 11 project CLAUDE.mds

For each project, add the same Principles section (or a link to a shared
`PRINCIPLES.md` if you prefer one source).

Projects to update (in order — easiest first, sensitive trio last):

1. `eleven11v2/CLAUDE.md`
2. `networkPulse/CLAUDE.md`
3. `Viyr/CLAUDE.md`
4. `forgev2/CLAUDE.md`
5. `forge-ios/CLAUDE.md`
6. `veda/CLAUDE.md`
7. `veda-ios/CLAUDE.md`
8. `veda-proxy/CLAUDE.md`
9. `kurata/CLAUDE.md`
10. `MS .NET/TradingBot/CLAUDE.md`
11. `forgedtech/CLAUDE.md` (if exists)

**Recommended:** create `agent-standards/templates/PRINCIPLES.md`, then each project's CLAUDE.md adds a short pointer:

```markdown
## Principles

See [forgedtech/agent-standards/templates/PRINCIPLES.md](...) for org-wide
principles. Project-specific principles below.

<!-- project-specific principles, if any -->
```

This avoids 11 copies that will drift.

---

## Step 7 — Gitignore fixes (the section-9 gap)

For each project, ensure `.gitignore` contains:

```
# agent-standards local state — not for commit
.agent-standards-tasks.json
.agent-standards-drift.jsonl
.agent-state/
```

Quick check loop:

```bash
for dir in eleven11v2 networkPulse Viyr forgev2 forge-ios veda veda-ios veda-proxy kurata; do
  echo "=== $dir ==="
  grep -E "agent-standards-(tasks|drift)" "/Users/dev/Development/$dir/.gitignore" 2>/dev/null || echo "MISSING"
done
grep -E "agent-standards-(tasks|drift)" "/Users/dev/Development/MS .NET/TradingBot/.gitignore" 2>/dev/null || echo "MISSING"
```

For each `MISSING`, append the three lines above.

---

## Step 8 — Build + smoke test

```bash
cd /Users/dev/Development/forgedtech/mcp-server
pnpm build  # or npm run build — verify TypeScript compiles
```

**Manual smoke tests:**

1. Restart Claude Code in `Viyr/` (any UI project). Call `get_standards`.
   - Expect: response includes `rules_by_tier` with `invariant`/`gate`/`practice` keys.
   - Expect: no validation errors on existing `.agent-standards.yml` files.

2. Call `check_paths` with any path. Expect: response includes
   `deferred_invariants` array surfacing the 6+ deferred items.

3. Open a project that uses the legacy plain-string rule form (every project
   currently). Verify standards still load — backwards compat works.

---

## Step 9 — Commit + PR

```bash
cd /Users/dev/Development/forgedtech
git add agent-standards/ mcp-server/
git status  # review

git commit -m "$(cat <<'EOF'
feat(standards): tier metadata + principle extraction (Increment 1)

Schema v2 adds tier (invariant|gate|practice) and deferred owner/target
metadata to rule entries. Plain-string rules still accepted as practice
for backwards compatibility.

Principles (DRY/SOLID/KISS, "functions do one thing", etc.) moved from
org-defaults.yml to a shared PRINCIPLES.md referenced from each project's
CLAUDE.md.

get_standards now returns rules grouped by tier. check_paths surfaces
DEFERRED_INVARIANT_NO_CHECK info findings for declared-but-unbuilt checks.

Tracking: forgedTechApps/.github#1
EOF
)"
```

Repeat per-project commits for `CLAUDE.md` + `.gitignore` updates in each
project repo (separate PRs per project; they don't depend on each other once
the central PR merges).

---

## Step 10 — Update tracking issue

```bash
gh issue comment 1 --repo forgedTechApps/.github --body "Increment 1 shipped — PR: <link>. Schema v2 live, principles extracted to PRINCIPLES.md, 6 deferred invariants surfaced via check_paths."
gh issue edit 1 --repo forgedTechApps/.github --body "<updated body with W1 box checked>"
```

---

## Stopping conditions

If any of these happen, stop and reassess:

- Schema validation fails on existing project files → backwards-compat bug; fix the `oneOf` in `tieredRule`.
- `get_standards` returns empty `rules_by_tier` → normalisation bug; check `groupRulesByTier`.
- MCP server fails to start in any project → check `pnpm build` output; the bundled `org-defaults.yml` copy may be out of sync.
- Existing tests fail → fix before propagating.

---

## What's NOT in this PR

Deferred to later increments:
- `start_task` field changes (Increment 2)
- `expand_scope` tool (Increment 3)
- Any actual check scripts for the deferred invariants (Increments 6-10)
- Hooks (Increment 9)
- Metrics tool (Increment 11)

---

## Estimated effort

- Schema + standards.ts + server.ts: ~2 hours
- org-defaults.yml conversion: ~1.5 hours (mechanical)
- PRINCIPLES.md + 11 project pointers: ~1 hour
- Gitignore audit + fix: ~30 min
- Build, smoke tests, PR: ~1 hour

**Total: ~6 hours, single sitting feasible.**
