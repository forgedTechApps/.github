import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { minimatch } from "minimatch";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import type { Finding } from "./check-ci.js";
import type { AgentStandards, TenantIsolationConfig } from "./standards.js";

const exec = promisify(execCb);

/**
 * Multi-tenant query isolation invariant (Increment 7).
 *
 * For projects with `architecture.tenant_isolation` configured, every
 * function in the configured data_layer_paths must accept the configured
 * tenant_id_field as a parameter. Bypass via inline comment.
 *
 * Approach: regex on method signatures. Full AST would be more accurate but
 * the signature grammar is regular enough to make regex tractable. False
 * negatives are acceptable (cross-tenant integration test backstops); false
 * positives carry an explicit bypass.
 *
 * Supported shapes (TypeScript):
 *   - Interface methods:           `methodName(args): ReturnType;`
 *   - Class methods:               `async? methodName(args): ReturnType {`
 *   - Object-literal methods:      `methodName: async (args) => ...`
 *   - Function declarations:       `function methodName(args): ReturnType {`
 *
 * Not supported (yet):
 *   - Generic type parameters spanning >1 line of the signature
 *   - Higher-order functions returning functions (the inner function isn't checked)
 *   - Languages other than TS/JS (.cs, .swift, .py, .dart). Add per-language
 *     parsers when generalising to other projects (Increment 8).
 */

/** Matches the start of a method/function signature. Captures method name + parameter list. */
const METHOD_PATTERNS: RegExp[] = [
  // interface body / class methods (with optional async/static/private/public/readonly)
  /^\s*(?:async\s+|static\s+|public\s+|private\s+|protected\s+|readonly\s+)*([a-z_$][a-zA-Z0-9_$]*)\s*\(([^)]*)\)\s*[:{;]/gm,
  // object-literal: methodName: (args) => or methodName: async (args) =>
  /^\s*([a-z_$][a-zA-Z0-9_$]*)\s*:\s*(?:async\s+)?\(([^)]*)\)\s*(?::|=>)/gm,
  // function declarations
  /^\s*(?:export\s+)?(?:async\s+)?function\s+([a-z_$][a-zA-Z0-9_$]*)\s*\(([^)]*)\)/gm,
];

/** Keywords that aren't methods (avoid catching them via the generic regex). */
const NON_METHODS = new Set([
  "if", "else", "for", "while", "switch", "return", "catch", "throw", "try",
  "typeof", "instanceof", "new", "delete", "void", "await", "yield",
  "constructor", // constructors are special; tenant_id is enforced on instance methods
]);

const DEFAULT_BYPASS_PATTERN = "tenant-isolation: bypass";

