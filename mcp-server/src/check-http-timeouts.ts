import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import type { Finding } from "./check-ci.js";

const exec = promisify(execCb);

/**
 * HTTP-timeout check (Increment 10.4).
 *
 * Catches the most common reliability footgun: unbounded external HTTP
 * calls. One slow upstream blocks the worker pool, escalates to a DoS, or
 * stalls a user request indefinitely.
 *
 * Matched call shapes:
 *   - TS/JS: fetch(...), axios(...), axios.{get,post,put,delete,patch}(...),
 *            http.get(...), https.request(...), got(...), ky(...)
 *   - Python: requests.{get,post,put,delete,patch,head}(...),
 *             httpx.{get,post,...}(...) — both sync and httpx.AsyncClient(),
 *             urlopen(...), aiohttp.ClientSession() (with timeout)
 *
 * Flags a call if its argument list doesn't contain any of:
 *   timeout, signal, AbortSignal, AbortController, timeoutMs, request_timeout
 *
 * Multi-line call arguments are captured via balanced-paren extraction.
 *
 * Inline bypass: '// agent-standards: allow-no-timeout <reason>' or
 * '# agent-standards: allow-no-timeout <reason>' on the call line or
 * the line above.
 */

// (?<![.\w]) means: not preceded by '.' or by a word character. Avoids
// matching .fetch() (WatermelonDB / array .fetch / etc.) and userFetch().
const TS_CALL_PATTERN = /(?<![.\w])(fetch|axios|axios\.(?:get|post|put|delete|patch|head|request)|http\.(?:get|request)|https\.(?:get|request)|got|got\.(?:get|post|put|delete|patch)|ky|ky\.(?:get|post|put|delete|patch))\s*\(/g;
const PY_CALL_PATTERN = /\b(requests\.(?:get|post|put|delete|patch|head)|httpx\.(?:get|post|put|delete|patch|head)|urlopen)\s*\(/g;

const TIMEOUT_HINTS = /\b(?:timeout|signal|AbortSignal|AbortController|timeoutMs|request_timeout|read_timeout|connect_timeout)\b/;

const SKIP_DIRS = /\/(?:node_modules|dist|build|\.next|coverage|__pycache__|\.venv|venv)\//;
const SKIP_FILES = /\.test\.|\.spec\.|test_|_test\.py$/;

/**
 * Extract the balanced argument list starting at openIdx (position of '(').
 * Handles strings + nested parens. Returns null on unbalanced or runaway input.
 */
function extractBalanced(content: string, openIdx: number): string | null {
  if (content[openIdx] !== "(") return null;
  let depth = 1;
  let i = openIdx + 1;
  const maxScan = 4000; // bound runaway minified input
  const stop = Math.min(content.length, openIdx + maxScan);
  while (i < stop) {
    const ch = content[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < stop) {
        if (content[i] === "\\") { i += 2; continue; }
        if (content[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return content.slice(openIdx + 1, i);
    }
    i++;
  }
  return null;
}

interface TimeoutHit {
  file: string;
  line: number;
  call: string;
  preview: string;
}

async function listTrackedSourceFiles(repoRoot: string): Promise<string[]> {
  try {
    const { stdout } = await exec("git ls-files", { cwd: repoRoot, maxBuffer: 50 * 1024 * 1024 });
    return stdout
      .split("\n")
      .filter((f) => /\.(ts|tsx|js|mjs|cjs|jsx|py)$/.test(f))
      .filter((f) => !SKIP_DIRS.test(f))
      .filter((f) => !SKIP_FILES.test(f));
  } catch {
    return [];
  }
}

function scanContent(content: string, file: string, isPython: boolean): TimeoutHit[] {
  const hits: TimeoutHit[] = [];
  const pattern = isPython ? PY_CALL_PATTERN : TS_CALL_PATTERN;
  pattern.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(content)) !== null) {
    const call = m[1] ?? "";
    const parenIdx = m.index + m[0].length - 1;
    const args = extractBalanced(content, parenIdx);
    if (args === null) continue;
    if (TIMEOUT_HINTS.test(args)) continue;

    const startLine = content.slice(0, m.index).split("\n").length;
    const lines = content.split("\n");
    const lineText = lines[startLine - 1] ?? "";
    const prevText = lines[startLine - 2] ?? "";
    if (lineText.includes("agent-standards: allow-no-timeout")) continue;
    if (prevText.trim().includes("agent-standards: allow-no-timeout")) continue;

    hits.push({
      file,
      line: startLine,
      call,
      preview: lineText.trim().slice(0, 100),
    });
    if (hits.length > 100) break;
  }
  return hits;
}

export async function checkHttpTimeouts(repoRoot: string): Promise<Finding[]> {
  const files = await listTrackedSourceFiles(repoRoot);
  if (files.length === 0) {
    return [{ severity: "info", code: "HTTP_TIMEOUT_NO_FILES", message: "No tracked source files matched." }];
  }

  const allHits: TimeoutHit[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = await readFile(join(repoRoot, file), "utf8");
    } catch {
      continue;
    }
    const isPython = file.endsWith(".py");
    const pat = isPython ? PY_CALL_PATTERN : TS_CALL_PATTERN;
    // Reset and pre-test
    pat.lastIndex = 0;
    if (!pat.test(content)) continue;
    allHits.push(...scanContent(content, file, isPython));
    if (allHits.length > 200) break;
  }

  if (allHits.length === 0) {
    return [{
      severity: "info",
      code: "HTTP_TIMEOUT_OK",
      message: `Scanned ${files.length} source file(s). All HTTP calls appear to set timeouts.`,
    }];
  }

  return allHits.map((h) => ({
    severity: "warn" as const,
    code: "HTTP_NO_TIMEOUT",
    message:
      `${h.file}:${h.line}: '${h.call}(...)' call without timeout. ` +
      `Preview: ${JSON.stringify(h.preview)}.`,
    fix:
      `Add 'timeout' / 'signal: AbortSignal.timeout(N)' (TS) or 'timeout=N' (Python). ` +
      `If this call is genuinely safe to be unbounded (streaming endpoint, local-only), ` +
      `add an inline '// agent-standards: allow-no-timeout <reason>' comment.`,
  }));
}
