import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { minimatch } from "minimatch";
import { loadStandards, StandardsError, groupRulesByTier } from "./standards.js";
import { checkCiSetup } from "./check-ci.js";
import { checkBranching } from "./check-branching.js";
import { checkSecrets } from "./check-secrets.js";
import { checkDesignConsistency } from "./check-design-consistency.js";
import { checkCodebaseHygiene } from "./check-codebase-hygiene.js";
import { checkTenantIsolation } from "./check-tenant-isolation.js";
import { checkCrossTenantTest } from "./check-cross-tenant-test.js";
import { checkEnvExample } from "./check-env-example.js";
import { checkFrameworkSupport } from "./check-framework-support.js";
import { checkSubscription } from "./check-subscription.js";
import { checkViewSize } from "./check-view-size.js";
import { checkHttpSecurity } from "./check-http-security.js";
import { checkClientBundleSecrets } from "./check-client-bundle-secrets.js";
import { checkSqlInjection } from "./check-sql-injection.js";
import { checkLogPii } from "./check-log-pii.js";
import { checkHttpTimeouts } from "./check-http-timeouts.js";
import { getRuleMetrics } from "./rule-metrics.js";
import { proposeRule } from "./propose-rule.js";
import { appendDrift, getDriftLog } from "./drift-log.js";
import { readAuditLog } from "./audit-log.js";
import { readReactLog } from "./react-log.js";
import {
  startTask,
  proposeChange,
  commitCheckpoint,
  expandScope,
  attachAsvsReview,
  attachDeploymentCompatReview,
  surfaceUncertainty,
} from "./task-tracking.js";
import { generateCi, type CiKind, type Language } from "./init-repo.js";

export interface CreateServerOptions {
  /**
   * Default repo root used when a tool is called without an explicit `repo_root` arg.
   * Set this from the project's MCP config (e.g. via the `--repo-root` CLI flag) so
   * agents inside that project don't have to know the absolute path.
   */
  defaultRepoRoot?: string;

  /**
   * Server name advertised over the MCP handshake. Override per project to make it
   * obvious which project an agent is wired to (e.g. `forgedtech-agent-standards/forge`).
   */
  name?: string;

  /** Server version. Defaults to the core package version. */
  version?: string;
}

const PACKAGE_VERSION = "0.1.0";