async function listTrackedFiles(repoRoot: string): Promise<string[]> {
  try {
    const { stdout } = await exec("git ls-files", { cwd: repoRoot, maxBuffer: 50 * 1024 * 1024 });
    return stdout.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

interface UncheckedMethod {
  file: string;
  line: number;
  methodName: string;
  params: string;
}

function paramListMentions(params: string, tenantField: string): boolean {
  // Match the field as an identifier (handle `householdId: string`, `householdId,`, etc.)
  // Avoid matching it inside a longer name like `oldHouseholdId`.
  const re = new RegExp(`\\b${tenantField}\\b`);
  return re.test(params);
}

function lineHasBypass(lines: string[], lineIdx: number, bypassPattern: string): boolean {
  // Bypass can be on the same line (trailing) or the immediately preceding line.
  const sameLine = lines[lineIdx];
  if (sameLine && sameLine.includes(bypassPattern)) return true;
  const prev = lines[lineIdx - 1];
  if (prev && prev.trim().includes(bypassPattern)) return true;
  return false;
}

function fileHasGlobalBypass(content: string, bypassPattern: string): boolean {
  // File-level bypass: a line at the top of the file (before any non-comment line)
  // containing the bypass pattern. Useful for declaring whole-file exemption.
  const lines = content.split("\n");
  for (const line of lines.slice(0, 20)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      if (line.includes(bypassPattern)) return true;
      continue;
    }
    // First non-comment line → stop looking
    break;
  }
  return false;
}

async function scanFile(
  repoRoot: string,
  relPath: string,
  config: TenantIsolationConfig
): Promise<UncheckedMethod[]> {
  let content: string;
  try {
    content = await readFile(join(repoRoot, relPath), "utf8");
  } catch {
    return [];
  }
  const bypassPattern = config.bypass_comment_pattern ?? DEFAULT_BYPASS_PATTERN;
  if (fileHasGlobalBypass(content, bypassPattern)) return [];

  const lines = content.split("\n");
  const exempt = new Set(config.exempt_methods ?? []);
  const seen = new Set<string>(); // dedupe by `methodName:line` — multiple patterns may match the same site
  const findings: UncheckedMethod[] = [];

  // Build a line-number index by scanning for matches via patterns
  for (const pattern of METHOD_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(content)) !== null) {
      const methodName = m[1];
      const params = m[2] ?? "";
      if (!methodName) continue;
      if (NON_METHODS.has(methodName)) continue;
      if (exempt.has(methodName)) continue;

      // Resolve line number from the match offset
      const lineIdx = content.slice(0, m.index).split("\n").length - 1;
      const key = `${methodName}:${lineIdx}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (lineHasBypass(lines, lineIdx, bypassPattern)) continue;
      if (paramListMentions(params, config.tenant_id_field)) continue;

      findings.push({
        file: relPath,
        line: lineIdx + 1,
        methodName,
        params: params.trim(),
      });
    }
  }
  return findings;
}

export async function checkTenantIsolation(
  repoRoot: string,
  standards: AgentStandards
): Promise<Finding[]> {
  const config = standards.architecture?.tenant_isolation;
  if (!config) {
    return [{
      severity: "info",
      code: "TENANT_ISOLATION_NOT_CONFIGURED",
      message: "architecture.tenant_isolation is not configured. Add { tenant_id_field, data_layer_paths } to enable the check.",
    }];
  }

  const allFiles = await listTrackedFiles(repoRoot);
  if (allFiles.length === 0) {
    return [{ severity: "info", code: "TENANT_ISOLATION_NO_FILES", message: "git ls-files returned no tracked files." }];
  }

  // Filter to files matching any data_layer_paths glob, .ts/.tsx/.js/.mjs only
  const targets = allFiles.filter((f) => {
    if (!/\.(ts|tsx|js|mjs|cjs)$/.test(f)) return false;
    if (/\.test\.|\.spec\./.test(f)) return false; // skip tests
    return config.data_layer_paths.some((g) => minimatch(f, g));
  });

  if (targets.length === 0) {
    return [{
      severity: "warn",
      code: "TENANT_ISOLATION_NO_TARGETS",
      message: `No files matched architecture.tenant_isolation.data_layer_paths [${config.data_layer_paths.join(", ")}]. Check the globs.`,
    }];
  }

  const findings: Finding[] = [];
  for (const file of targets) {
    const unchecked = await scanFile(repoRoot, file, config);
    for (const u of unchecked) {
      findings.push({
        severity: "error",
        code: "TENANT_ISOLATION_MISSING",
        message:
          `${u.file}:${u.line}: method '${u.methodName}(${u.params})' does not accept '${config.tenant_id_field}' as a parameter. ` +
          `Multi-tenant invariant: every query in the data layer must scope by tenant.`,
        fix:
          `Add '${config.tenant_id_field}: string' to the parameter list and use it in the query filter. ` +
          `If this method is legitimately tenant-free, add an inline comment '// ${config.bypass_comment_pattern ?? DEFAULT_BYPASS_PATTERN}: <reason>' on the line above the signature.`,
      });
    }
  }

  if (findings.length === 0) {
    findings.push({
      severity: "info",
      code: "TENANT_ISOLATION_OK",
      message: `Scanned ${targets.length} data-layer file(s). All methods accept '${config.tenant_id_field}' (or are exempt/bypassed).`,
    });
  }

  return findings;
}
