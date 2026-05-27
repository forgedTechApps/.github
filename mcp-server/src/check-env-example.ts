import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import type { Finding } from "./check-ci.js";

const exec = promisify(execCb);

/**
 * .env.example presence + completeness check (Beyond-W15 cash-up).
 *
 * Two assertions:
 *   1. A .env.example (or .env.sample / .env.template) file exists.
 *   2. Every env var referenced from source code has an entry in the file.
 *
 * Env-var reference patterns (TS/JS + Python):
 *   - process.env.FOO_BAR
 *   - process.env["FOO_BAR"]
 *   - import.meta.env.FOO_BAR (Vite)
 *   - os.environ["FOO_BAR"], os.environ.get("FOO_BAR")
 *   - os.getenv("FOO_BAR")
 *
 * Built-in / framework-provided names (NODE_ENV, PATH, HOME, etc.) and
 * names starting with NEXT_PUBLIC_ or VITE_ are exempt — they're either
 * always-present or documented elsewhere.
 *
 * Conservative: only flags missing entries, not extras. The check is a
 * presence test, not a strict diff.
 */

const ENV_FILE_CANDIDATES = [".env.example", ".env.sample", ".env.template"];

const SKIP_DIRS = /\/(?:node_modules|dist|build|\.next|coverage|__pycache__|\.venv|venv)\//;
const SKIP_FILES = /\.test\.|\.spec\.|test_|_test\.py$/;

/** Built-in env vars that don't need to be in .env.example. */
const BUILT_INS = new Set([
  "NODE_ENV", "PATH", "HOME", "USER", "PWD", "SHELL",
  "PORT", "HOSTNAME",
  "CI", "GITHUB_ACTIONS", "GITHUB_TOKEN", "GITHUB_REPOSITORY", "GITHUB_SHA",
  "RAILWAY_ENVIRONMENT", "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID",
  "VERCEL", "VERCEL_ENV", "VERCEL_URL",
  "TERM", "LANG", "LC_ALL",
  "TZ",
]);

/** Prefixes that signal client-bundle-safe names; not required in .env.example. */
const PUBLIC_PREFIXES = ["NEXT_PUBLIC_", "VITE_", "EXPO_PUBLIC_", "PUBLIC_", "REACT_APP_"];

/** Patterns that match a reference to a single env var. Captures the var name. */
const ENV_REFS: RegExp[] = [
  /\bprocess\.env\.([A-Z][A-Z0-9_]*)\b/g,
  /\bprocess\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g,
  /\bimport\.meta\.env\.([A-Z][A-Z0-9_]*)\b/g,
  /\bos\.environ\[['"]([A-Z][A-Z0-9_]*)['"]\]/g,
  /\bos\.environ\.get\(['"]([A-Z][A-Z0-9_]*)['"]/g,
  /\bos\.getenv\(['"]([A-Z][A-Z0-9_]*)['"]/g,
];

async function findEnvExampleFile(repoRoot: string): Promise<string | null> {
  for (const candidate of ENV_FILE_CANDIDATES) {
    try {
      await access(join(repoRoot, candidate));
      return candidate;
    } catch {
      // not present, try next
    }
  }
  return null;
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

function parseExampleKeys(content: string): Set<string> {
  const keys = new Set<string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([A-Z][A-Z0-9_]*)\s*=/);
    if (m && m[1]) keys.add(m[1]);
  }
  return keys;
}

function shouldExclude(name: string): boolean {
  if (BUILT_INS.has(name)) return true;
  for (const prefix of PUBLIC_PREFIXES) {
    if (name.startsWith(prefix)) return true;
  }
  return false;
}

export async function checkEnvExample(repoRoot: string): Promise<Finding[]> {
  const found = await findEnvExampleFile(repoRoot);
  const files = await listTrackedSourceFiles(repoRoot);

  // Collect referenced env vars
  const referenced = new Set<string>();
  for (const file of files) {
    let content: string;
    try {
      content = await readFile(join(repoRoot, file), "utf8");
    } catch {
      continue;
    }
    for (const pat of ENV_REFS) {
      pat.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pat.exec(content)) !== null) {
        const name = m[1];
        if (name && !shouldExclude(name)) referenced.add(name);
      }
    }
  }

  // No env vars referenced — nothing to enforce
  if (referenced.size === 0) {
    return [{
      severity: "info",
      code: "ENV_EXAMPLE_NO_REFS",
      message: "No env-var references found in tracked source. Check is a no-op for this project.",
    }];
  }

  // Env vars referenced but no example file → block
  if (!found) {
    return [{
      severity: "error",
      code: "ENV_EXAMPLE_MISSING",
      message:
        `${referenced.size} env-var reference(s) in source but no .env.example / .env.sample / .env.template file. ` +
        `Examples referenced: ${[...referenced].slice(0, 5).join(", ")}${referenced.size > 5 ? ", ..." : ""}.`,
      fix:
        "Create .env.example at the repo root with an entry per required env var. Document a default or sample value.",
    }];
  }

  // Compare
  let exampleContent: string;
  try {
    exampleContent = await readFile(join(repoRoot, found), "utf8");
  } catch {
    return [{
      severity: "error",
      code: "ENV_EXAMPLE_UNREADABLE",
      message: `Found ${found} but could not read it.`,
    }];
  }
  const exampleKeys = parseExampleKeys(exampleContent);

  const missing: string[] = [];
  for (const name of referenced) {
    if (!exampleKeys.has(name)) missing.push(name);
  }
  missing.sort();

  if (missing.length === 0) {
    return [{
      severity: "info",
      code: "ENV_EXAMPLE_OK",
      message:
        `${found}: all ${referenced.size} env-var reference(s) have entries.`,
    }];
  }

  return [{
    severity: "error",
    code: "ENV_EXAMPLE_INCOMPLETE",
    message:
      `${found} is missing ${missing.length} env-var entry/entries referenced from source: ` +
      `${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ", ..." : ""}.`,
    fix:
      `Add each missing var to ${found} with a sample value: '${missing[0]}=<example-value>'.`,
  }];
}
