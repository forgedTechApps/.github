import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import type { Finding } from "./check-ci.js";
import type { AgentStandards } from "./standards.js";

const exec = promisify(execCb);

/**
 * Client-bundle secret leak check (Increment 10.1).
 *
 * Scans compiled client output for service-role keys, admin tokens, and
 * other secrets that should be server-only. Catches the most expensive
 * security mistake in a Supabase / Firebase / Stripe-shaped app: a secret
 * key ending up in the JS bundle the browser downloads.
 *
 * Two complementary scans:
 *   1. Known-prefix scan: hunts for service-role key prefixes
 *      (sb_secret_, service_role, sk_live_, sk_test_, etc.) anywhere in
 *      the compiled output, regardless of .env.example. Catches the case
 *      where someone forgot to document the secret.
 *   2. Env-name scan: reads .env.example, identifies keys with
 *      service-role / admin shapes, and looks for THOSE NAMES as string
 *      literals in bundles. Bundlers like Next.js can inline env vars
 *      keyed by name; finding the name in a bundle suggests the value
 *      may have leaked via inline reference.
 *
 * Discovery of bundle output directories:
 *   - Defaults: apps/web/.next, apps/mobile/build, apps/mobile/web-build,
 *     dist, build, .next, .output, .svelte-kit.
 *   - Project override via architecture.client_bundle_paths in standards.
 *
 * Scope is narrow on purpose: false positives erode trust. The hook checks
 * a fixed list of prefixes and string-literal name references — not
 * everything that could possibly be a secret. Deeper scanning belongs in
 * gitleaks/trufflehog at CI time.
 */

interface SecretPrefix {
  name: string;
  /** Regex matched against text content in the bundle. */
  pattern: RegExp;
}

const KNOWN_PREFIXES: SecretPrefix[] = [
  // Supabase new key model
  { name: "Supabase secret key", pattern: /\bsb_secret_[A-Za-z0-9_-]{20,}\b/g },
  // Supabase legacy
  { name: "Supabase service_role JWT", pattern: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{20,}\b.*?"role"\s*:\s*"service_role"/gs },
  { name: "Supabase service_role literal", pattern: /\b['"]service_role['"]\s*[,:]/g },
  // Stripe
  { name: "Stripe secret key", pattern: /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/g },
  { name: "Stripe restricted key", pattern: /\brk_(?:live|test)_[A-Za-z0-9]{20,}\b/g },
  // OpenAI / Anthropic server keys
  { name: "OpenAI server key", pattern: /\bsk-[A-Za-z0-9_-]{40,}\b/g },
  { name: "Anthropic key", pattern: /\bsk-ant-[A-Za-z0-9_-]{40,}\b/g },
  // AWS
  { name: "AWS access key id", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  // GitHub PATs (should never be on the client)
  { name: "GitHub personal access token", pattern: /\bghp_[A-Za-z0-9]{36,}\b/g },
  { name: "GitHub fine-grained token", pattern: /\bgithub_pat_[A-Za-z0-9_]{82}\b/g },
  // Slack
  { name: "Slack bot token", pattern: /\bxoxb-[A-Za-z0-9-]{20,}\b/g },
  // forgedTechApps internal
  { name: "forge-pipe bearer", pattern: /\bfp_[a-f0-9]{32,}\b/g },
];

/** Env var name patterns that indicate a server-only secret. */
const SERVER_ONLY_NAME_PATTERNS: RegExp[] = [
  /SERVICE_ROLE/i,
  /^SECRET_/i,
  /_SECRET$/i,
  /SECRET_KEY$/i,
  /ADMIN_(?:KEY|TOKEN|SECRET)/i,
  /SERVER_(?:KEY|TOKEN|SECRET)/i,
  /\bPRIVATE_KEY\b/i,
  /\bDATABASE_URL\b/i,
  /^[A-Z_]*_(?:CLIENT_)?SECRET$/i,
];

const DEFAULT_BUNDLE_DIRS = [
  "apps/web/.next",
  "apps/mobile/build",
  "apps/mobile/web-build",
  "dist",
  "build",
  ".next",
  ".output",
  ".svelte-kit",
  "out",
];

interface BundleSecretFinding {
  file: string;
  pattern: string;
  /** Truncated match for the message; never include the whole secret. */
  preview: string;
}

async function dirExists(repoRoot: string, rel: string): Promise<boolean> {
  try {
    const { stdout } = await exec(`test -d ${JSON.stringify(join(repoRoot, rel))} && echo yes || echo no`);
    return stdout.trim() === "yes";
  } catch {
    return false;
  }
}

/** Walk bundle dirs and return .js / .mjs / .json / .html file paths under them. */
async function listBundleFiles(repoRoot: string, bundleDirs: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const dir of bundleDirs) {
    if (!(await dirExists(repoRoot, dir))) continue;
    try {
      // -type f with extension filter; cap at 5000 to bound runtime
      const { stdout } = await exec(
        `find ${JSON.stringify(join(repoRoot, dir))} -type f \\( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.json' -o -name '*.html' -o -name '*.css' \\) -not -path '*/node_modules/*' -size -2M | head -5000`,
        { maxBuffer: 50 * 1024 * 1024 }
      );
      for (const line of stdout.split("\n").filter(Boolean)) {
        files.push(relative(repoRoot, line));
      }
    } catch {
      // ignore — large bundle dirs or permission issues
    }
  }
  return files;
}

async function readEnvExampleServerKeys(repoRoot: string): Promise<string[]> {
  const candidates = [".env.example", ".env.sample", ".env.template"];
  for (const c of candidates) {
    try {
      const content = await readFile(join(repoRoot, c), "utf8");
      const names: string[] = [];
      for (const line of content.split("\n")) {
        const m = line.match(/^([A-Z][A-Z0-9_]*)\s*=/);
        if (!m || !m[1]) continue;
        const name = m[1];
        if (SERVER_ONLY_NAME_PATTERNS.some((p) => p.test(name))) {
          names.push(name);
        }
      }
      if (names.length > 0) return names;
    } catch {
      // try next candidate
    }
  }
  return [];
}

function scanContent(content: string, file: string): BundleSecretFinding[] {
  const findings: BundleSecretFinding[] = [];
  for (const rule of KNOWN_PREFIXES) {
    rule.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.pattern.exec(content)) !== null) {
      const matched = m[0];
      findings.push({
        file,
        pattern: rule.name,
        preview: matched.length > 12 ? `${matched.slice(0, 8)}...` : matched,
      });
      // Avoid runaway matches in a giant minified line
      if (findings.length > 20) break;
    }
    if (findings.length > 20) break;
  }
  return findings;
}

