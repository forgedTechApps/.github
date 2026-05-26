# forgedTechApps — Revised `org-defaults.yml`

**Document 3 of 3.** This is a proposed structure for the revised
`org-defaults.yml`, organised by the tier taxonomy from Document 1 and
including the new rules from Document 2's Phase 1.

---

## Important disclaimer

I'm working from your summary document, not the actual `org-defaults.yml`
file. The structure below is my best inference of how it should look given
what the summary describes plus the new structure. Treat this as a structural
proposal to diff against the real file, not a drop-in replacement.

Specifically I'm inferring:
- The deep-merge semantics for how projects extend org-defaults.
- The exact field names your existing MCP tools read (I've used names that
  match the summary; rename to match the actual implementation).
- How the schema versioning works (I've added a `schema_version` field; if
  one already exists, use that).

Where I've kept rules verbatim from your summary, they retain the same intent.
Where I've added or restructured, the rationale is in the comments.

---

## The file

```yaml
# .agent-standards.yml — org-defaults
# forgedTechApps standard ruleset, organised by tier taxonomy.
# See docs/agent-standards/taxonomy.md for the tier definitions.

schema_version: 2
extends: null  # this is the root

# ============================================================================
# META
# ============================================================================

meta:
  org: forgedtech
  description: |
    Org-wide defaults. Projects extend this file and override or add rules.
    Every rule below has a tier: invariant | gate | practice | principle.
    Principles do not live in this file; they live in the project CLAUDE.md.

# ============================================================================
# INVARIANTS — mechanically verifiable properties of the codebase.
# Each one has a check_command. CI runs them. Failure blocks merge.
# ============================================================================

invariants:

  # --- Code hygiene ---

  no_commented_code:
    description: "No commented-out code in commits."
    check_command: "scripts/check-no-commented-code.sh"
    severity: error
    applies_to: ["**/*"]

  no_untracked_todos:
    description: "Every TODO/FIXME/HACK must reference an issue ID."
    check_command: "scripts/check-todos-tracked.sh"
    severity: error
    applies_to: ["**/*"]
    config:
      pattern: "(TODO|FIXME|HACK)\\(#\\d+\\)"

  conventional_commits:
    description: "Commit messages follow Conventional Commits."
    check_command: "commitlint"
    severity: error

  # --- Secrets and credentials ---

  no_committed_secrets:
    description: |
      No secrets (API keys, tokens, PEM keys, JWTs) committed.
      Includes forge-pipe, AWS, GitHub, Slack, Stripe, OpenAI, Anthropic,
      Supabase. Allowlist + entropy + inline opt-out supported.
    check_command: "mcp:check_secrets"
    severity: error

  env_example_present:
    description: "Every deployable service has .env.example."
    check_command: "scripts/check-env-example.sh"
    severity: error
    applies_to_projects_where:
      has_deployable_service: true

  service_role_keys_not_in_client:
    # NEW — was prose-only, now an invariant per migration plan 1.x / 4.2
    description: |
      Client bundles must not contain service-role keys. Build-time scan
      compares compiled client output against patterns from .env.example.
    check_command: "scripts/check-client-bundle-secrets.sh"
    severity: error
    applies_to_projects_where:
      has_client_build: true

  # --- Data access and SQL ---

  parameterised_queries_only:
    # NEW — was prose-only, now an invariant per migration plan 4.1
    description: |
      No string-concatenated SQL. All queries use parameterisation or
      query-builder.
    check_command: "scripts/check-sql-parameterisation.sh"
    severity: error
    applies_to: ["**/*.{ts,js,py,cs,swift,kt}"]

  db_access_via_dal:
    description: |
      UI and route handlers do not import database drivers directly.
      DB access goes through repository/DAL layer.
    check_command: "scripts/check-dal-only.sh"
    severity: error
    config:
      forbidden_imports_in:
        - "**/routes/**"
        - "**/components/**"
        - "**/pages/**"
        - "**/views/**"
      forbidden_packages:
        - "pg"
        - "mysql2"
        - "sqlite3"
        # project-specific additions in project standards

  multi_tenant_query_isolation:
    # NEW — generalises Kurata's householdId rule per migration plan 1.4
    description: |
      For multi-tenant projects, every query function in the data layer
      accepts and filters by the tenant ID.
    check_command: "scripts/check-tenant-isolation.sh"
    severity: error
    applies_to_projects_where:
      multi_tenant: true
    config:
      # Each project sets:
      # tenant_id_field: "householdId" (or "accountId", etc.)
      # data_layer_paths: ["packages/db/queries/**"]
      # bypass_comment: "# tenant-isolation: bypass <reason>"
      requires_project_config: true

  # --- HTTP and network ---

  external_http_has_timeout:
    description: "External HTTP calls have explicit timeouts."
    check_command: "scripts/check-http-timeouts.sh"
    severity: error

  http_security_headers:
    description: |
      HTTP services set HSTS, CSP, X-Content-Type-Options, X-Frame-Options
      (or frame-ancestors), Referrer-Policy.
    check_command: "scripts/check-security-headers.sh"
    severity: error
    applies_to_projects_where:
      has_http_service: true

  cors_explicit_origins:
    description: "CORS allowlist is explicit per-origin. No '*' for credentialed."
    check_command: "scripts/check-cors-config.sh"
    severity: error

  public_endpoints_rate_limited:
    description: "Every public endpoint declares a rate limit."
    check_command: "scripts/check-rate-limits.sh"
    severity: error

  # --- Money (TradingBot, but generally useful) ---

  decimal_for_money:
    description: "Monetary values use a decimal type, never floating-point."
    check_command: "scripts/check-money-types.sh"
    severity: error
    applies_to_projects_where:
      handles_money: true

  # --- UI ---

  no_off_token_colors:
    description: "No hardcoded hex colors. Use design tokens."
    check_command: "mcp:check_design_consistency"
    severity: error
    applies_to_projects_where:
      ci_kind: ["mobile", "web"]

  no_off_token_spacing:
    description: "No off-scale spacing values."
    check_command: "mcp:check_design_consistency"
    severity: error
    applies_to_projects_where:
      ci_kind: ["mobile", "web"]

  view_size_limit:
    description: "View files > 200 lines must be split into subviews."
    check_command: "scripts/check-view-size.sh"
    severity: error
    applies_to_projects_where:
      ci_kind: ["mobile", "web"]
    config:
      max_lines: 200
      applies_to: ["**/components/**", "**/views/**", "**/screens/**"]

  # --- Coverage ---

  coverage_floors:
    description: "Test coverage meets configured floors."
    check_command: "scripts/check-coverage.sh"
    severity: error
    config:
      unit_min: 60
      integration_min: 40
      # projects override to raise; per_surface uplifts also supported

  regression_tests_required:
    description: "Auth and migration paths require regression tests."
    check_command: "scripts/check-regression-coverage.sh"
    severity: error
    config:
      required_paths:
        - "**/auth/**"
        - "**/migrations/**"

  # --- Branching ---

  required_branches:
    description: "Required branches exist."
    check_command: "mcp:check_branching"
    severity: error
    config:
      required: ["main", "dev"]
      default: "main"

  feature_branch_pattern:
    description: "Feature branches match Conventional-Commits-style pattern."
    check_command: "scripts/check-branch-name.sh"
    severity: error
    config:
      pattern: "^(feat|fix|chore|docs|test|ci|refactor|perf|style)/[a-z0-9._-]+$"

  no_force_push_protected:
    description: "main and dev forbid force-push."
    check_command: "mcp:check_branching"
    severity: error

  # --- Vuln scanning ---

  codeql_clean:
    description: "CodeQL SAST passes (security-extended + security-and-quality)."
    check_command: "ci:codeql"
    severity: error

  dependency_check_clean:
    description: "OWASP Dependency-Check passes (CVSS >= 7 fails)."
    check_command: "ci:dependency-check"
    severity: error
    config:
      cvss_threshold: 7

  osv_scanner_clean:
    description: "OSV Scanner passes against lockfiles."
    check_command: "ci:osv-scan"
    severity: error

  # --- Workflow record-keeping (NEW Invariants from migration plan) ---

  task_records_for_significant_changes:
    description: |
      PRs with >5 file changes or touching gated paths must reference a
      task_id from .agent-standards-tasks.json.
    check_command: "scripts/check-pr-references-task.sh"
    severity: error

# ============================================================================
# GATES — workflow checkpoints. Enforced by MCP, hooks, or CI.
# Each one halts the workflow until a condition is met.
# ============================================================================

gates:

  # --- Phase and model routing ---

  model_phase_match:
    description: |
      Model family must match the phase's expected family.
      planning -> opus, execution -> sonnet.
      Honour-system: agent self-declares current_model. Hooked at
      SessionStart to surface mismatch.
    enforced_by: ["mcp:start_task", "mcp:propose_change", "hook:SessionStart"]
    config:
      phases:
        planning:
          expected_family: "opus"
          default_effort: "medium"
          concrete_model: "claude-opus-4-7"
        execution:
          expected_family: "sonnet"
          concrete_model: "claude-sonnet-4-6"
      default_phase: "planning"
      explicit_transition_required: true

  # --- Definition of ready (NEW per migration plan 1.1) ---

  definition_of_ready:
    description: |
      Task cannot transition planning -> execution until the plan record
      contains: scope_statement, files_intended, test_approach,
      definition_of_done, out_of_scope. Trivial tasks may opt out with
      size: trivial.
    enforced_by: ["mcp:start_task"]
    config:
      required_fields:
        - scope_statement
        - files_intended
        - test_approach
        - definition_of_done
        - out_of_scope
      escape_hatch:
        field: "size"
        value: "trivial"
        logged: true

  # --- Scope expansion (NEW per migration plan 1.2) ---

  scope_expansion:
    description: |
      During execution, propose_change for a file not in files_intended
      blocks with TASK_SCOPE_EXPANSION. Agent must call expand_scope
      (which requires user confirmation) or revert.
    enforced_by: ["mcp:propose_change"]
    error_code: "TASK_SCOPE_EXPANSION"
    config:
      escape_tool: "expand_scope"
      requires_user_confirmation: true

  # --- Mid-execution uncertainty (NEW per migration plan 1.3) ---

  uncertainty_surfacing:
    description: |
      When agent encounters ambiguity, unknown dependency, conflicting
      rule, or unexpected state, it calls surface_uncertainty. In strict
      mode, this blocks further propose_change until user responds.
    enforced_by: ["mcp:surface_uncertainty"]
    config:
      default_mode: "log_only"  # log but don't block
      strict_mode_projects: ["kurata", "tradingbot", "veda", "veda-ios", "veda-proxy"]
      categories:
        - ambiguous_spec
        - unknown_dependency
        - conflicting_rule
        - unexpected_state

  # --- Review paths ---

  sensitive_path_review:
    description: "Changes to sensitive paths require explicit approval."
    enforced_by: ["ci:require-review", "mcp:propose_change"]
    config:
      paths:
        - "**/.env*"
        - "**/migrations/**"
        - "**/Dockerfile"
        - "**/wrangler.toml"
        - ".github/workflows/**"

  # --- Auth changes (NEW Gate per migration plan 1.6, replaces "mental review") ---

  auth_change_asvs_artifact:
    description: |
      Changes to auth/permissions/session paths require an asvs_review
      artifact attached to the task record listing the ASVS L1 controls
      touched and the verification done.
    enforced_by: ["mcp:attach_asvs_review", "ci:check-asvs-artifact"]
    config:
      paths:
        - "**/auth/**"
        - "**/permissions/**"
        - "**/session/**"
      artifact_fields:
        - controls_touched   # list of ASVS L1 control IDs
        - verification       # what was checked, how
        - reviewer           # who or what reviewed

  # --- Bugfix root cause (NEW Gate per migration plan 1.5) ---

  bugfix_root_cause:
    description: |
      Tasks with task_type: bugfix require root_cause field before any
      propose_change claiming to fix the bug.
    enforced_by: ["mcp:start_task", "mcp:propose_change"]
    config:
      required_when:
        task_type: "bugfix"
      forbidden_values: ["unknown", "unclear", "tbd", ""]

  # --- Context hygiene (NEW per migration plan 2.3) ---

  pre_compact_findings_dump:
    description: |
      Before context compaction, current task state, open questions, and
      recent findings dump to project workspace.
    enforced_by: ["hook:PreCompact"]
    config:
      dump_path: ".agent-state/pre-compact-{timestamp}.md"

  # --- Session start (NEW per migration plan 2.1) ---

  session_start_phase_check:
    description: |
      At session start, surface current phase and model family. If model
      doesn't match phase's expected family, surface warning.
    enforced_by: ["hook:SessionStart"]

  # --- Session stop (NEW per migration plan 2.4) ---

  session_stop_completion_check:
    description: |
      Before agent exits with open task, surface whether
      definition_of_done was verified. Does not force re-execution; just
      surfaces omission.
    enforced_by: ["hook:Stop"]

  # --- Deploy ---

  deploy_after_ci:
    description: "Deploy jobs must `needs:` the CI job."
    enforced_by: ["mcp:check_ci_setup"]

# ============================================================================
# PRACTICES — workflow disciplines. Observable in records, not pre-checked.
# Drift-log catches violations. Repeated violations -> promote to Gate.
# ============================================================================

practices:

  # --- Planning ---

  plan_before_code:
    description: |
      State hypothesis, intended changes, and test approach before writing
      code. Backed by definition_of_ready gate; this is the spirit of it.

  task_chunking:
    description: |
      Break tasks into 3-5 focused chunks. >5 file changes or >2 unrelated
      areas -> split into multiple tasks.

  refactor_only_after_working:
    description: "Refactor only after the change works."

  three_uses_extract:
    description: "Three uses of the same pattern -> extract a shared abstraction."

  # --- Investigation ---

  investigation_mode_compliance:
    description: |
      Follow the configured investigation mode (soft/hard).
      Sensitive projects use hard mode.
    config:
      soft_min_read_write_ratio: 3
      hard_min_read_write_ratio: 4
      default: "soft"
      hard_mode_projects: ["kurata", "tradingbot", "veda", "veda-ios", "veda-proxy"]

  find_before_read:
    description: "Use grep/search to locate before reading whole files."

  no_redundant_reads:
    description: "Do not re-read files already read in this session."

  offset_limit_for_long_files:
    description: "Long files use offset/limit; long logs filter through grep/head/tail."

  # --- Context management ---

  clear_between_unrelated_tasks:
    description: "Use /clear between unrelated tasks rather than patching forward."

  compact_only_for_same_task:
    description: |
      /compact only when continuing the same task with significant history.
      For stale context hurting accuracy, prefer /clear.

  durable_findings:
    description: |
      After every two search/read ops, write findings to a durable file.
      Backed by PreCompact hook for compaction-time enforcement.

  # --- Test approach ---

  test_order_by_spec:
    description: |
      Known behaviour -> test-first.
      Unknown behaviour -> build-then-test.

  # --- Migrations ---

  migrations_forward_only:
    description: |
      Migrations are forward-only and reversible, or document why not.
      Reversibility is a comment in the migration file.

  # --- Logging (currently Practice; promote to Invariant when 4.4 ships) ---

  no_pii_in_logs:
    description: |
      Logs do not include PII, credentials, tokens, or full request bodies.
      Will become an Invariant once log-format pre-commit check is built.

  # --- Resource authorization (Practice for now per migration plan 4.5) ---

  authorisation_at_resource_level:
    description: |
      Authorisation checks happen at the resource level, not just the
      route. Each route handler verifies the caller owns or has permission
      for the specific resource it touches.
    notes: |
      Currently Practice because a generic automated check is hard to design.
      Promote to Invariant per-project as patterns emerge.

  # --- OWASP review trigger ---

  owasp_top_10_mental_review:
    description: |
      Auth/input/data/templating changes trigger an OWASP Top 10 mental
      review. Backed by auth_change_asvs_artifact Gate for auth specifically;
      this practice extends to input and data changes.

  # --- Self-improvement ---

  propose_rule_after_correction:
    description: |
      If agent made a mistake the user had to correct, propose a one-line
      addition to CLAUDE.md or .agent-standards.yml via
      mcp:propose_claude_md_rule. User accepts or declines.

# ============================================================================
# PROMOTION TRACKING
# ============================================================================

promotion_log:
  description: |
    When a Practice has been violated repeatedly, the drift-log will show it.
    Quarterly review promotes high-violation Practices to Gates (with tooling)
    and Gates with stable behaviour to Invariants. Demotions also logged here.
  format: ".agent-standards-decisions.md"

# ============================================================================
# PROJECT CAPABILITIES
# ============================================================================
# Projects declare these so applies_to_projects_where can fire correctly.

project_capability_schema:
  ci_kind:
    type: enum
    values: ["mobile", "web", "service", "library", "monorepo"]
  multi_tenant:
    type: bool
    if_true_requires:
      - tenant_id_field
      - data_layer_paths
  has_deployable_service:
    type: bool
  has_client_build:
    type: bool
  has_http_service:
    type: bool
  handles_money:
    type: bool
```

