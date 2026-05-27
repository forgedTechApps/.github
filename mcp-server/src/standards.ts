import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { Ajv2020 } from "ajv/dist/2020.js";
import schema from "../../agent-standards/schema/agent-standards.schema.json" with { type: "json" };

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

/** A rule as it appears in YAML: either a legacy plain string or a tiered object. */
export type RawRule =
  | string
  | (Omit<NormalisedRule, "severity"> & { severity?: "error" | "warn" | "info" });

export interface AgentStandards {
  version: 1 | 2;
  extends?: string | string[];
  repo: string;
  language: "swift" | "flutter" | "node" | "python" | "dotnet" | "mixed";
  stack?: {
    package_manager?: string;
    test_runner?: string;
    lint?: string;
    format?: string;
    build?: string;
  };
  style?: RawRule[];
  /** UI-only style rules; folded into `style` post-merge only when ci.kind is mobile or web. */
  style_ui?: RawRule[];
  architecture?: {
    rules?: RawRule[];
    /** UI-only arch rules; folded into `rules` post-merge only when ci.kind is mobile or web. */
    rules_ui?: RawRule[];
    feature_path_pattern?: string;
    sensitive_paths?: string[];
  };
  test_coverage?: {
    unit_min?: number;
    integration_min?: number;
    regression_required_for?: string[];
    notes?: string[];
    per_surface?: Record<string, { statements?: number; branches?: number; functions?: number; lines?: number }>;
    excluded?: string[];
    excluded_rationale?: string[];
    rules?: string[];
    exempt_from_test_requirement?: string[];
  };
  review?: {
    explicit_approval_required_for?: string[];
    no_force_push_branches?: string[];
  };
  investigation?: {
    mode?: "soft" | "hard";
    min_read_write_ratio?: number;
  };
  context_pointers?: string[];
  design_references?: Array<{
    source: string;
    url?: string;
    what: string;
  }>;
  ci?: {
    kind: "service" | "library" | "mobile" | "web";
    deploy_target?: "railway" | "vercel" | "app-store" | "play-store" | "none";
    bespoke?: boolean;
    bespoke_reason?: string;
  };
  branching?: {
    required_branches?: string[];
    default_branch?: string;
    feature_branch_pattern?: string;
    mode?: "soft" | "hard";
  };
  models?: {
    planning?: ModelSpec;
    execution?: ModelSpec;
  };
  /** Project-level gate toggles (Increment 2+). */
  gates?: {
    definition_of_ready?: {
      enabled?: boolean;
      /** Optional override of the required field list. Defaults applied in task-tracking.ts. */
      required_fields?: Array<"scope_statement" | "files_intended" | "test_approach" | "definition_of_done" | "out_of_scope">;
    };
    scope_expansion?: {
      enabled?: boolean;
    };
    auth_change_asvs_artifact?: {
      enabled?: boolean;
      /** Glob patterns for auth-sensitive paths. Defaults applied in task-tracking.ts. */
      paths?: string[];
    };
  };
}

export interface ModelSpec {
  model: "opus" | "sonnet" | "haiku";
  effort?: "low" | "medium" | "high";
}

export type Phase = "planning" | "execution";

/**
 * Maps a declared current_model string (e.g. "claude-opus-4-7") to its
 * logical family (opus / sonnet / haiku). Substring match — tolerant of
 * version suffixes and aliases. Returns null if not recognised.
 */
export function classifyModel(name: string | undefined): "opus" | "sonnet" | "haiku" | null {
  if (!name) return null;
  const n = name.toLowerCase();
  if (n.includes("opus")) return "opus";
  if (n.includes("sonnet")) return "sonnet";
  if (n.includes("haiku")) return "haiku";
  return null;
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile<AgentStandards>(schema);

export class StandardsError extends Error {
  constructor(message: string, public readonly errors?: unknown) {
    super(message);
  }
}

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULTS_DIR = resolve(HERE, "../templates/defaults");

/** Built-in defaults bundled with the MCP package. Maps `extends:` value → file path. */
const BUILTIN_DEFAULTS: Record<string, string> = {
  "forgedtech/org-defaults": join(DEFAULTS_DIR, "org-defaults.yml"),
};

async function loadDefaults(name: string): Promise<Partial<AgentStandards>> {
  const path = BUILTIN_DEFAULTS[name];
  if (!path) {
    throw new StandardsError(
      `Unknown extends target: '${name}'. Known targets: ${Object.keys(BUILTIN_DEFAULTS).join(", ")}`
    );
  }
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    throw new StandardsError(`Failed to read defaults '${name}' at ${path}: ${(err as Error).message}`);
  }
  try {
    return parseYaml(raw) as Partial<AgentStandards>;
  } catch (err) {
    throw new StandardsError(`Failed to parse defaults '${name}' at ${path}: ${(err as Error).message}`);
  }
}

/**
 * Merge `base` (defaults) with `override` (project file). Project wins on:
 *   - scalars (numbers, strings, booleans)
 *   - object fields (recursively merged, but project's value at each leaf wins)
 *
 * Arrays concatenate with project values first, deduplicated by structural identity
 * (JSON.stringify) — so an array of strings dedupes naturally; an array of identical
 * objects dedupes too.
 */
