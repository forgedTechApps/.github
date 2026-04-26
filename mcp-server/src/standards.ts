import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { Ajv2020 } from "ajv/dist/2020.js";
import schema from "../../agent-standards/schema/agent-standards.schema.json" with { type: "json" };

export interface AgentStandards {
  version: 1;
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

/** Read and validate `.agent-standards.yml` at the given repo root. */
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

  return parsed as AgentStandards;
}
