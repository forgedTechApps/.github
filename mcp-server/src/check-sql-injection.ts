import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import type { Finding } from "./check-ci.js";

const exec = promisify(execCb);

/**
 * SQL injection / string-concat-query check (Increment 10.2).
 *
 * Catches the 80% case: visible string interpolation inside SQL fragments.
 * Three suspicious shapes:
 *   - Template literals with interpolation:  `SELECT ... ${expr} ...`
 *   - String concatenation with SQL keywords nearby
 *   - Python f-strings containing SQL keywords: f"SELECT ... {expr}"
 *
 * Conservative on purpose. False positives ("error message about a SELECT
 * statement" inside a string) erode trust faster than false negatives. The
 * cross-tenant integration test (Increment 11) and real SAST tools
 * (Semgrep, CodeQL via CI) are the deeper backstop.
 *
 * Supported languages: TypeScript/JavaScript, Python.
 */

const SQL_KEYWORDS = /\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|WHERE|FROM\s+\w|JOIN\s+\w|UNION\s+SELECT|DROP\s+TABLE|ALTER\s+TABLE|CREATE\s+TABLE|TRUNCATE)\b/i;

/** Template literal containing both interpolation AND a SQL keyword. */
const TS_TEMPLATE_SQL = /`[^`]*\b(?:SELECT|INSERT|UPDATE|DELETE|WHERE|FROM)\b[^`]*\$\{[^}]+\}[^`]*`/g;

/** String concatenation with a SQL keyword nearby. */
const TS_CONCAT_SQL = /['"][^'"]*\b(?:SELECT|INSERT|UPDATE|DELETE|WHERE|FROM)\b[^'"]*['"]\s*\+\s*\w/g;

/** Python f-string with a SQL keyword. */
const PY_FSTRING_SQL = /\bf['"][^'"]*\b(?:SELECT|INSERT|UPDATE|DELETE|WHERE|FROM)\b[^'"]*\{[^}]+\}[^'"]*['"]/g;

/** Python `% formatting` or `.format()` with SQL keyword nearby. */
const PY_PERCENT_SQL = /['"][^'"]*\b(?:SELECT|INSERT|UPDATE|DELETE|WHERE|FROM)\b[^'"]*['"]\s*%\s*[(]/g;

const SKIP_DIRS = /\/(?:node_modules|dist|build|\.next|coverage|__pycache__|\.venv|venv)\//;
const SKIP_TESTS = /(?:^|\/)(?:test_|tests?\/|.*\.test\.|.*\.spec\.)/;

interface InjectionHit {
  file: string;
  line: number;
  pattern: string;
  preview: string;
}

async function listTrackedSourceFiles(repoRoot: string): Promise<string[]> {
  try {
    const { stdout } = await exec("git ls-files", { cwd: repoRoot, maxBuffer: 50 * 1024 * 1024 });
    return stdout
      .split("\n")
      .filter((f) => /\.(ts|tsx|js|mjs|cjs|jsx|py)$/.test(f))
      .filter((f) => !SKIP_DIRS.test(f))
      .filter((f) => !SKIP_TESTS.test(f));
  } catch {
    return [];
  }
}

function scanLine(line: string, file: string, lineNum: number, isPython: boolean): InjectionHit[] {
  const hits: InjectionHit[] = [];
  const patterns: Array<[RegExp, string]> = isPython
    ? [
        [PY_FSTRING_SQL, "Python f-string with SQL keyword + interpolation"],
        [PY_PERCENT_SQL, "Python %-formatted string with SQL keyword"],
      ]
    : [
        [TS_TEMPLATE_SQL, "template literal with SQL keyword + ${} interpolation"],
        [TS_CONCAT_SQL, "string concatenation with SQL keyword nearby"],
      ];

  for (const [pat, name] of patterns) {
    pat.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(line)) !== null) {
      hits.push({
        file,
        line: lineNum,
        pattern: name,
        preview: m[0].slice(0, 80).replace(/\s+/g, " "),
      });
      if (hits.length > 5) break;
    }
  }
  return hits;
}

export async function checkSqlInjection(repoRoot: string): Promise<Finding[]> {
  const files = await listTrackedSourceFiles(repoRoot);
  if (files.length === 0) {
    return [{ severity: "info", code: "SQLI_NO_FILES", message: "No tracked source files matched." }];
  }

  const allHits: InjectionHit[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = await readFile(join(repoRoot, file), "utf8");
    } catch {
      continue;
    }
    // Pre-filter: skip files with no SQL keywords at all
    if (!SQL_KEYWORDS.test(content)) continue;
    const isPython = file.endsWith(".py");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      // bypass directive
      if (line.includes("agent-standards: allow-sql-concat") || line.includes("nosec")) continue;
      allHits.push(...scanLine(line, file, i + 1, isPython));
      if (allHits.length > 100) break;
    }
    if (allHits.length > 100) break;
  }

  if (allHits.length === 0) {
    return [{
      severity: "info",
      code: "SQLI_OK",
      message: `Scanned ${files.length} source file(s). No string-concatenated SQL patterns found.`,
    }];
  }

  return allHits.map((h) => ({
    severity: "warn" as const,
    code: "SQLI_CONCAT",
    message:
      `${h.file}:${h.line}: ${h.pattern}. ` +
      `Preview: ${JSON.stringify(h.preview)}. ` +
      `Possible SQL injection — regex hint, not a proof. Many ORMs / query builders accept template strings safely; ` +
      `the real defense is parameterised queries everywhere, enforced in review.`,
    fix:
      `If this is a real concat into a raw query, switch to parameterised: '?', $1, :name. ` +
      `If safe (ORM template, known-safe dynamic column from an allowlist), ` +
      `add a trailing comment '// agent-standards: allow-sql-concat <reason>' to suppress.`,
  }));
}
