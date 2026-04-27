import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { Ajv2020 } from "ajv/dist/2020.js";
import schema from "../../agent-standards/schema/agent-standards.schema.json" with { type: "json" };

export interface AgentStandards {
  version: 1;
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
  style?: string[];
  architecture?: {
    rules?: string[];
    feature_path_pattern?: string;
    sensitive_paths?: string[];
  };
  test_coverage?: {
    unit_min?: number;
    integration_min?: number;
    regression_required_for?: string[];
    notes?: string[];
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
  if (project.extends) {
    const targets = Array.isArray(project.extends) ? project.extends : [project.extends];
    let merged: Partial<AgentStandards> = {};
    for (const target of targets) {
      const defaults = await loadDefaults(target);
      merged = mergeStandards(merged, defaults);
    }
    merged = mergeStandards(merged, project);
    // Re-cast: required fields (version, repo, language) come from the project file itself.
    return merged as AgentStandards;
  }

  return project;
}