function scanContentForEnvNames(content: string, file: string, names: string[]): BundleSecretFinding[] {
  const findings: BundleSecretFinding[] = [];
  for (const name of names) {
    if (content.includes(name)) {
      findings.push({
        file,
        pattern: `env-var name reference: ${name}`,
        preview: name,
      });
    }
  }
  return findings;
}

export async function checkClientBundleSecrets(
  repoRoot: string,
  standards: AgentStandards
): Promise<Finding[]> {
  const findings: Finding[] = [];

  // Discover bundle dirs: project override > defaults
  const projectBundleDirs = (standards.architecture as { client_bundle_paths?: string[] } | undefined)?.client_bundle_paths;
  const bundleDirs = projectBundleDirs ?? DEFAULT_BUNDLE_DIRS;

  const files = await listBundleFiles(repoRoot, bundleDirs);
  if (files.length === 0) {
    return [{
      severity: "info",
      code: "BUNDLE_NONE",
      message:
        `No client bundle output found under ${bundleDirs.join(", ")}. ` +
        `If this project ships a client (web/mobile), build first then re-run.`,
    }];
  }

  const serverEnvNames = await readEnvExampleServerKeys(repoRoot);

  let scannedCount = 0;
  let bundleFindings: BundleSecretFinding[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = await readFile(join(repoRoot, file), "utf8");
    } catch {
      continue;
    }
    scannedCount++;
    const prefixHits = scanContent(content, file);
    bundleFindings.push(...prefixHits);
    if (serverEnvNames.length > 0) {
      const nameHits = scanContentForEnvNames(content, file, serverEnvNames);
      bundleFindings.push(...nameHits);
    }
    if (bundleFindings.length > 50) break; // safety bound
  }

  if (bundleFindings.length === 0) {
    findings.push({
      severity: "info",
      code: "BUNDLE_OK",
      message:
        `Scanned ${scannedCount} bundle file(s) under ${bundleDirs.join(", ")}. ` +
        `No known secret prefixes${serverEnvNames.length > 0 ? ` or server-only env names (${serverEnvNames.length})` : ""} found.`,
    });
    return findings;
  }

  for (const b of bundleFindings) {
    findings.push({
      severity: "error",
      code: "BUNDLE_SECRET_LEAK",
      message:
        `${b.file}: client bundle contains likely server-only secret (${b.pattern}). ` +
        `Preview: '${b.preview}'. Service-role keys, admin tokens, and similar must never ship to clients.`,
      fix:
        `Audit the import chain. Move the secret use to a server route / API handler. ` +
        `If this is a false positive (e.g. the env-var name appears in client code as a feature-flag string), ` +
        `add the file path to architecture.client_bundle_secret_allowlist (per-project override).`,
    });
  }

  return findings;
}
