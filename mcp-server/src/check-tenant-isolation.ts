import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { minimatch } from "minimatch";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import type { Finding } from "./check-ci.js";
import type { AgentStandards, TenantIsolationConfig } from "./standards.js";

const exec = promisify(execCb);

/**
 * Multi-tenant query isolation invariant.
 *
 * For projects with `architecture.tenant_isolation` configured, every
 * function in the configured data_layer_paths must accept the configured
 * tenant_id_field as a parameter. Bypass via inline comment.
 *
 * Supported languages: TypeScript / JavaScript (Increment 7), Python (Increment 8).
 *
 * Approach: per-language method-signature detection. Extract the params block
 * (potentially multi-line) and check whether tenant_id_field appears as an
 * identifier in it.
 *
 * False negatives are accepted (Increment 11's cross-tenant integration test
 * backstops). False positives carry an explicit bypass.
 */

const DEFAULT_BYPASS_PATTERN = "tenant-isolation: bypass";

interface MethodHit {
  /** 0-indexed line number where the signature starts. */
  startLine: number;
  /** Method name as it appears in source. */
  methodName: string;
  /** Full parameter list text, with newlines preserved. */
  params: string;
}

/**
 * Per-language method-signature scanner. Returns hits ordered by appearance.
 * Each scanner is responsible for handling multi-line params on its own.
 */
type Scanner = (content: string) => MethodHit[];