/** Build a fully wired MCP `Server`. Caller is responsible for connecting it to a transport. */
export function createServer(options: CreateServerOptions = {}): Server {
  const { defaultRepoRoot, name = "forgedtech-agent-standards", version = PACKAGE_VERSION } = options;

  // We only support tools — do NOT declare prompts/resources capabilities.
  // Declaring them (even as empty objects) tells Claude Code's /mcp menu the
  // server has prompts/resources available, and the menu hangs when it tries
  // to render them. Clients that ignore the capability map and ask anyway
  // will get a JSON-RPC -32601 (Method not found), which is the correct
  // and well-handled response per the MCP spec.
  const server = new Server(
    { name, version },
    { capabilities: { tools: {} } }
  );

  const RepoRoot = defaultRepoRoot
    ? z.string().default(defaultRepoRoot)
    : z.string();

  const GetStandardsArgs = z.object({ repo_root: RepoRoot });
  const CheckPathsArgs = z.object({
    repo_root: RepoRoot,
    paths: z.array(z.string()),
  });
  const CheckCiSetupArgs = z.object({ repo_root: RepoRoot });
  const CheckBranchingArgs = z.object({ repo_root: RepoRoot });
  const InitRepoArgs = z.object({
    language: z.enum(["swift", "flutter", "node", "python", "dotnet", "mixed"]),
    kind: z.enum(["service", "library", "mobile", "web"]),
    unit_coverage_threshold: z.number().int().min(0).max(100).default(80),
    integration_coverage_threshold: z.number().int().min(0).max(100).default(70),
    swift_scheme: z.string().optional(),
    working_directory: z.string().optional(),
    railway_service_name: z.string().optional(),
  });

  const CheckSecretsArgs = z.object({
    repo_root: RepoRoot,
    scope: z.enum(["staged", "tracked", "all"]).default("staged"),
  });

  const CheckDesignConsistencyArgs = z.object({ repo_root: RepoRoot });

  const CheckCodebaseHygieneArgs = z.object({
    repo_root: RepoRoot,
    severity: z.enum(["warn", "error"]).optional(),
  });

  const CheckTenantIsolationArgs = z.object({ repo_root: RepoRoot });
  const CheckCrossTenantTestArgs = z.object({ repo_root: RepoRoot });
  const CheckEnvExampleArgs = z.object({ repo_root: RepoRoot });
  const CheckFrameworkSupportArgs = z.object({ repo_root: RepoRoot });
  const CheckSubscriptionArgs = z.object({ repo_root: RepoRoot });
  const CheckViewSizeArgs = z.object({ repo_root: RepoRoot });
  const CheckHttpSecurityArgs = z.object({ repo_root: RepoRoot });
  const CheckClientBundleSecretsArgs = z.object({ repo_root: RepoRoot });
  const CheckSqlInjectionArgs = z.object({ repo_root: RepoRoot });
  const CheckLogPiiArgs = z.object({ repo_root: RepoRoot });
  const CheckHttpTimeoutsArgs = z.object({ repo_root: RepoRoot });

  const GetRuleMetricsArgs = z.object({
    repo_root: RepoRoot,
    rule_id: z.string().optional(),
    window_days: z.number().int().min(1).max(365).optional(),
  });

  const RunLocalChecksArgs = z.object({
    repo_root: RepoRoot,
    include: z.array(z.enum(["ci", "branching", "secrets", "design", "hygiene", "tenant", "bundle", "sqli", "log_pii", "http_timeouts", "cross_tenant_test", "env_example", "framework", "view_size", "http_security"])).optional(),
    secrets_scope: z.enum(["staged", "tracked", "all"]).default("staged"),
  });

  const ProposeRuleArgs = z.object({
    repo_root: RepoRoot,
    target: z.enum(["claude_md", "agent_standards"]),
    rule: z.string().min(5),
    reason: z.string().min(5),
  });

  const GetDriftLogArgs = z.object({
    repo_root: RepoRoot,
    window_days: z.number().int().min(1).max(365).default(14),
  });

  const GetAuditLogArgs = z.object({
    repo_root: RepoRoot,
    limit: z.number().int().min(1).max(1000).default(100),
  });

  const GetReactLogArgs = z.object({
    repo_root: RepoRoot,
    limit: z.number().int().min(1).max(1000).default(50),
    task_id: z.string().optional(),
  });

  const StartTaskArgsZ = z.object({
    repo_root: RepoRoot,
    description: z.string().min(5),
    hypothesis: z.string().min(5),
    phase: z.enum(["planning", "execution"]).optional(),
    current_model: z.string().optional(),
    expected_reads: z.array(z.string()).optional(),
    expected_writes: z.array(z.string()).optional(),
    // ── Definition-of-ready fields (Increment 2) ──
    scope_statement: z.string().min(10).optional(),
    files_intended: z.array(z.string()).optional(),
    test_approach: z.string().min(5).optional(),
    definition_of_done: z.string().min(5).optional(),
    out_of_scope: z.array(z.string()).optional(),
    size: z.enum(["trivial", "standard", "large"]).optional(),
    // ── Task classification + bugfix root cause (Increment 8.5) ──
    task_type: z.enum(["feature", "bugfix", "architecture", "auth_change", "trivial"]).optional(),
    root_cause: z.string().optional(),
    // ── Reversibility (Beyond-W15, W19) ──
    reversibility: z.enum(["easy", "moderate", "hard"]).optional(),
    thought: z.string().optional(),
  });

  const SurfaceUncertaintyArgsZ = z.object({
    repo_root: RepoRoot,
    task_id: z.string().optional(),
    category: z.enum(["ambiguous_spec", "unknown_dependency", "conflicting_rule", "unexpected_state"]),
    description: z.string().min(10),
    proposed_options: z.array(z.string()).optional(),
    resolve: z.object({
      description: z.string().min(1),
      resolution: z.string().min(5),
    }).optional(),
  });

  const ProposeChangeArgsZ = z.object({
    repo_root: RepoRoot,
    task_id: z.string().optional(),
    paths: z.array(z.string()),
    rationale: z.string().min(5),
    current_model: z.string().optional(),
    thought: z.string().optional(),
  });

  const CommitCheckpointArgsZ = z.object({
    repo_root: RepoRoot,
    task_id: z.string().optional(),
    reads: z.array(z.string()).optional(),
    writes: z.array(z.string()).optional(),
    note: z.string().optional(),
    close: z.boolean().optional(),
  });

  const ExpandScopeArgsZ = z.object({
    repo_root: RepoRoot,
    task_id: z.string().optional(),
    path: z.string().min(1),
    reason: z.string().min(5),
    user_confirmed: z.boolean(),
    thought: z.string().optional(),
  });

  const AttachAsvsReviewArgsZ = z.object({
    repo_root: RepoRoot,
    task_id: z.string().optional(),
    controls_touched: z.array(z.string().min(1)).min(1),
    verification: z.string().min(10),
    reviewer: z.string().min(1),
  });

  const AttachDeploymentCompatReviewArgsZ = z.object({
    repo_root: RepoRoot,
    task_id: z.string().optional(),
    summary: z.string().min(10),
    surfaces_affected: z.array(z.string().min(1)).min(1),
    deploy_strategy: z.enum(["safe", "ordered", "simultaneous"]),
    deploy_order: z.array(z.string().min(1)).optional(),
  });

  const repoRootProp = defaultRepoRoot
    ? {
        type: "string",
        description: `Defaults to ${defaultRepoRoot} (set by --repo-root). Override only when targeting a sibling repo.`,
      }
    : { type: "string", description: "Absolute path to repo." };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "get_standards",
        description:
          "Load .agent-standards.yml for the given repo. Returns coding style, architecture rules, " +
          "test coverage targets, review gates, and investigation policy. Call this at the start of every task.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: { repo_root: repoRootProp },
        },
      },
      {
        name: "check_paths",
        description:
          "Check whether a list of intended write paths trigger any standards gates: " +
          "explicit-approval, sensitive, or regression-test-required.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? ["paths"] : ["repo_root", "paths"],
          properties: {
            repo_root: repoRootProp,
            paths: { type: "array", items: { type: "string" } },
          },
        },
      },
      {
        name: "check_ci_setup",
        description:
          "Validate the repo's CI workflow against the org's standards: must exist, must call a " +
          "canonical quality-gate-*.yml, must meet coverage thresholds from .agent-standards.yml, " +
          "must include issues:write permission, must have deploy jobs depending on CI. ALWAYS call " +
          "this at task start.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: { repo_root: repoRootProp },
        },
      },
      {
        name: "check_branching",
        description:
          "Validate the repo against its branching policy: required branches exist on origin " +
          "(default: main + dev), the default branch matches, and the current branch name conforms " +
          "to the feature-branch pattern. Degrades to warnings when offline or remote unreachable.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: { repo_root: repoRootProp },
        },
      },
      {
        name: "init_repo",
        description:
          "Generate a proposed `.github/workflows/ci.yml` for a repo that lacks one. Returns text only — " +
          "does NOT write. Choose `kind`: service (API + Railway), library (code-only), mobile " +
          "(iOS/Flutter), web (Next.js/Vite + Railway).",
        inputSchema: {
          type: "object",
          required: ["language", "kind"],
          properties: {
            language: { type: "string", enum: ["swift", "flutter", "node", "python", "dotnet", "mixed"] },
            kind: { type: "string", enum: ["service", "library", "mobile", "web"] },
            unit_coverage_threshold: { type: "number", default: 80 },
            integration_coverage_threshold: { type: "number", default: 70 },
            swift_scheme: { type: "string", description: "Required for kind=mobile + language=swift." },
            working_directory: { type: "string", description: "For monorepos — sub-app path." },
            railway_service_name: { type: "string", description: "Required for service or web with Railway." },
          },
        },
      },
      {
        name: "check_secrets",
        description:
          "Scan files for likely secrets (cloud keys, bearer tokens, JWTs, private keys). " +
          "Default scope: staged files (pre-commit gate). Use 'tracked' for the full repo, 'all' for an unindexed walk. " +
          "Conservative pattern set — for deep scanning, run gitleaks/trufflehog in CI.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: {
            repo_root: repoRootProp,
            scope: { type: "string", enum: ["staged", "tracked", "all"], default: "staged" },
          },
        },
      },
      {
        name: "check_design_consistency",
        description:
          "Lint UI files for design-system drift: hardcoded hex colors not in tokens, off-scale spacing, " +
          "more than 2 fonts or 3 colors (org-wide hard caps), inline styles in JSX. " +
          "Only meaningful for ci.kind=web or mobile; no-ops elsewhere. " +
          "Detects token files via convention (tokens|theme|design-system|colors|palette|spacing|typography).",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: { repo_root: repoRootProp },
        },
      },
      {
        name: "check_codebase_hygiene",
        description:
          "Two invariants in one check: no_commented_code (≥3 consecutive comment lines that look like " +
          "code) + no_untracked_todos (TODO/FIXME/HACK without a tracking reference like #123, ENG-456, " +
          "or URL). Ships as severity: warn during the cleanup-pass window (Increment 6); promote to " +
          "error after each project cleans up. Doc files (.md/.mdx/.rst), JSON, generated code, and " +
          "binaries are skipped. Comment directives (eslint-, ts-ignore, etc.) are recognised and not " +
          "treated as old code.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: {
            repo_root: repoRootProp,
            severity: {
              type: "string",
              enum: ["warn", "error"],
              description: "Override default severity. Defaults to 'warn' until project cleanup pass completes.",
            },
          },
        },
      },
      {
        name: "check_tenant_isolation",
        description:
          "Multi-tenant query isolation invariant (Increment 7). For projects with " +
          "architecture.tenant_isolation configured, verifies every method/function in the configured " +
          "data_layer_paths accepts tenant_id_field (e.g. 'householdId') as a parameter. Bypass via " +
          "inline comment '// tenant-isolation: bypass <reason>' (on the line above the signature or " +
          "trailing). File-level bypass: top-of-file comment with the same pattern. Project-level " +
          "exempt_methods allowlist for repeated patterns. TypeScript/JavaScript + Python.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: { repo_root: repoRootProp },
        },
      },
      {
        name: "check_cross_tenant_test",
        description:
          "Cross-tenant integration test invariant (Beyond-W15 / W17-18). Generic AST check for " +
          "'authorisation at the resource level' is impractical (auth patterns vary by domain). " +
          "The mechanical proxy: every authenticated route should have an integration-test assertion " +
          "that returns 403 when called with a foreign tenant ID. " +
          "For projects with architecture.tenant_isolation.cross_tenant_test_file set, this check " +
          "verifies the file exists and that its 403-assertion count is within 80% of the detected " +
          "authenticated-route count. 20% slack acknowledges that one assertion can cover multiple " +
          "routes via parameterisation. Heuristic patterns for routes (Express/Fastify/FastAPI) and " +
          "for 403 assertions (Jest/Vitest/pytest). Route file globs default to '**/routes/**' + " +
          "'**/router.py' + '**/*.routes.ts' — override via architecture.tenant_isolation.route_files.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: { repo_root: repoRootProp },
        },
      },
      {
        name: "check_env_example",
        description:
          "Verifies .env.example (or .env.sample / .env.template) exists if env vars are referenced " +
          "from source, and that every referenced var has an entry. Recognises process.env.X, " +
          "process.env['X'], import.meta.env.X, os.environ['X'], os.environ.get('X'), os.getenv('X'). " +
          "Exempts built-ins (NODE_ENV, PATH, etc.) and public prefixes (NEXT_PUBLIC_, VITE_, " +
          "EXPO_PUBLIC_, REACT_APP_).",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: { repo_root: repoRootProp },
        },
      },
      {
        name: "check_framework_support",
        description:
          "Flags declared runtime/framework versions that are past or nearing end-of-life. " +
          "Reads the declared version per framework (dotnet: global.json / Directory.Build.props " +
          "TargetFramework; flutter+dart: pubspec.yaml environment; node: .nvmrc / package.json " +
          "engines; swift: Package.swift swift-tools-version; python: .python-version / pyproject " +
          "requires-python), looks it up against the org-maintained EOL table in framework_support, " +
          "and reports FRAMEWORK_PAST_EOL (error) or FRAMEWORK_NEAR_EOL (warn within the configured " +
          "window). Info findings cover OK / not-configured / no-version-file / unknown-version cases.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: { repo_root: repoRootProp },
        },
      },
      {
        name: "check_subscription",
        description:
          "Wiring health check: verifies a project is fully + correctly subscribed to the " +
          "agent-standards framework. Checks .agent-standards.yml extends org-defaults, CLAUDE.md " +
          "exists + links the org template, the MCP server is wired in .mcp.json (and NOT duplicated " +
          "in .claude/settings.json — duplicate config hangs Claude Code on init), the wiring is " +
          "portable (no absolute /Users paths), interview-me is present, and settings.local.json is " +
          "gitignored. One call confirms onboarding is correct or surfaces the gap.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: { repo_root: repoRootProp },
        },
      },
      {
        name: "check_view_size",
        description:
          "View/component file-size check. Flags files over architecture.view_size_limit_lines " +
          "(default 200). Mobile/web only (no-op for service/library). Heuristic globs for React, " +
          "Vue, Svelte, Flutter, SwiftUI. Override globs via architecture.view_size_paths.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: { repo_root: repoRootProp },
        },
      },
      {
        name: "check_http_security",
        description:
          "HTTP security headers + CORS check. For ci.kind='service' only. Verifies HSTS, CSP, " +
          "X-Content-Type-Options, X-Frame-Options (or frame-ancestors), Referrer-Policy are set " +
          "somewhere in source — passes if a known headers library (helmet, fastify-helmet, etc.) " +
          "is detected. Flags dangerous CORS combos (wildcard origin + credentials: true) per-file. " +
          "Skip via architecture.http_security_skip=true for worker-only deployments.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: { repo_root: repoRootProp },
        },
      },
      {
        name: "check_client_bundle_secrets",
        description:
          "Service-role / admin-token leak check (Increment 10.1). Scans compiled client bundles " +
          "(apps/web/.next, apps/mobile/build, dist, build, .output, .svelte-kit, out) for: (1) known " +
          "service-role key prefixes (sb_secret_, sk_live_, AKIA*, ghp_, etc.); (2) string-literal " +
          "references to env vars whose names match server-only patterns (SERVICE_ROLE, *_SECRET, " +
          "ADMIN_*, PRIVATE_KEY) found in .env.example. Per-project override via " +
          "architecture.client_bundle_paths. Run after build, not on raw source.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: { repo_root: repoRootProp },
        },
      },
      {
        name: "check_sql_injection",
        description:
          "SQL injection / string-concat-query check (Increment 10.2). Conservative regex pass — " +
          "catches the 80% case: template literals with SQL keyword + interpolation, string " +
          "concatenation with SQL keywords nearby, Python f-strings / %-formatting with SQL " +
          "keywords. False positives suppressed via inline '// agent-standards: allow-sql-concat " +
          "<reason>'. Deeper scanning (CodeQL, Semgrep) belongs in CI; this is a fast local gate.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: { repo_root: repoRootProp },
        },
      },
      {
        name: "check_log_pii",
        description:
          "Log-PII check (Increment 10.3). Scans logger / console / print lines for references to " +
          "sensitive field names: password, secret, token, apiKey, sessionId, email, ssn, " +
          "accountNumber, creditCard, pin, dob, phone, jwt, refresh_token, etc. Ships at severity: " +
          "warn — promote to error per project after cleanup. Override default field list via " +
          "architecture.log_pii_extra_fields. Inline bypass: '// agent-standards: allow-log-field " +
          "<reason>'.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: { repo_root: repoRootProp },
        },
      },
      {
        name: "check_http_timeouts",
        description:
          "External HTTP timeout check (Increment 10.4). Catches the unbounded-fetch reliability " +
          "footgun. Flags fetch(), axios(), axios.{get,post,...}(), http.{get,request}(), got(), ky(), " +
          "requests.{get,post,...}(), httpx.{get,post,...}(), urlopen() calls whose argument list " +
          "doesn't contain a timeout-shaped option (timeout, signal, AbortSignal, timeoutMs, " +
          "request_timeout, read_timeout, connect_timeout). Multi-line arg lists supported via " +
          "balanced-paren extraction. Ships at severity: warn. Inline bypass: " +
          "'// agent-standards: allow-no-timeout <reason>'.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: { repo_root: repoRootProp },
        },
      },
      {
        name: "get_rule_metrics",
        description:
          "Per-rule metrics over a time window (Increment 11). Reads the drift log, maps codes to " +
          "rule IDs, groups by rule + severity. Surfaces two lists: rules_with_events (sorted by " +
          "count, most-fired first) and rules_with_zero_events (declared in .agent-standards.yml but " +
          "never fired in the window — candidates for demotion/deletion in the quarterly review). " +
          "Window defaults to 90 days (one quarter). Pass rule_id to filter to a single rule.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: {
            repo_root: repoRootProp,
            rule_id: { type: "string", description: "Filter to a single rule ID (e.g. 'no_commented_code')." },
            window_days: { type: "integer", minimum: 1, maximum: 365, default: 90, description: "Window in days. Default 90 (quarterly review)." },
          },
        },
      },
      {
        name: "run_local_checks",
        description:
          "One-call aggregator for all local checks: ci, branching, secrets, design, hygiene, tenant, bundle " +
          "(client-bundle secret leak), sqli (string-concat SQL), log_pii, http_timeouts, cross_tenant_test, " +
          "env_example, view_size, http_security. Use this before committing — closes the gap of having to " +
          "call each tool individually. Findings are appended to the drift log; query trends with get_drift_log.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: {
            repo_root: repoRootProp,
            include: {
              type: "array",
              items: {
                type: "string",
                enum: [
                  "ci", "branching", "secrets", "design", "hygiene", "tenant",
                  "bundle", "sqli", "log_pii", "http_timeouts", "cross_tenant_test",
                  "env_example", "framework", "view_size", "http_security",
                ],
              },
              description: "Subset of checks to run. Default: all 14.",
            },
            secrets_scope: { type: "string", enum: ["staged", "tracked", "all"], default: "staged" },
          },
        },
      },
      {
        name: "propose_claude_md_rule",
        description:
          "Append a proposed addition to <repo_root>/.agent-standards-proposals.md. Use when the agent " +
          "made a mistake the user had to correct, AND the agent has identified a one-line rule that " +
          "would have prevented it. Never auto-edits CLAUDE.md / .agent-standards.yml — humans review.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? ["target", "rule", "reason"] : ["repo_root", "target", "rule", "reason"],
          properties: {
            repo_root: repoRootProp,
            target: { type: "string", enum: ["claude_md", "agent_standards"] },
            rule: { type: "string", description: "One-line rule that would have prevented the mistake." },
            reason: { type: "string", description: "What went wrong and why this rule helps." },
          },
        },
      },
      {
        name: "get_drift_log",
        description:
          "Summarise standards-check findings recorded in the last N days. Surfaces trends rather " +
          "than one-shot results: which violations recur, which sources fire most. Reads from " +
          "<repo_root>/.agent-standards-drift.jsonl (gitignored, populated by run_local_checks).",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: {
            repo_root: repoRootProp,
            window_days: { type: "number", default: 14 },
          },
        },
      },
      {
        name: "get_audit_log",
        description:
          "Read the append-only audit log of MCP gate decisions. Returns all recorded events " +
          "(task_started, trivial_bypass, propose_change, gate_fired, expand_scope, " +
          "surface_uncertainty) with a count-by-kind summary. Reads from " +
          "<repo_root>/.agent-standards-audit.jsonl (gitignored). Use to audit agent " +
          "decisions, bypass frequency, and gate firing patterns.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: {
            repo_root: repoRootProp,
            limit: { type: "number", default: 100, description: "Max number of most-recent events to return." },
          },
        },
      },
      {
        name: "get_react_log",
        description:
          "Read the ReAct reasoning trace log — thought→action→observation entries at MCP " +
          "decision points (start_task, propose_change, expand_scope). Returns entries with " +
          "thought_coverage (% of entries where the agent declared a thought). Use for " +
          "post-mortem diagnosis: what did the agent believe at each decision point? " +
          "Reads from <repo_root>/.agent-standards-react.jsonl (gitignored). " +
          "Entries without a thought field indicate gaps where reasoning was not declared.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: {
            repo_root: repoRootProp,
            limit: { type: "number", default: 50, description: "Max number of most-recent entries to return." },
            task_id: { type: "string", description: "Filter entries to a specific task ID." },
          },
        },
      },
      {
        name: "start_task",
        description:
          "Record a hypothesis-first plan before doing work. Captures description, hypothesis, " +
          "expected reads/writes, phase (planning|execution), task_type, and (when the project " +
          "enables them) DoR fields (scope_statement, files_intended, test_approach, " +
          "definition_of_done, out_of_scope) + root_cause for bugfixes. Returns a task_id and " +
          "the recommended model. " +
          "BLOCKS if current_model is declared and doesn't match the phase's expected family. " +
          "BLOCKS planning→execution if gates.definition_of_ready is enabled and DoR fields are " +
          "missing (size='trivial' bypasses but is logged). " +
          "BLOCKS task_type='bugfix' if gates.bugfix_root_cause is enabled and root_cause is " +
          "missing or a placeholder ('unknown'/'tbd'/<10 chars). " +
          "The model check depends on the agent honestly passing current_model.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? ["description", "hypothesis"] : ["repo_root", "description", "hypothesis"],
          properties: {
            repo_root: repoRootProp,
            description: { type: "string" },
            hypothesis: { type: "string" },
            phase: {
              type: "string",
              enum: ["planning", "execution"],
              default: "planning",
              description: "planning = design/hypothesis; execution = writing the planned code.",
            },
            current_model: {
              type: "string",
              description: "The model currently running this session (e.g. 'claude-opus-4-7'). Required for the model/phase block to fire.",
            },
            expected_reads: { type: "array", items: { type: "string" }, description: "File paths or globs you expect to read." },
            expected_writes: { type: "array", items: { type: "string" }, description: "File paths or globs you expect to modify." },
            scope_statement: { type: "string", description: "One-sentence description of what changes. Required by definition_of_ready gate when phase='execution' (unless size='trivial')." },
            files_intended: { type: "array", items: { type: "string" }, description: "Explicit file paths/globs the agent expects to touch. Used by scope-expansion gate in propose_change." },
            test_approach: { type: "string", description: "How the change will be verified (test-first / build-then-test / specific test commands)." },
            definition_of_done: { type: "string", description: "Observable outcome: 'test X passes', 'endpoint Y returns 200 with payload Z', etc." },
            out_of_scope: { type: "array", items: { type: "string" }, description: "Explicit list of things the agent will NOT do during this task — antidote to 'while I'm here' refactors." },
            size: { type: "string", enum: ["trivial", "standard", "large"], default: "standard", description: "size='trivial' skips the definition_of_ready gate but is logged." },
            task_type: { type: "string", enum: ["feature", "bugfix", "architecture", "auth_change", "trivial"], description: "Task classification. 'bugfix' requires root_cause when bugfix_root_cause gate is enabled." },
            root_cause: { type: "string", description: "For task_type='bugfix': your hypothesis about why the bug occurs. Must be ≥10 chars and not a placeholder ('unknown'/'tbd' rejected). State a hypothesis even if uncertain — verification happens in definition_of_done." },
            reversibility: { type: "string", enum: ["easy", "moderate", "hard"], description: "Cost-of-being-wrong signal. 'hard' = migrations / deploys / data deletions / one-way operations. Surfaces a warning in the task message + logs a note; doesn't block. Make the trade explicit at planning time." },
            thought: { type: "string", description: "ReAct trace: why you believe this is the right task to start now — the belief that could be wrong. Omitting triggers a REACT_NO_THOUGHT warning in the response." },
          },
        },
      },
      {
        name: "propose_change",
        description:
          "Validate intended write paths against the active task's expected_writes. Hard mode " +
          "(investigation.mode=hard) blocks on out-of-scope writes; soft mode warns. Also checks " +
          "model/phase: if current_model is declared and the task is in 'planning' phase or the " +
          "model family doesn't match models.execution, blocks. Pass current_model to enable " +
          "the check.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? ["paths", "rationale"] : ["repo_root", "paths", "rationale"],
          properties: {
            repo_root: repoRootProp,
            task_id: { type: "string", description: "Defaults to the active task." },
            paths: { type: "array", items: { type: "string" } },
            rationale: { type: "string" },
            current_model: { type: "string", description: "Current model id for the phase check." },
            thought: { type: "string", description: "ReAct trace: why you believe this specific write is the right next step — the belief that could be wrong. Omitting triggers a REACT_NO_THOUGHT warning." },
          },
        },
      },
      {
        name: "commit_checkpoint",
        description:
          "Record progress on the active (or specified) task: files actually read/written, optional " +
          "note, and an optional close flag. Returns running totals + read/write ratio. Pair with " +
          "start_task / propose_change to build a hypothesis-first audit trail.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: {
            repo_root: repoRootProp,
            task_id: { type: "string" },
            reads: { type: "array", items: { type: "string" } },
            writes: { type: "array", items: { type: "string" } },
            note: { type: "string" },
            close: { type: "boolean" },
          },
        },
      },
      {
        name: "expand_scope",
        description:
          "Add a path to the active task's files_intended. Required to unblock propose_change when " +
          "the scope-expansion gate (Increment 3) fires. Demands user_confirmed=true — the agent " +
          "must have asked the user before declaring confirmation, since the MCP can't see the user's " +
          "answer. Without confirmation, the call is refused and the agent must revert or ask again.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot
            ? ["path", "reason", "user_confirmed"]
            : ["repo_root", "path", "reason", "user_confirmed"],
          properties: {
            repo_root: repoRootProp,
            task_id: { type: "string", description: "Defaults to the active task." },
            path: { type: "string", description: "Path or glob to add to files_intended." },
            reason: { type: "string", description: "Why the original plan didn't cover this file. ≥5 chars." },
            user_confirmed: {
              type: "boolean",
              description: "Agent asserts that the user explicitly approved adding this path. Without this, the call is refused.",
            },
            thought: { type: "string", description: "ReAct trace: why you believe the original scope was wrong — the belief that could be wrong. Omitting triggers a REACT_NO_THOUGHT warning." },
          },
        },
      },
      {
        name: "attach_asvs_review",
        description:
          "Attach an OWASP ASVS L1 review artifact to the active task. Required to unblock " +
          "propose_change when the auth_change_asvs_artifact gate (Increment 5) fires — i.e. the " +
          "proposed write touches an auth path. Replaces 'mental review' with an audit trail: " +
          "which ASVS controls the change touches, what was verified, and who/what reviewed.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot
            ? ["controls_touched", "verification", "reviewer"]
            : ["repo_root", "controls_touched", "verification", "reviewer"],
          properties: {
            repo_root: repoRootProp,
            task_id: { type: "string", description: "Defaults to the active task." },
            controls_touched: {
              type: "array",
              items: { type: "string" },
              description: "ASVS L1 control IDs touched, e.g. ['V2.1.1', 'V3.4.1']. https://owasp.org/www-project-application-security-verification-standard/",
            },
            verification: { type: "string", description: "What was checked, and how. ≥10 chars." },
            reviewer: { type: "string", description: "Who or what reviewed — agent name, person, or automated tool." },
          },
        },
      },
      {
        name: "attach_deployment_compat_review",
        description:
          "Attach a deployment compatibility review to the active task. Required to unblock " +
          "propose_change when the deployment_compat_review gate fires — i.e. the proposed write " +
          "touches an API surface path (routes, schemas, Edge Functions, DTOs). Answer the " +
          "backwards-compatibility checklist in CLAUDE.md first, then call this with your findings.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot
            ? ["summary", "surfaces_affected", "deploy_strategy"]
            : ["repo_root", "summary", "surfaces_affected", "deploy_strategy"],
          properties: {
            repo_root: repoRootProp,
            task_id: { type: "string", description: "Defaults to the active task." },
            summary: {
              type: "string",
              description: "What was checked: which surfaces, which fields/endpoints changed, deploy order confirmed.",
            },
            surfaces_affected: {
              type: "array",
              items: { type: "string" },
              description: "The surfaces involved, e.g. ['api', 'web', 'mobile'].",
            },
            deploy_strategy: {
              type: "string",
              enum: ["safe", "ordered", "simultaneous"],
              description: "'safe' = additive-only (deploy in any order); 'ordered' = must deploy surfaces in deploy_order; 'simultaneous' = must release together.",
            },
            deploy_order: {
              type: "array",
              items: { type: "string" },
              description: "Required when deploy_strategy='ordered'. Surfaces in deployment sequence, e.g. ['api', 'web'].",
            },
          },
        },
      },
      {
        name: "surface_uncertainty",
        description:
          "Record (or resolve) an uncertainty encountered during a task — ambiguous spec, unknown " +
          "dependency, conflicting rule, unexpected state. Records persist on the active task. In " +
          "strict mode (gates.surface_uncertainty.default_mode='block' or the project listed in " +
          "strict_mode_projects), propose_change blocks until each uncertainty is resolved. To " +
          "resolve, call again with resolve: { description: '<the original description>', " +
          "resolution: '<what was decided>' }. Required by the interview-me skill when an interview " +
          "question can't be resolved by user clarification or codebase reading.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? ["category", "description"] : ["repo_root", "category", "description"],
          properties: {
            repo_root: repoRootProp,
            task_id: { type: "string", description: "Defaults to the active task." },
            category: {
              type: "string",
              enum: ["ambiguous_spec", "unknown_dependency", "conflicting_rule", "unexpected_state"],
              description: "Category of uncertainty.",
            },
            description: { type: "string", description: "What's unclear. ≥10 chars." },
            proposed_options: {
              type: "array",
              items: { type: "string" },
              description: "Optional list of resolutions to choose from.",
            },
            resolve: {
              type: "object",
              description: "Pass to resolve a previously-surfaced uncertainty rather than create a new one. The 'category' and 'description' top-level fields still need to be present (zod requires them) but are ignored when 'resolve' is set.",
              required: ["description", "resolution"],
              properties: {
                description: { type: "string", description: "Description of the prior surfaced uncertainty (used to match)." },
                resolution: { type: "string", description: "What was decided. ≥5 chars." },
              },
            },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      if (req.params.name === "get_standards") {
        const args = GetStandardsArgs.parse(req.params.arguments ?? {});
        const standards = await loadStandards(args.repo_root);
        const grouped = groupRulesByTier(standards);
        return { content: [{ type: "text", text: JSON.stringify(grouped, null, 2) }] };
      }

      if (req.params.name === "check_ci_setup") {
        const args = CheckCiSetupArgs.parse(req.params.arguments ?? {});
        const standards = await loadStandards(args.repo_root);
        const findings = await checkCiSetup(args.repo_root, standards);
        const isError = findings.some((f) => f.severity === "error");
        return { isError, content: [{ type: "text", text: JSON.stringify(findings, null, 2) }] };
      }

      if (req.params.name === "check_branching") {
        const args = CheckBranchingArgs.parse(req.params.arguments ?? {});
        const standards = await loadStandards(args.repo_root);
        const findings = await checkBranching(args.repo_root, standards);
        const isError = findings.some((f) => f.severity === "error");
        return { isError, content: [{ type: "text", text: JSON.stringify(findings, null, 2) }] };
      }

      if (req.params.name === "init_repo") {
        const args = InitRepoArgs.parse(req.params.arguments ?? {});
        const result = generateCi({
          language: args.language as Language,
          kind: args.kind as CiKind,
          unitCoverageThreshold: args.unit_coverage_threshold,
          integrationCoverageThreshold: args.integration_coverage_threshold,
          swiftScheme: args.swift_scheme,
          workingDirectory: args.working_directory,
          railwayServiceName: args.railway_service_name,
        });
        return {
          content: [
            {
              type: "text",
              text:
                `# Proposed .github/workflows/ci.yml\n\n` +
                `\`\`\`yaml\n${result.workflow}\`\`\`\n\n` +
                `## Notes\n${result.notes.map((n) => `- ${n}`).join("\n")}\n`,
            },
          ],
        };
      }

      if (req.params.name === "check_paths") {
        const args = CheckPathsArgs.parse(req.params.arguments ?? {});
        const standards = await loadStandards(args.repo_root);
        const result = args.paths.map((path) => {
          const triggered: string[] = [];
          const sensitive = standards.architecture?.sensitive_paths ?? [];
          const approval = standards.review?.explicit_approval_required_for ?? [];
          const regression = standards.test_coverage?.regression_required_for ?? [];

          for (const pat of sensitive) if (minimatch(path, pat)) triggered.push(`sensitive:${pat}`);
          for (const pat of approval) if (minimatch(path, pat)) triggered.push(`approval-required:${pat}`);
          for (const pat of regression) if (minimatch(path, pat)) triggered.push(`regression-test-required:${pat}`);

          return { path, triggered };
        });

        const grouped = groupRulesByTier(standards);
        const deferred_invariants = grouped.deferred_invariants.map((d) => ({
          severity: "info" as const,
          code: "DEFERRED_INVARIANT_NO_CHECK",
          rule_id: d.id,
          message:
            `Invariant '${d.id ?? d.rule.slice(0, 60)}' declared but check not built. ` +
            `Owner: ${d.deferred!.owner}, target: ${d.deferred!.target}` +
            (d.deferred!.issue ? `, issue: ${d.deferred!.issue}` : "") +
            (d.deferred!.reason ? `. Reason: ${d.deferred!.reason}` : ""),
        }));

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ paths: result, deferred_invariants }, null, 2),
          }],
        };
      }

      if (req.params.name === "check_secrets") {
        const args = CheckSecretsArgs.parse(req.params.arguments ?? {});
        const findings = await checkSecrets(args.repo_root, args.scope);
        await appendDrift(args.repo_root, "check_secrets", findings);
        const isError = findings.some((f) => f.severity === "error");
        return { isError, content: [{ type: "text", text: JSON.stringify(findings, null, 2) }] };
      }

      if (req.params.name === "check_design_consistency") {
        const args = CheckDesignConsistencyArgs.parse(req.params.arguments ?? {});
        const standards = await loadStandards(args.repo_root);
        const findings = await checkDesignConsistency(args.repo_root, standards);
        await appendDrift(args.repo_root, "check_design_consistency", findings);
        const isError = findings.some((f) => f.severity === "error");
        return { isError, content: [{ type: "text", text: JSON.stringify(findings, null, 2) }] };
      }

      if (req.params.name === "check_codebase_hygiene") {
        const args = CheckCodebaseHygieneArgs.parse(req.params.arguments ?? {});
        const findings = await checkCodebaseHygiene(args.repo_root, { severity: args.severity });
        await appendDrift(args.repo_root, "check_codebase_hygiene", findings);
        const isError = findings.some((f) => f.severity === "error");
        return { isError, content: [{ type: "text", text: JSON.stringify(findings, null, 2) }] };
      }

      if (req.params.name === "check_tenant_isolation") {
        const args = CheckTenantIsolationArgs.parse(req.params.arguments ?? {});
        const standards = await loadStandards(args.repo_root);
        const findings = await checkTenantIsolation(args.repo_root, standards);
        await appendDrift(args.repo_root, "check_tenant_isolation", findings);
        const isError = findings.some((f) => f.severity === "error");
        return { isError, content: [{ type: "text", text: JSON.stringify(findings, null, 2) }] };
      }

      if (req.params.name === "check_cross_tenant_test") {
        const args = CheckCrossTenantTestArgs.parse(req.params.arguments ?? {});
        const standards = await loadStandards(args.repo_root);
        const findings = await checkCrossTenantTest(args.repo_root, standards);
        await appendDrift(args.repo_root, "check_cross_tenant_test", findings);
        const isError = findings.some((f) => f.severity === "error");
        return { isError, content: [{ type: "text", text: JSON.stringify(findings, null, 2) }] };
      }

      if (req.params.name === "check_framework_support") {
        const args = CheckFrameworkSupportArgs.parse(req.params.arguments ?? {});
        const standards = await loadStandards(args.repo_root);
        const findings = await checkFrameworkSupport(args.repo_root, standards);
        await appendDrift(args.repo_root, "check_framework_support", findings);
        const isError = findings.some((f) => f.severity === "error");
        return { isError, content: [{ type: "text", text: JSON.stringify(findings, null, 2) }] };
      }

      if (req.params.name === "check_env_example") {
        const args = CheckEnvExampleArgs.parse(req.params.arguments ?? {});
        const findings = await checkEnvExample(args.repo_root);
        await appendDrift(args.repo_root, "check_env_example", findings);
        const isError = findings.some((f) => f.severity === "error");
        return { isError, content: [{ type: "text", text: JSON.stringify(findings, null, 2) }] };
      }

      if (req.params.name === "check_subscription") {
        const args = CheckSubscriptionArgs.parse(req.params.arguments ?? {});
        const findings = await checkSubscription(args.repo_root);
        await appendDrift(args.repo_root, "check_subscription", findings);
        const isError = findings.some((f) => f.severity === "error");
        return { isError, content: [{ type: "text", text: JSON.stringify(findings, null, 2) }] };
      }

      if (req.params.name === "check_view_size") {
        const args = CheckViewSizeArgs.parse(req.params.arguments ?? {});
        const standards = await loadStandards(args.repo_root);
        const findings = await checkViewSize(args.repo_root, standards);
        await appendDrift(args.repo_root, "check_view_size", findings);
        const isError = findings.some((f) => f.severity === "error");
        return { isError, content: [{ type: "text", text: JSON.stringify(findings, null, 2) }] };
      }

      if (req.params.name === "check_http_security") {
        const args = CheckHttpSecurityArgs.parse(req.params.arguments ?? {});
        const standards = await loadStandards(args.repo_root);
        const findings = await checkHttpSecurity(args.repo_root, standards);
        await appendDrift(args.repo_root, "check_http_security", findings);
        const isError = findings.some((f) => f.severity === "error");
        return { isError, content: [{ type: "text", text: JSON.stringify(findings, null, 2) }] };
      }

      if (req.params.name === "check_client_bundle_secrets") {
        const args = CheckClientBundleSecretsArgs.parse(req.params.arguments ?? {});
        const standards = await loadStandards(args.repo_root);
        const findings = await checkClientBundleSecrets(args.repo_root, standards);
        await appendDrift(args.repo_root, "check_client_bundle_secrets", findings);
        const isError = findings.some((f) => f.severity === "error");
        return { isError, content: [{ type: "text", text: JSON.stringify(findings, null, 2) }] };
      }

      if (req.params.name === "check_sql_injection") {
        const args = CheckSqlInjectionArgs.parse(req.params.arguments ?? {});
        const findings = await checkSqlInjection(args.repo_root);
        await appendDrift(args.repo_root, "check_sql_injection", findings);
        const isError = findings.some((f) => f.severity === "error");
        return { isError, content: [{ type: "text", text: JSON.stringify(findings, null, 2) }] };
      }

      if (req.params.name === "check_log_pii") {
        const args = CheckLogPiiArgs.parse(req.params.arguments ?? {});
        const standards = await loadStandards(args.repo_root);
        const findings = await checkLogPii(args.repo_root, standards);
        await appendDrift(args.repo_root, "check_log_pii", findings);
        const isError = findings.some((f) => f.severity === "error");
        return { isError, content: [{ type: "text", text: JSON.stringify(findings, null, 2) }] };
      }

      if (req.params.name === "check_http_timeouts") {
        const args = CheckHttpTimeoutsArgs.parse(req.params.arguments ?? {});
        const findings = await checkHttpTimeouts(args.repo_root);
        await appendDrift(args.repo_root, "check_http_timeouts", findings);
        const isError = findings.some((f) => f.severity === "error");
        return { isError, content: [{ type: "text", text: JSON.stringify(findings, null, 2) }] };
      }

      if (req.params.name === "get_rule_metrics") {
        const args = GetRuleMetricsArgs.parse(req.params.arguments ?? {});
        const result = await getRuleMetrics(args.repo_root, {
          rule_id: args.rule_id,
          window_days: args.window_days,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      if (req.params.name === "run_local_checks") {
        const args = RunLocalChecksArgs.parse(req.params.arguments ?? {});
        const include = new Set(args.include ?? ["ci", "branching", "secrets", "design", "hygiene", "tenant", "bundle", "sqli", "log_pii", "http_timeouts", "cross_tenant_test", "env_example", "framework", "view_size", "http_security"]);
        const standards = await loadStandards(args.repo_root);
        const sections: Array<{ source: string; findings: import("./check-ci.js").Finding[] }> = [];
        if (include.has("ci")) {
          const f = await checkCiSetup(args.repo_root, standards);
          sections.push({ source: "check_ci_setup", findings: f });
          await appendDrift(args.repo_root, "check_ci_setup", f);
        }
        if (include.has("branching")) {
          const f = await checkBranching(args.repo_root, standards);
          sections.push({ source: "check_branching", findings: f });
          await appendDrift(args.repo_root, "check_branching", f);
        }
        if (include.has("secrets")) {
          const f = await checkSecrets(args.repo_root, args.secrets_scope);
          sections.push({ source: "check_secrets", findings: f });
          await appendDrift(args.repo_root, "check_secrets", f);
        }
        if (include.has("design")) {
          const f = await checkDesignConsistency(args.repo_root, standards);
          sections.push({ source: "check_design_consistency", findings: f });
          await appendDrift(args.repo_root, "check_design_consistency", f);
        }
        if (include.has("hygiene")) {
          const f = await checkCodebaseHygiene(args.repo_root);
          sections.push({ source: "check_codebase_hygiene", findings: f });
          await appendDrift(args.repo_root, "check_codebase_hygiene", f);
        }
        if (include.has("tenant")) {
          const f = await checkTenantIsolation(args.repo_root, standards);
          sections.push({ source: "check_tenant_isolation", findings: f });
          await appendDrift(args.repo_root, "check_tenant_isolation", f);
        }
        if (include.has("bundle")) {
          const f = await checkClientBundleSecrets(args.repo_root, standards);
          sections.push({ source: "check_client_bundle_secrets", findings: f });
          await appendDrift(args.repo_root, "check_client_bundle_secrets", f);
        }
        if (include.has("sqli")) {
          const f = await checkSqlInjection(args.repo_root);
          sections.push({ source: "check_sql_injection", findings: f });
          await appendDrift(args.repo_root, "check_sql_injection", f);
        }
        if (include.has("log_pii")) {
          const f = await checkLogPii(args.repo_root, standards);
          sections.push({ source: "check_log_pii", findings: f });
          await appendDrift(args.repo_root, "check_log_pii", f);
        }
        if (include.has("http_timeouts")) {
          const f = await checkHttpTimeouts(args.repo_root);
          sections.push({ source: "check_http_timeouts", findings: f });
          await appendDrift(args.repo_root, "check_http_timeouts", f);
        }
        if (include.has("cross_tenant_test")) {
          const f = await checkCrossTenantTest(args.repo_root, standards);
          sections.push({ source: "check_cross_tenant_test", findings: f });
          await appendDrift(args.repo_root, "check_cross_tenant_test", f);
        }
        if (include.has("env_example")) {
          const f = await checkEnvExample(args.repo_root);
          sections.push({ source: "check_env_example", findings: f });
          await appendDrift(args.repo_root, "check_env_example", f);
        }
        if (include.has("framework")) {
          const f = await checkFrameworkSupport(args.repo_root, standards);
          sections.push({ source: "check_framework_support", findings: f });
          await appendDrift(args.repo_root, "check_framework_support", f);
        }
        if (include.has("view_size")) {
          const f = await checkViewSize(args.repo_root, standards);
          sections.push({ source: "check_view_size", findings: f });
          await appendDrift(args.repo_root, "check_view_size", f);
        }
        if (include.has("http_security")) {
          const f = await checkHttpSecurity(args.repo_root, standards);
          sections.push({ source: "check_http_security", findings: f });
          await appendDrift(args.repo_root, "check_http_security", f);
        }
        const isError = sections.some((s) => s.findings.some((f) => f.severity === "error"));
        return { isError, content: [{ type: "text", text: JSON.stringify(sections, null, 2) }] };
      }

      if (req.params.name === "propose_claude_md_rule") {
        const args = ProposeRuleArgs.parse(req.params.arguments ?? {});
        const result = await proposeRule(args);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      if (req.params.name === "get_drift_log") {
        const args = GetDriftLogArgs.parse(req.params.arguments ?? {});
        const summary = await getDriftLog(args.repo_root, args.window_days);
        return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
      }

      if (req.params.name === "get_audit_log") {
        const args = GetAuditLogArgs.parse(req.params.arguments ?? {});
        const result = await readAuditLog(args.repo_root, args.limit);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      if (req.params.name === "get_react_log") {
        const args = GetReactLogArgs.parse(req.params.arguments ?? {});
        const result = await readReactLog(args.repo_root, args.limit, args.task_id);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      if (req.params.name === "start_task") {
        const args = StartTaskArgsZ.parse(req.params.arguments ?? {});
        const standards = await loadStandards(args.repo_root);
        const result = await startTask(args.repo_root, args, standards);
        return {
          isError: result.blocked,
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      if (req.params.name === "propose_change") {
        const args = ProposeChangeArgsZ.parse(req.params.arguments ?? {});
        const standards = await loadStandards(args.repo_root);
        const findings = await proposeChange(args.repo_root, args, standards);
        const isError = findings.some((f) => f.severity === "error");
        return { isError, content: [{ type: "text", text: JSON.stringify(findings, null, 2) }] };
      }

      if (req.params.name === "commit_checkpoint") {
        const args = CommitCheckpointArgsZ.parse(req.params.arguments ?? {});
        const result = await commitCheckpoint(args.repo_root, args);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      if (req.params.name === "expand_scope") {
        const args = ExpandScopeArgsZ.parse(req.params.arguments ?? {});
        const result = await expandScope(args.repo_root, args);
        return {
          isError: result.blocked,
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      if (req.params.name === "attach_asvs_review") {
        const args = AttachAsvsReviewArgsZ.parse(req.params.arguments ?? {});
        const result = await attachAsvsReview(args.repo_root, args);
        return {
          isError: result.blocked,
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      if (req.params.name === "attach_deployment_compat_review") {
        const args = AttachDeploymentCompatReviewArgsZ.parse(req.params.arguments ?? {});
        const result = await attachDeploymentCompatReview(args.repo_root, args);
        return {
          isError: result.blocked,
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      if (req.params.name === "surface_uncertainty") {
        const args = SurfaceUncertaintyArgsZ.parse(req.params.arguments ?? {});
        const standards = await loadStandards(args.repo_root);
        const result = await surfaceUncertainty(args.repo_root, args, standards);
        return {
          isError: result.blocked,
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      throw new Error(`Unknown tool: ${req.params.name}`);
    } catch (err) {
      if (err instanceof StandardsError) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `${err.message}${err.errors ? `\n\nDetails:\n${JSON.stringify(err.errors, null, 2)}` : ""}`,
            },
          ],
        };
      }
      throw err;
    }
  });

  return server;
}