---

## What's intentionally not in the YAML

These belong in `CLAUDE.md` (per Document 2, Phase 3) and are listed here
only so you know they were considered:

- "Functions do one thing."
- "Names communicate intent."
- "DRY, SOLID, KISS, YAGNI" as values.
- "Implement exactly what was requested" as a value (the Gate version is
  `scope_expansion`).
- "Components own their styling" as a value (the Invariants are
  `no_off_token_*`).

---

## What's deferred

These are flagged in Document 2 but not yet in the YAML because they need
real tooling work (Phase 4) before they're enforceable:

- `parameterised_queries_only` — listed but check script doesn't exist yet.
- `service_role_keys_not_in_client` — same.
- `multi_tenant_query_isolation` — same.
- A real log-format pre-commit (`no_pii_in_logs` stays a Practice until then).
- `authorisation_at_resource_level` — stays a Practice.

The YAML lists them as Invariants with check_command paths because that's
where they should land. Until the scripts exist, the check just doesn't run —
this is intentional, so the rule exists in the right tier from day one.

---

## Per-project override pattern

Projects extending this file would look like:

```yaml
# kurata/.agent-standards.yml
extends: forgedtech/org-defaults
schema_version: 2

project_capabilities:
  ci_kind: web
  multi_tenant: true
  has_deployable_service: true
  has_client_build: true
  has_http_service: true
  handles_money: false

invariants:
  # Kurata raises coverage floors
  coverage_floors:
    config:
      unit_min: 70
      integration_min: 50
      per_surface:
        "packages/shared/**": { unit: 95, integration: 90, mutation: 95 }
        "packages/security/**": { unit: 90, integration: 80, mutation: 80 }
        "packages/services/**": { unit: 70, integration: 70 }
        "apps/web/actions/**": { unit: 80 }

  # Kurata's tenant config
  multi_tenant_query_isolation:
    config:
      tenant_id_field: "householdId"
      data_layer_paths:
        - "packages/db/queries/**"
        - "packages/services/*/queries/**"
      bypass_comment: "# tenant-isolation: bypass"

  # Kurata-specific invariant for FairShare
  fairshare_equal_weighting:
    description: |
      FairShare counts cleaning, cooking, shopping, parenting equally.
    check_command: "scripts/check-fairshare-weights.sh"
    severity: error
    tier: invariant

gates:
  # Kurata uses strict uncertainty surfacing
  uncertainty_surfacing:
    config:
      default_mode: "block"

  # Kurata-specific gate
  receipts_signed_url_only:
    description: "Receipt access goes through signed URLs, never direct."
    enforced_by: ["scripts/check-receipt-access.sh"]
    tier: gate

practices:
  # Kurata-specific
  briefing_max_three_items:
    description: "Daily briefing shows at most 3 items in canonical priority."
    tier: practice
```

