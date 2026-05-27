import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { loadStandards, groupRulesByTier, type AgentStandards, type Tier } from "./standards.js";

/**
 * Per-rule metrics (Increment 11).
 *
 * Reads .agent-standards-drift.jsonl and groups findings by rule_id over a
 * time window. Cross-references with the project's standards to identify
 * rules that have NEVER fired — those are candidates for demotion or
 * deletion in the quarterly review.
 *
 * Code→rule_id mapping lives here, not on each check. Checks emit findings
 * with a `code` (e.g. NO_COMMENTED_CODE); this module maps code to
 * rule_id (e.g. no_commented_code). The mapping is one-way: each code
 * belongs to at most one rule. Codes that don't map (info codes like
 * BUNDLE_NONE, _OK, etc.) are excluded from rule metrics.
 *
 * Quarterly review usage:
 *   - rules_with_high_violations: candidates for tooling/promotion
 *   - rules_with_zero_events: candidates for demotion or deletion
 *   - by_severity per rule: shows if a rule mostly warns vs errors
 */

const DRIFT_FILE = ".agent-standards-drift.jsonl";

/** Maps drift-log `code` values to rule IDs in org-defaults.yml. */
const CODE_TO_RULE_ID: Record<string, string> = {
  // check_codebase_hygiene (Increment 6)
  NO_COMMENTED_CODE: "no_commented_code",
  NO_UNTRACKED_TODOS: "no_untracked_todos",
  // check_tenant_isolation (Increments 7-8)
  TENANT_ISOLATION_MISSING: "multi_tenant_query_isolation",
  // check_cross_tenant_test (Beyond-W15 / W17-18)
  CROSS_TENANT_TEST_MISSING: "cross_tenant_test_coverage",
  CROSS_TENANT_TEST_EMPTY: "cross_tenant_test_coverage",
  CROSS_TENANT_TEST_UNDER_COVERAGE: "cross_tenant_test_coverage",
  CROSS_TENANT_TEST_NOT_DESIGNATED: "cross_tenant_test_coverage",
  CROSS_TENANT_TEST_UNREADABLE: "cross_tenant_test_coverage",
  // check_env_example (Beyond-W15 cash-up)
  ENV_EXAMPLE_MISSING: "env_example_present",
  ENV_EXAMPLE_INCOMPLETE: "env_example_present",
  ENV_EXAMPLE_UNREADABLE: "env_example_present",
  // check_view_size (Beyond-W15 cash-up)
  VIEW_SIZE_EXCEEDED: "view_size_limit",
  // check_http_security (Beyond-W15 cash-up)
  HTTP_SEC_MISSING_HEADERS: "http_security_headers",
  HTTP_SEC_CORS_WILDCARD_WITH_CREDENTIALS: "cors_explicit_origins",
  // check_client_bundle_secrets (Increment 10.1)
  BUNDLE_SECRET_LEAK: "service_role_keys_not_in_client",
  // check_sql_injection (Increment 10.2)
  SQLI_CONCAT: "parameterised_queries_only",
  // check_log_pii (Increment 10.3)
  LOG_PII: "no_pii_in_logs",
  // check_http_timeouts (Increment 10.4)
  HTTP_NO_TIMEOUT: "external_http_has_timeout",
  // check_secrets (existing)
  SECRET_FORGE_PIPE: "no_committed_secrets",
  SECRET_AWS_ACCESS_KEY: "no_committed_secrets",
  SECRET_AWS_SECRET_KEY: "no_committed_secrets",
  SECRET_GITHUB_TOKEN: "no_committed_secrets",
  SECRET_SLACK_TOKEN: "no_committed_secrets",
  SECRET_STRIPE_KEY: "no_committed_secrets",
  SECRET_OPENAI_KEY: "no_committed_secrets",
  SECRET_ANTHROPIC_KEY: "no_committed_secrets",
  SECRET_SUPABASE_KEY: "no_committed_secrets",
  SECRET_JWT: "no_committed_secrets",
  SECRET_PEM_PRIVATE_KEY: "no_committed_secrets",
  // check_design_consistency (existing)
  DESIGN_OFF_TOKEN_COLOR: "design_tokens_only",
  DESIGN_OFF_TOKEN_SPACING: "design_tokens_only",
  DESIGN_INLINE_STYLE: "design_tokens_only",
  DESIGN_FONT_CAP_EXCEEDED: "design_tokens_only",
  DESIGN_COLOR_CAP_EXCEEDED: "design_tokens_only",
  // check_ci_setup — these report workflow shape, not rule violations
  // (no rule_id mapping intentional)
  // task-tracking — these are gate firings, mapped to gate rule IDs
  TASK_DOR_INCOMPLETE: "definition_of_ready_gate",
  TASK_SCOPE_EXPANSION: "scope_expansion_gate",
  TASK_AUTH_NO_ASVS_ARTIFACT: "auth_change_asvs_artifact",
  TASK_WRONG_MODEL_FOR_EXECUTION: "model_phase_routing",
  TASK_PLANNING_PHASE_WRITE: "model_phase_routing",
  // Increment 8.5 gates
  TASK_OPEN_UNCERTAINTY: "surface_uncertainty_gate",
  TASK_BUGFIX_NO_ROOT_CAUSE: "bugfix_root_cause_gate",
};

