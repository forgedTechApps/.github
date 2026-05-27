import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import type { Finding } from "./check-ci.js";

const exec = promisify(execCb);

/**
 * Two invariants in one check (Increment 6):
 *   - no_commented_code: detect committed lines that look like commented-out code.
 *   - no_untracked_todos: detect TODO/FIXME/HACK without a tracking reference.
 *
 * Both ship as severity: warn during the cleanup-pass window. A follow-up PR
 * promotes them to error after each project's cleanup lands.
 *
 * Heuristics are conservative — false positives erode trust. When in doubt,
 * skip the line.
 */

interface LangSpec {
  /** Single-line comment markers. */
  lineComment: string[];
  /** File extensions this spec applies to. */
  exts: string[];
}

const LANGS: LangSpec[] = [
  { lineComment: ["//"], exts: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".swift", ".cs", ".dart", ".kt", ".java", ".go", ".rs", ".c", ".cpp", ".h", ".hpp"] },
  { lineComment: ["#"], exts: [".py", ".rb", ".sh", ".bash", ".zsh"] },
  { lineComment: ["--"], exts: [".sql"] },
  // Config formats (.yml, .yaml, .toml) commonly carry commented example settings
  // as documentation. Excluded from the commented-code heuristic to avoid noise.
];

const SKIP_EXTS = new Set([
  ".md", ".mdx", ".rst", ".txt",                    // docs
  ".json",                                           // no comments allowed → skip
  ".lock", ".min.js", ".map",                        // generated
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",  // binaries
  ".ttf", ".otf", ".woff", ".woff2",                 // fonts
  ".pdf", ".zip", ".tar", ".gz",                     // archives
  ".g.dart", ".freezed.dart",                        // generated (Flutter)
]);

/** Code-shaped: ends with one of these or contains `=` (assignment-ish). */
const CODE_SHAPE = /[;{}()\[\],]\s*$|(?:^|\s)=(?!=)/;

/** Common comment-directive prefixes that are NOT old code. */
const DIRECTIVE_PREFIXES = [
  "eslint-",
  "ts-ignore",
  "ts-expect-error",
  "ts-nocheck",
  "@ts-",
  "prettier-ignore",
  "biome-",
  "stylelint-",
  "swiftlint:",
  "noqa",
  "pylint:",
  "type:",
  "mypy:",
  "deno-",
  "tslint:",
  "agent-standards:",
];

function langFor(filePath: string): LangSpec | null {
  for (const lang of LANGS) {
    for (const ext of lang.exts) {
      if (filePath.endsWith(ext)) return lang;
    }
  }
  return null;
}