---

## Confidence and uncertainty summary

**High confidence:**
- The tier taxonomy itself.
- The structure: invariants / gates / practices, with a separate principles
  doc.
- The new gates (definition_of_ready, scope_expansion, bugfix_root_cause,
  auth_change_asvs_artifact, the hook-driven ones).
- The multi-tenant generalisation.

**Moderate confidence:**
- The specific field names. They're consistent and reasonable but should be
  diffed against the actual MCP server's expectations.
- The hook gate names — I haven't built Claude Code hooks, the API may
  differ.
- `uncertainty_surfacing` as a Gate. I think this is valuable but it's the
  most novel piece.

**Lower confidence:**
- The deferred Invariants (parameterised queries, service-role keys,
  multi-tenant isolation, log format) will all need real implementation
  work, and some may turn out to be harder than the migration plan suggests.
- The escape hatches (`size: trivial`, `expand_scope`, the bypass comment for
  tenant isolation) are necessary but their exact mechanics will need
  iteration based on real usage.

---

## How to use this

1. Diff the structure above against your actual `org-defaults.yml`.
2. Decide whether to adopt the four-tier taxonomy as-is or simplify (two-tier
   is a reasonable alternative).
3. Pick which Phase 1 gates to ship first. My recommendation: definition of
   ready and scope expansion, in that order. They're the highest leverage.
4. Spike the multi-tenant invariant on Kurata before generalising — that's
   the project where you'll learn whether the AST check is feasible.
5. Resist the temptation to ship everything at once. Each gate adds friction;
   each gate needs to prove its value before the next one rolls out.

The framework you built is genuinely good. This refinement is intended to
make the implicit explicit and to give you the structure to add new rules
without each addition feeling like a fresh decision about what kind of rule it
is.