/** TS/JS scanner. Handles interface methods, class methods, object-literal methods, and function declarations. */
function scanTypeScript(content: string): MethodHit[] {
  const hits: MethodHit[] = [];
  const seen = new Set<string>();
  // Patterns that anchor on "name(" — we then extract params via balanced-paren scan.
  const startPatterns: RegExp[] = [
    // class/interface method or function: `name(` after a modifier or line start
    /^\s*(?:export\s+)?(?:async\s+|static\s+|public\s+|private\s+|protected\s+|readonly\s+|function\s+)*([a-z_$][a-zA-Z0-9_$]*)\s*\(/gm,
    // object-literal method: `name: async (` or `name: (`
    /^\s*([a-z_$][a-zA-Z0-9_$]*)\s*:\s*(?:async\s+)?\(/gm,
  ];
  for (const pat of startPatterns) {
    pat.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(content)) !== null) {
      const methodName = m[1];
      if (!methodName) continue;
      if (NON_METHODS_TS.has(methodName)) continue;
      const parenIdx = content.indexOf("(", m.index + m[0].length - 1);
      if (parenIdx < 0) continue;
      const params = extractBalanced(content, parenIdx);
      if (params === null) continue;
      // Disambiguate calls vs declarations: require ':' or '{' or ';' or '=>' after the close paren.
      const afterClose = content.slice(parenIdx + 1 + params.length + 1).trimStart();
      if (!/^(?:[:{;]|=>|<|\?:|\bextends\b)/.test(afterClose)) continue;
      const startLine = content.slice(0, m.index).split("\n").length - 1;
      const key = `${methodName}:${startLine}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ startLine, methodName, params });
    }
  }
  return hits;
}

/**
 * Python scanner. `def name(` and `async def name(` only.
 * Skips `_`-prefixed names by convention (private helpers, dunders). Python
 * service modules conventionally mix public query functions with private
 * compute helpers; the helpers don't touch the database and shouldn't trigger
 * the invariant. If a project genuinely wants private functions checked,
 * they can name them without the leading underscore.
 */
function scanPython(content: string): MethodHit[] {
  const hits: MethodHit[] = [];
  const seen = new Set<string>();
  const pat = /^\s*(?:async\s+)?def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gm;
  let m: RegExpExecArray | null;
  while ((m = pat.exec(content)) !== null) {
    const methodName = m[1];
    if (!methodName) continue;
    if (methodName.startsWith("_")) continue; // skip private + dunder
    const parenIdx = m.index + m[0].length - 1;
    const params = extractBalanced(content, parenIdx);
    if (params === null) continue;
    const startLine = content.slice(0, m.index).split("\n").length - 1;
    const key = `${methodName}:${startLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({ startLine, methodName, params });
  }
  return hits;
}

/**
 * Given content and the index of an opening '(', returns the text between '('
 * and the matching ')' (multi-line, paren-balanced). Returns null if no match
 * (truncated source).
 */
function extractBalanced(content: string, openIdx: number): string | null {
  if (content[openIdx] !== "(") return null;
  let depth = 1;
  let i = openIdx + 1;
  // Skip string contents to avoid mis-counting parens inside strings.
  // Simple state machine — handles ", ', `, and escapes.
  while (i < content.length) {
    const ch = content[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < content.length) {
        if (content[i] === "\\") { i += 2; continue; }
        if (content[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        return content.slice(openIdx + 1, i);
      }
    }
    i++;
  }
  return null;
}

/** Keywords that aren't methods (TS only — Python's `def` makes this unambiguous). */
const NON_METHODS_TS = new Set([
  "if", "else", "for", "while", "switch", "return", "catch", "throw", "try",
  "typeof", "instanceof", "new", "delete", "void", "await", "yield",
  "constructor",
]);

const LANG_SCANNERS: Array<{ exts: string[]; scanner: Scanner; testPattern: RegExp }> = [
  {
    exts: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
    scanner: scanTypeScript,
    testPattern: /\.test\.|\.spec\./,
  },
  {
    exts: [".py"],
    scanner: scanPython,
    testPattern: /(?:^|\/)(?:test_|_test\.py$|tests?\/)/,
  },
];

function pickScanner(filePath: string): { scanner: Scanner; testPattern: RegExp } | null {
  for (const lang of LANG_SCANNERS) {
    for (const ext of lang.exts) {
      if (filePath.endsWith(ext)) return { scanner: lang.scanner, testPattern: lang.testPattern };
    }
  }
  return null;
}

async function listTrackedFiles(repoRoot: string): Promise<string[]> {
  try {
    const { stdout } = await exec("git ls-files", { cwd: repoRoot, maxBuffer: 50 * 1024 * 1024 });
    return stdout.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function paramListMentions(params: string, tenantField: string): boolean {
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
  // File-level bypass: a comment-block line near the top containing the pattern.
  const lines = content.split("\n");
  for (const line of lines.slice(0, 20)) {
    const trimmed = line.trim();
    if (
      trimmed === "" ||
      trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*") ||
      trimmed.startsWith("#") ||
      trimmed.startsWith('"""') || trimmed.startsWith("'''")
    ) {
      if (line.includes(bypassPattern)) return true;
      continue;
    }
    break; // first non-comment line — stop looking
  }
  return false;
}

async function scanFile(
  repoRoot: string,
  relPath: string,
  config: TenantIsolationConfig,
  scanner: Scanner,
): Promise<MethodHit[]> {
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
  const hits = scanner(content);
  const findings: MethodHit[] = [];
  for (const hit of hits) {
    if (exempt.has(hit.methodName)) continue;
    if (lineHasBypass(lines, hit.startLine, bypassPattern)) continue;
    if (paramListMentions(hit.params, config.tenant_id_field)) continue;
    findings.push(hit);
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

  // Filter to files matching any data_layer_paths glob, with a supported scanner, excluding tests.
  interface Target { file: string; scanner: Scanner; }
  const targets: Target[] = [];
  for (const file of allFiles) {
    if (!config.data_layer_paths.some((g) => minimatch(file, g))) continue;
    const lang = pickScanner(file);
    if (!lang) continue;
    if (lang.testPattern.test(file)) continue;
    targets.push({ file, scanner: lang.scanner });
  }

  if (targets.length === 0) {
    return [{
      severity: "warn",
      code: "TENANT_ISOLATION_NO_TARGETS",
      message: `No supported files matched architecture.tenant_isolation.data_layer_paths [${config.data_layer_paths.join(", ")}]. Check the globs.`,
    }];
  }

  const findings: Finding[] = [];
  for (const target of targets) {
    const hits = await scanFile(repoRoot, target.file, config, target.scanner);
    for (const h of hits) {
      const paramsOneLine = h.params.replace(/\s+/g, " ").trim().slice(0, 80);
      findings.push({
        severity: "info",
        code: "TENANT_ISOLATION_MISSING",
        message:
          `${target.file}:${h.startLine + 1}: hint — method '${h.methodName}(${paramsOneLine})' doesn't take '${config.tenant_id_field}'. ` +
          `Verify it's intentional (worker scan, anonymised aggregate, pure compute, tenant-establishing query, etc.). ` +
          `The load-bearing defense for cross-tenant leaks is check_cross_tenant_test — not this signature heuristic.`,
        fix:
          `If this method should be tenant-scoped, add '${config.tenant_id_field}' to the parameter list. ` +
          `Otherwise no action needed; this is informational. You may suppress via '// ${config.bypass_comment_pattern ?? DEFAULT_BYPASS_PATTERN}: <reason>' if you want a clean run.`,
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
