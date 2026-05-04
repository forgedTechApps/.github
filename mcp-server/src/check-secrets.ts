import { readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import type { Finding } from "./check-ci.js";

const exec = promisify(execCb);

/**
 * Patterns for likely-secret strings. Conservative: high-confidence patterns
 * only — false positives waste user trust. The right tool for deep scanning
 * is gitleaks/trufflehog in CI; this is a fast pre-commit gate.
 */
interface SecretRule {
  name: string;
  pattern: RegExp;
  /** Per-line entropy minimum (0–1) to reduce false positives on patterns
   *  with low-specificity prefixes. Optional. */
  minEntropy?: number;
}

const RULES: SecretRule[] = [
  // forgedTechApps-specific
  { name: "forge-pipe bearer token", pattern: /\bfp_[a-f0-9]{32,}\b/g },

  // Cloud / SaaS — high-confidence prefixes
  { name: "AWS access key id", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "AWS secret access key (heuristic)", pattern: /\baws_secret_access_key\s*[:=]\s*['\"]?[A-Za-z0-9/+=]{40}['\"]?/gi },
  { name: "GitHub token (classic)", pattern: /\bghp_[A-Za-z0-9]{36,}\b/g },
  { name: "GitHub fine-grained token", pattern: /\bgithub_pat_[A-Za-z0-9_]{82}\b/g },
  { name: "GitHub OAuth", pattern: /\b(gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g },
  { name: "Slack token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "Stripe live key", pattern: /\b(sk|rk|pk)_live_[A-Za-z0-9]{20,}\b/g },
  { name: "Stripe restricted key", pattern: /\brk_(live|test)_[A-Za-z0-9]{20,}\b/g },
  { name: "OpenAI API key", pattern: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: "Anthropic API key", pattern: /\bsk-ant-[a-z0-9-]{32,}\b/g },
  { name: "Supabase service role JWT (heuristic)", pattern: /\beyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{50,}\.[A-Za-z0-9_-]{20,}/g },
  { name: "Supabase secret key", pattern: /\bsb_secret_[A-Za-z0-9_-]{20,}\b/g },
  { name: "Cloudflare API token", pattern: /\b[A-Za-z0-9_-]{40}\.[A-Za-z0-9_-]{40}\b/g, minEntropy: 0.8 },
  { name: "Google API key", pattern: /\bAIza[A-Za-z0-9_-]{35}\b/g },
  { name: "Private key (PEM)", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  { name: "JWT in source (heuristic)", pattern: /["'`]eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}["'`]/g },
];

/** Files we never scan — would produce false positives or noise. */
const SKIP_PATHS: RegExp[] = [
  /(^|\/)\.git\//,
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)\.next\//,
  /(^|\/)coverage\//,
  /(^|\/)\.venv\//,
  /(^|\/)\.pnpm-store\//,
  /\.lock$/,
  /\.lockb$/,
  /\.png$|\.jpg$|\.jpeg$|\.gif$|\.webp$|\.ico$/,
  /\.pdf$|\.zip$|\.tar(\.gz|\.bz2|\.xz)?$/,
  /\.mp[34]$|\.mov$|\.wav$/,
  /\.xcassets\//,
];

/** Files we consider safe to contain example/placeholder credentials. */
const ALLOWLIST_PATHS: RegExp[] = [
  /(^|\/)\.env\.example$/,
  /(^|\/)\.env\.template$/,
  /(^|\/)README\.md$/i,
  /(^|\/)CHANGELOG\.md$/i,
  // Test fixtures may contain dummy tokens
  /(^|\/)tests?\/.*\b(fixture|mock|stub)\b/i,
  /(^|\/)__fixtures__\//,
];

/** Inline opt-out comment. Place `// agent-standards: allow-secret` on the
 *  same line or the line above to suppress a finding for one specific match. */
const ALLOW_LINE = /agent-standards:\s*allow-secret/;

function shouldSkipPath(path: string): boolean {
  return SKIP_PATHS.some((re) => re.test(path));
}

function isAllowlisted(path: string): boolean {
  return ALLOWLIST_PATHS.some((re) => re.test(path));
}

function isLineAllowed(line: string, prevLine: string | undefined): boolean {
  return ALLOW_LINE.test(line) || (prevLine !== undefined && ALLOW_LINE.test(prevLine));
}

/** Shannon entropy 0..1 normalised by length. Useful for filtering false
 *  positives on patterns that catch any 64-hex string. */
function entropy(s: string): number {
  if (!s) return 0;
  const counts: Record<string, number> = {};
  for (const c of s) counts[c] = (counts[c] ?? 0) + 1;
  let h = 0;
  const len = s.length;
  for (const k of Object.keys(counts)) {
    const p = counts[k]! / len;
    h -= p * Math.log2(p);
  }
  // log2(64) ≈ 6 — normalise against alphabet size we typically see
  return Math.min(h / 6, 1);
}

interface ScanFileResult {
  findings: Finding[];
}

async function scanFile(absPath: string, repoRoot: string): Promise<ScanFileResult> {
  const findings: Finding[] = [];
  const rel = relative(repoRoot, absPath);

  if (shouldSkipPath(rel)) return { findings };

  let content: string;
  try {
    const st = await stat(absPath);
    if (!st.isFile()) return { findings };
    if (st.size > 2 * 1024 * 1024) {
      // Skip files > 2MB — likely binary or generated
      return { findings };
    }
    content = await readFile(absPath, "utf8");
  } catch {
    return { findings };
  }

  const allowed = isAllowlisted(rel);
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const prev = i > 0 ? lines[i - 1] : undefined;
    if (isLineAllowed(line, prev)) continue;

    for (const rule of RULES) {
      // Reset regex state — `g` flag mutates lastIndex
      rule.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = rule.pattern.exec(line)) !== null) {
        if (rule.minEntropy !== undefined && entropy(match[0]) < rule.minEntropy) continue;
        const masked = match[0].length > 12
          ? match[0].slice(0, 6) + "…" + match[0].slice(-4)
          : "***";
        findings.push({
          severity: allowed ? "info" : "error",
          code: allowed ? "SECRET_IN_ALLOWLISTED" : "SECRET_DETECTED",
          message: `${rule.name} detected in ${rel}:${i + 1} (${masked})${allowed ? " — allowlisted path" : ""}`,
          fix:
            allowed
              ? "If this is a real secret in a doc/example file, replace with a placeholder."
              : "Remove the secret. Move to environment variables / secret store. Use ${VAR} interpolation in committed config. Rotate the leaked credential.",
        });
      }
    }
  }

  return { findings };
}

async function listFiles(repoRoot: string, target?: "staged" | "tracked" | "all"): Promise<string[]> {
  const mode = target ?? "tracked";
  try {
    if (mode === "staged") {
      const { stdout } = await exec(
        "git diff --cached --name-only --diff-filter=ACMR -z",
        { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 }
      );
      return stdout.split("\0").filter(Boolean).map((p) => join(repoRoot, p));
    }
    if (mode === "tracked") {
      const { stdout } = await exec("git ls-files -z", {
        cwd: repoRoot,
        maxBuffer: 64 * 1024 * 1024,
      });
      return stdout.split("\0").filter(Boolean).map((p) => join(repoRoot, p));
    }
  } catch {
    // Fall through to filesystem walk if not a git repo
  }

  // `all` (or git unavailable): shell-out to find. We avoid implementing a
  // bespoke walker — git ls-files is the right path 99% of the time.
  try {
    const { stdout } = await exec(
      `find . -type f -not -path '*/.git/*' -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/build/*' -print0`,
      { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 }
    );
    return stdout.split("\0").filter(Boolean).map((p) => join(repoRoot, p));
  } catch {
    return [];
  }
}

export async function checkSecrets(
  repoRoot: string,
  scope: "staged" | "tracked" | "all" = "staged"
): Promise<Finding[]> {
  const files = await listFiles(repoRoot, scope);
  const findings: Finding[] = [];

  // Cap file count — protect against accidental walks of huge trees
  const MAX_FILES = 5000;
  if (files.length > MAX_FILES) {
    findings.push({
      severity: "warn",
      code: "SECRETS_SCAN_TRUNCATED",
      message: `${files.length} files matched; scanning first ${MAX_FILES}. Tighten the scope (use 'staged') or add to SKIP_PATHS.`,
    });
  }

  for (const f of files.slice(0, MAX_FILES)) {
    const r = await scanFile(f, repoRoot);
    findings.push(...r.findings);
  }

  if (findings.length === 0) {
    findings.push({
      severity: "info",
      code: "SECRETS_OK",
      message: `No likely secrets found in ${scope} files.`,
    });
  }

  return findings;
}
