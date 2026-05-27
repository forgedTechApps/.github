import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import type { Finding } from "./check-ci.js";
import type { AgentStandards } from "./standards.js";

const exec = promisify(execCb);

/**
 * HTTP security headers + CORS check (Beyond-W15 cash-up).
 *
 * Two combined invariants:
 *   1. http_security_headers — HSTS, CSP, X-Content-Type-Options,
 *      X-Frame-Options (or frame-ancestors), Referrer-Policy
 *   2. cors_explicit_origins — no wildcard '*' for credentialed CORS
 *
 * Activated when ci.kind === 'service'. No-op otherwise.
 *
 * Approach: scan tracked source for header-setting patterns + CORS
 * configuration. Flag missing headers (one finding per missing header).
 * Flag CORS '*' + credentials true (the dangerous combo).
 *
 * Conservative: this is a presence check, not a value check. A project
 * with helmet() or fastify-helmet wired up will likely pass without an
 * exhaustive per-header scan because helmet sets them all.
 *
 * Bypass via architecture.http_security_skip: true (for non-HTTP services
 * that happen to have ci.kind=service, like worker-only deployments).
 */

const SKIP_DIRS = /\/(?:node_modules|dist|build|\.next|coverage|__pycache__|\.venv|venv)\//;
const SKIP_FILES = /\.test\.|\.spec\.|test_|_test\.py$/;

/** Patterns indicating one of the required headers is being set somewhere. */
const HEADER_SIGNALS: Record<string, RegExp> = {
  HSTS: /\b(?:Strict-Transport-Security|hsts|HSTS)\b/i,
  CSP: /\b(?:Content-Security-Policy|contentSecurityPolicy|content_security_policy)\b/i,
  "X-Content-Type-Options": /\b(?:X-Content-Type-Options|noSniff|nosniff)\b/i,
  "X-Frame-Options / frame-ancestors": /\b(?:X-Frame-Options|frameguard|frame-ancestors|frameAncestors)\b/i,
  "Referrer-Policy": /\b(?:Referrer-Policy|referrerPolicy|referrer_policy)\b/i,
};

/** Frameworks/libraries that set all required headers by default. Presence of these is sufficient. */
const HEADERS_LIBRARIES = [
  /\b(?:helmet|fastify-helmet|@fastify\/helmet|secure-headers|securityheaders|django\.middleware\.security)\b/,
];

/** Dangerous CORS pattern: origin: '*' (any quote) AND credentials: true nearby. */
const CORS_WILDCARD = /(?:origin|allowedOrigins?|CORS_ORIGINS?|allow_origins?)\s*[:=]\s*['"]\*['"]/i;
const CORS_CREDENTIALS_TRUE = /\b(?:credentials|allowCredentials|allow_credentials)\s*[:=]\s*[Tt]rue\b/;

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

export async function checkHttpSecurity(
  repoRoot: string,
  standards: AgentStandards
): Promise<Finding[]> {
  const kind = standards.ci?.kind;
  if (kind !== "service") {
    return [{
      severity: "info",
      code: "HTTP_SEC_NOT_SERVICE",
      message: `ci.kind='${kind ?? "<unset>"}' — HTTP security check applies only to ci.kind='service'.`,
    }];
  }

  const arch = standards.architecture as { http_security_skip?: boolean } | undefined;
  if (arch?.http_security_skip === true) {
    return [{
      severity: "info",
      code: "HTTP_SEC_SKIPPED",
      message: "architecture.http_security_skip is true — check skipped (worker-only deployment etc.).",
    }];
  }

  const files = await listTrackedSourceFiles(repoRoot);
  if (files.length === 0) {
    return [{ severity: "info", code: "HTTP_SEC_NO_FILES", message: "No source files matched." }];
  }

  // Concatenate all source for a global presence check. The headers can be
  // set anywhere — usually a middleware file — so we only need to know
  // whether they appear at all across the codebase.
  let concatenated = "";
  for (const file of files) {
    try {
      concatenated += "\n" + (await readFile(join(repoRoot, file), "utf8"));
    } catch { /* skip */ }
    if (concatenated.length > 8 * 1024 * 1024) break; // 8MB safety bound
  }

  const findings: Finding[] = [];

  // Headers check — if a known library is in use, skip the individual checks
  const usesLibrary = HEADERS_LIBRARIES.some((pat) => pat.test(concatenated));
  if (!usesLibrary) {
    const missingHeaders: string[] = [];
    for (const [name, pat] of Object.entries(HEADER_SIGNALS)) {
      if (!pat.test(concatenated)) missingHeaders.push(name);
    }
    if (missingHeaders.length > 0) {
      findings.push({
        severity: "warn",
        code: "HTTP_SEC_MISSING_HEADERS",
        message:
          `Required security headers not detected anywhere in source: ${missingHeaders.join(", ")}. ` +
          `Either wire a headers library (helmet / fastify-helmet) or set them in middleware.`,
        fix:
          "Easiest fix: install + register helmet (Express) / @fastify/helmet (Fastify) / django.middleware.security.SecurityMiddleware (Django). " +
          "Alternative: a single middleware that sets HSTS, CSP, X-Content-Type-Options, X-Frame-Options (or frame-ancestors), Referrer-Policy.",
      });
    }
  }

  // CORS check — wildcard origin + credentials true is the dangerous combo.
  // Look per-file because the pair needs to co-occur in the same file.
  for (const file of files) {
    let content: string;
    try {
      content = await readFile(join(repoRoot, file), "utf8");
    } catch {
      continue;
    }
    if (!CORS_WILDCARD.test(content)) continue;
    if (!CORS_CREDENTIALS_TRUE.test(content)) continue;
    // Both present in the same file → dangerous combo
    findings.push({
      severity: "error",
      code: "HTTP_SEC_CORS_WILDCARD_WITH_CREDENTIALS",
      message:
        `${file}: CORS configured with wildcard origin ('*') AND credentials: true. ` +
        `This is rejected by browsers but indicates intent — never combine these.`,
      fix:
        "Replace the wildcard with an explicit allowlist of origins. If credentials aren't needed, set credentials: false.",
    });
  }

  if (findings.length === 0) {
    findings.push({
      severity: "info",
      code: "HTTP_SEC_OK",
      message:
        `Scanned ${files.length} file(s). ` +
        (usesLibrary
          ? "Headers library detected (helmet / fastify-helmet / etc.) — assumed to set required headers."
          : "All required headers detected. No dangerous CORS combos."),
    });
  }

  return findings;
}