interface DriftEntry {
  ts: string;
  source: string;
  severity: "error" | "warn" | "info";
  code: string;
  message: string;
}

export interface RuleMetric {
  rule_id: string;
  tier: Tier | "unknown";
  /** Total finding count over the window. */
  count: number;
  /** Per-severity breakdown. */
  by_severity: { error: number; warn: number; info: number };
  /** Distinct check sources that produced findings for this rule. */
  sources: string[];
  /** Most recent finding timestamp. */
  latest: string;
}

export interface RuleMetricsResult {
  window_days: number;
  total_entries: number;
  /** Rules with at least one event in the window, sorted by count desc. */
  rules_with_events: RuleMetric[];
  /**
   * Rule IDs declared in standards but with zero events in the window.
   * Candidates for demotion or deletion in the quarterly review.
   */
  rules_with_zero_events: Array<{ rule_id: string; tier: Tier; in_org_defaults: boolean }>;
  /** Codes from the drift log that don't map to any rule (debugging aid). */
  unmapped_codes: Array<{ code: string; count: number }>;
}

async function readDriftEntries(repoRoot: string, sinceMs: number): Promise<DriftEntry[]> {
  const path = join(repoRoot, DRIFT_FILE);
  try {
    await access(path);
  } catch {
    return [];
  }
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return [];
  }
  const entries: DriftEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as DriftEntry;
      if (Date.parse(e.ts) >= sinceMs) entries.push(e);
    } catch { /* skip malformed */ }
  }
  return entries;
}

function collectStandardsRuleIds(standards: AgentStandards): Map<string, Tier> {
  const grouped = groupRulesByTier(standards);
  const out = new Map<string, Tier>();
  for (const tier of ["invariant", "gate", "practice"] as const) {
    for (const rule of grouped.rules_by_tier[tier]) {
      if (rule.id) out.set(rule.id, tier);
    }
  }
  return out;
}

export interface GetRuleMetricsOptions {
  /** Filter to a single rule ID. */
  rule_id?: string;
  /** Window in days. Defaults to 90 (quarterly review). */
  window_days?: number;
}

export async function getRuleMetrics(
  repoRoot: string,
  opts: GetRuleMetricsOptions = {}
): Promise<RuleMetricsResult> {
  const windowDays = opts.window_days ?? 90;
  const sinceMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;

  const entries = await readDriftEntries(repoRoot, sinceMs);

  // Standards-side rule inventory — for the zero-events list
  let standardsRules = new Map<string, Tier>();
  try {
    const standards = await loadStandards(repoRoot);
    standardsRules = collectStandardsRuleIds(standards);
  } catch {
    // Project has no .agent-standards.yml; that's fine, we just can't list zero-event rules.
  }

  interface Accumulator {
    count: number;
    by_severity: { error: number; warn: number; info: number };
    sources: Set<string>;
    latest: string;
  }
  const ruleMap = new Map<string, Accumulator>();
  const unmapped = new Map<string, number>();

  for (const e of entries) {
    const ruleId = CODE_TO_RULE_ID[e.code];
    if (!ruleId) {
      // Skip info-only codes — those aren't rule violations
      if (e.severity === "info") continue;
      unmapped.set(e.code, (unmapped.get(e.code) ?? 0) + 1);
      continue;
    }
    if (opts.rule_id && ruleId !== opts.rule_id) continue;

    let acc = ruleMap.get(ruleId);
    if (!acc) {
      acc = { count: 0, by_severity: { error: 0, warn: 0, info: 0 }, sources: new Set(), latest: e.ts };
      ruleMap.set(ruleId, acc);
    }
    acc.count++;
    acc.by_severity[e.severity]++;
    acc.sources.add(e.source);
    if (e.ts > acc.latest) acc.latest = e.ts;
  }

  const rulesWithEvents: RuleMetric[] = [];
  for (const [rule_id, acc] of ruleMap.entries()) {
    rulesWithEvents.push({
      rule_id,
      tier: standardsRules.get(rule_id) ?? "unknown",
      count: acc.count,
      by_severity: acc.by_severity,
      sources: [...acc.sources].sort(),
      latest: acc.latest,
    });
  }
  rulesWithEvents.sort((a, b) => b.count - a.count);

  // Zero-event rules: in standards but absent from ruleMap
  const rulesWithZeroEvents: RuleMetricsResult["rules_with_zero_events"] = [];
  if (!opts.rule_id) {
    for (const [rule_id, tier] of standardsRules.entries()) {
      if (!ruleMap.has(rule_id)) {
        rulesWithZeroEvents.push({ rule_id, tier, in_org_defaults: true });
      }
    }
    rulesWithZeroEvents.sort((a, b) => a.rule_id.localeCompare(b.rule_id));
  }

  const unmappedCodes = [...unmapped.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);

  return {
    window_days: windowDays,
    total_entries: entries.length,
    rules_with_events: rulesWithEvents,
    rules_with_zero_events: rulesWithZeroEvents,
    unmapped_codes: unmappedCodes,
  };
}