function shouldSkip(filePath: string): boolean {
  // Compound extensions first (".g.dart")
  for (const ext of SKIP_EXTS) {
    if (filePath.endsWith(ext)) return true;
  }
  const ext = extname(filePath);
  if (SKIP_EXTS.has(ext)) return true;
  // Heuristic: skip anything under generated/ or build/ even if extension matches.
  if (/\/(?:dist|build|out|generated|\.next|coverage|node_modules)\//.test(filePath)) return true;
  if (/^(?:dist|build|out|generated|\.next|coverage|node_modules)\//.test(filePath)) return true;
  return false;
}

/** Returns the comment body (text after the marker) if the line is a single-line comment, else null. */
function commentBody(line: string, markers: string[]): string | null {
  const trimmed = line.trimStart();
  for (const marker of markers) {
    if (trimmed.startsWith(marker)) {
      return trimmed.slice(marker.length).trimStart();
    }
  }
  return null;
}

function looksLikeOldCode(body: string): boolean {
  if (body.length === 0) return false;
  // Skip directives
  for (const d of DIRECTIVE_PREFIXES) {
    if (body.toLowerCase().startsWith(d)) return false;
  }
  // Skip URL-style comments
  if (/^https?:\/\//.test(body)) return false;
  // Skip section headers (long runs of dashes/equals)
  if (/^[-=─━*#]{3,}/.test(body)) return false;
  // Code shape
  return CODE_SHAPE.test(body);
}

interface CodeBlockFinding {
  file: string;
  startLine: number;
  endLine: number;
  preview: string;
}

/** Scans for clusters of ≥3 consecutive comment-lines that look like code. */
async function scanCommentedCode(repoRoot: string, files: string[]): Promise<CodeBlockFinding[]> {
  const findings: CodeBlockFinding[] = [];
  for (const rel of files) {
    if (shouldSkip(rel)) continue;
    const lang = langFor(rel);
    if (!lang) continue;

    let content: string;
    try {
      content = await readFile(join(repoRoot, rel), "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n");

    let runStart = -1;
    let runLines: string[] = [];
    const flush = (endIdx: number) => {
      if (runStart >= 0 && runLines.length >= 3) {
        findings.push({
          file: rel,
          startLine: runStart + 1,
          endLine: endIdx + 1,
          preview: runLines.slice(0, 3).join("\n"),
        });
      }
      runStart = -1;
      runLines = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      const body = commentBody(line, lang.lineComment);
      if (body !== null && looksLikeOldCode(body)) {
        if (runStart < 0) runStart = i;
        runLines.push(line);
      } else {
        flush(i - 1);
      }
    }
    flush(lines.length - 1);
  }
  return findings;
}

interface TodoFinding {
  file: string;
  line: number;
  marker: string;
  text: string;
}

/** Matches TODO|FIXME|HACK followed by a tracking reference. */
const TRACKED_PATTERN = /\b(?:TODO|FIXME|HACK)\s*[:(]?\s*(?:#\d+|[A-Z]{2,}-\d+|https?:\/\/)/;
const TODO_PATTERN = /\b(TODO|FIXME|HACK)\b/g;

async function scanTodos(repoRoot: string, files: string[]): Promise<TodoFinding[]> {
  const findings: TodoFinding[] = [];
  for (const rel of files) {
    if (shouldSkip(rel)) continue;
    // TODOs in docs are allowed (they're checklist items)
    if (/\.(md|mdx|rst)$/.test(rel)) continue;

    let content: string;
    try {
      content = await readFile(join(repoRoot, rel), "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      // Reset regex state
      TODO_PATTERN.lastIndex = 0;
      const match = TODO_PATTERN.exec(line);
      if (!match || match[1] === undefined) continue;
      if (TRACKED_PATTERN.test(line)) continue;
      // Skip if the TODO appears inside what looks like a string literal context —
      // crude: line contains the TODO inside backticks or quotes. False-negative
      // friendly; keeps trust high.
      const beforeMatch = line.slice(0, match.index);
      const quoteBefore = (beforeMatch.match(/["'`]/g) ?? []).length;
      if (quoteBefore % 2 === 1) continue;
      findings.push({
        file: rel,
        line: i + 1,
        marker: match[1],
        text: line.trim().slice(0, 120),
      });
    }
  }
  return findings;
}

async function listTrackedFiles(repoRoot: string): Promise<string[]> {
  try {
    const { stdout } = await exec("git ls-files", { cwd: repoRoot, maxBuffer: 50 * 1024 * 1024 });
    return stdout.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export type HygienseSeverity = "warn" | "error";

export interface CodebaseHygieneOptions {
  /** Defaults to 'warn' during the cleanup-pass window. */
  severity?: HygienseSeverity;
}

export async function checkCodebaseHygiene(
  repoRoot: string,
  opts: CodebaseHygieneOptions = {}
): Promise<Finding[]> {
  const severity = opts.severity ?? "warn";
  const files = await listTrackedFiles(repoRoot);
  if (files.length === 0) {
    return [{
      severity: "info",
      code: "HYGIENE_NO_FILES",
      message: "git ls-files returned no tracked files — is this a git repo?",
    }];
  }

  const findings: Finding[] = [];
  const commentedBlocks = await scanCommentedCode(repoRoot, files);
  for (const b of commentedBlocks) {
    findings.push({
      severity,
      code: "NO_COMMENTED_CODE",
      message: `${b.file}:${b.startLine}-${b.endLine}: ≥3 consecutive comment lines that look like code. Delete it — git history is the archive.`,
      fix: `Inspect ${b.file} lines ${b.startLine}-${b.endLine}. If you need the old version, it's in git log; if not, delete.`,
    });
  }

  const todos = await scanTodos(repoRoot, files);
  for (const t of todos) {
    findings.push({
      severity,
      code: "NO_UNTRACKED_TODOS",
      message: `${t.file}:${t.line}: ${t.marker} without tracking reference. Add (#issue), (TICKET-N), or (URL).`,
      fix: `Replace '${t.marker}' with '${t.marker}(#<issue>)' linking the tracking issue, or remove if obsolete.`,
    });
  }

  if (findings.length === 0) {
    findings.push({
      severity: "info",
      code: "HYGIENE_OK",
      message: `Scanned ${files.length} tracked files — no hygiene findings.`,
    });
  }

  return findings;
}