function mergeStandards(base: Partial<AgentStandards>, override: Partial<AgentStandards>): Partial<AgentStandards> {
  return deepMerge(base, override) as Partial<AgentStandards>;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (override === undefined) return base;
  if (base === undefined) return override;

  if (Array.isArray(base) && Array.isArray(override)) {
    const seen = new Set<string>();
    const out: unknown[] = [];
    for (const v of [...override, ...base]) {
      const key = JSON.stringify(v);
      if (!seen.has(key)) { seen.add(key); out.push(v); }
    }
    return out;
  }

  if (isPlainObject(base) && isPlainObject(override)) {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(override)) {
      out[k] = deepMerge(base[k], v);
    }
    return out;
  }

  // Scalars (or type mismatch): override wins
  return override;
}

/** Read and validate `.agent-standards.yml` at the given repo root, resolving any `extends:`. */
export async function loadStandards(repoRoot: string): Promise<AgentStandards> {
  const path = join(repoRoot, ".agent-standards.yml");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new StandardsError(
        `No .agent-standards.yml at ${repoRoot}. Every repo must declare its standards.`
      );
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new StandardsError(`Failed to parse YAML at ${path}: ${(err as Error).message}`);
  }

  if (!validate(parsed)) {
    throw new StandardsError(
      `.agent-standards.yml at ${path} failed schema validation.`,
      validate.errors
    );
  }

  const project = parsed as AgentStandards;

  // Resolve extends — load defaults first, then merge project on top.
  let result: AgentStandards;
  if (project.extends) {
    const targets = Array.isArray(project.extends) ? project.extends : [project.extends];
    let merged: Partial<AgentStandards> = {};
    for (const target of targets) {
      const defaults = await loadDefaults(target);
      merged = mergeStandards(merged, defaults);
    }
    merged = mergeStandards(merged, project);
    // Re-cast: required fields (version, repo, language) come from the project file itself.
    result = merged as AgentStandards;
  } else {
    result = project;
  }

  return foldUiRules(result);
}

/**
 * Conditional UI-rule loading. UI rules live under `style_ui` and
 * `architecture.rules_ui`. They are folded into `style` / `architecture.rules`
 * only when ci.kind is 'mobile' or 'web' — saves tokens on services /
 * libraries / Workers where they don't apply.
 *
 * After folding, the `*_ui` keys are removed from the response so the
 * payload is lean and consumers don't need to know about the split.
 */
function foldUiRules(s: AgentStandards): AgentStandards {
  const isUi = s.ci?.kind === "mobile" || s.ci?.kind === "web";

  const dedupe = (rules: RawRule[]): RawRule[] => {
    const seen = new Set<string>();
    const out: RawRule[] = [];
    for (const v of rules) {
      const key = typeof v === "string" ? v : JSON.stringify(v);
      if (!seen.has(key)) { seen.add(key); out.push(v); }
    }
    return out;
  };

  // Fold style_ui → style if applicable
  const styleUi = s.style_ui ?? [];
  let style = s.style;
  if (isUi && styleUi.length > 0) {
    style = dedupe([...(style ?? []), ...styleUi]);
  }

  // Fold architecture.rules_ui → architecture.rules if applicable
  const archRulesUi = s.architecture?.rules_ui ?? [];
  let architecture = s.architecture;
  if (isUi && archRulesUi.length > 0 && architecture) {
    architecture = { ...architecture, rules: dedupe([...(architecture.rules ?? []), ...archRulesUi]) };
  }

  // Strip the *_ui keys from the response — they've served their purpose
  const { style_ui: _styleUi, ...rest } = s;
  const out: AgentStandards = { ...rest, style };
  if (architecture) {
    const { rules_ui: _rulesUi, ...archRest } = architecture;
    out.architecture = archRest;
  }
  return out;
}

/**
 * Normalise a raw rule (string or object) to a NormalisedRule with explicit
 * tier and severity. Plain strings default to tier=practice, severity=error.
 */
export function normaliseRule(r: RawRule): NormalisedRule {
  if (typeof r === "string") {
    return { rule: r, tier: "practice", severity: "error" };
  }
  return { severity: "error", ...r };
}

export type RuleSource = "style" | "style_ui" | "architecture.rules" | "architecture.rules_ui";

export interface StandardsWithTiers extends AgentStandards {
  rules_by_tier: {
    invariant: Array<NormalisedRule & { source: RuleSource }>;
    gate: Array<NormalisedRule & { source: RuleSource }>;
    practice: Array<NormalisedRule & { source: RuleSource }>;
  };
  deferred_invariants: Array<NormalisedRule & { source: RuleSource }>;
}

/**
 * Returns standards with rule arrays normalised and grouped by tier. Original
 * arrays are preserved on the root object so existing consumers don't break.
 * `deferred_invariants` collects invariants whose check_command isn't yet
 * built — surfaced by check_paths as DEFERRED_INVARIANT_NO_CHECK info.
 */
export function groupRulesByTier(s: AgentStandards): StandardsWithTiers {
  const groups: StandardsWithTiers["rules_by_tier"] = { invariant: [], gate: [], practice: [] };
  const deferred: StandardsWithTiers["deferred_invariants"] = [];

  const collect = (arr: RawRule[] | undefined, source: RuleSource) => {
    for (const raw of arr ?? []) {
      const n = normaliseRule(raw);
      const withSource = { ...n, source };
      groups[n.tier].push(withSource);
      if (n.tier === "invariant" && n.deferred) {
        deferred.push(withSource);
      }
    }
  };

  collect(s.style, "style");
  collect(s.style_ui, "style_ui");
  collect(s.architecture?.rules, "architecture.rules");
  collect(s.architecture?.rules_ui, "architecture.rules_ui");

  return { ...s, rules_by_tier: groups, deferred_invariants: deferred };
}
