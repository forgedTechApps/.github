import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import type { Finding } from "./check-ci.js";
import type { AgentStandards } from "./standards.js";

const exec = promisify(execCb);

/**
 * Linter-style checks for design-system consistency. Read-only; no
 * autofix. Designed for projects with `ci.kind: web` or `mobile`. Tries
 * to be useful even when no design tokens file is declared by detecting
 * common token-file conventions; gracefully no-ops on non-UI projects.
 */

const HEX_COLOR = /(?<![\w'-])#[0-9a-fA-F]{3,8}\b/g;

// Tailwind / shadcn-flavoured arbitrary values: bg-[#fff], rounded-[7px]
const TW_ARBITRARY = /\b(?:bg|text|border|ring|fill|stroke)-\[#[0-9a-fA-F]{3,8}\]/g;

// Bare px values in style attributes / SwiftUI / Flutter
const BARE_PX = /\b\d+(?:\.\d+)?\s*px\b/g;

// Tailwind preset spacing classes (all numeric — picks up any size, including off-scale)
// We don't lint these; we lint *arbitrary* values like p-[17px].
const TW_ARBITRARY_SIZE = /\b(?:p|m|gap|w|h|space-[xy]|inset|top|right|bottom|left)-\[\d+(?:\.\d+)?(?:px|rem|em)?\]/g;

// CSS custom-property declarations look like fine usage (--token: ...)
const CSS_VAR_DECL = /^\s*--[\w-]+\s*:/m;

// Inline styles in JSX/TSX
const INLINE_STYLE = /\bstyle=\{\{[^}]*\}\}/g;

// Common font-stack-y CSS strings
const FONT_FAMILY = /font-family\s*:\s*[^;}]+/gi;
const FONT_FAMILY_TS = /fontFamily\s*[:=]\s*['"][^'"]+['"]/g;

const ALLOWED_TOKEN_HEX = new Set<string>(); // populated from tokens file

/** Files we actually scan. */
const UI_FILE_RE = /\.(tsx|ts|jsx|js|css|scss|swift|dart|kt|kts|html|svelte|vue)$/;

/** Files that DEFINE tokens — these are allowed to contain raw colors / sizes. */
const TOKEN_FILE_RE = /(tokens|theme|design-system|design_tokens|colors|palette|spacing|typography)\.(ts|js|tsx|json|css|scss|swift|dart)$/i;

/** Files containing config (not UI) — skip. */
const SKIP_RE = [
  /(^|\/)\.git\//,
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)\.next\//,
  /(^|\/)coverage\//,
  /(^|\/)test/i,
  /\.test\.[a-z]+$/,
  /\.spec\.[a-z]+$/,
  /(^|\/)stories?\//,
  /\.stories\.[a-z]+$/,
  /\.config\.[a-z]+$/,
];

interface AggregatedStats {
  uniqueColors: Set<string>;
  uniqueFonts: Set<string>;
  uniqueOffScaleSizes: Set<string>;
  inlineStyleHits: number;
  filesScanned: number;
}

async function listFiles(repoRoot: string): Promise<string[]> {
  try {
    const { stdout } = await exec("git ls-files -z", {
      cwd: repoRoot,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout.split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

function shouldSkip(rel: string): boolean {
  return SKIP_RE.some((re) => re.test(rel));
}

function looksLikeTokenFile(rel: string): boolean {
  return TOKEN_FILE_RE.test(rel);
}

async function loadDesignTokens(repoRoot: string): Promise<{ allowedHex: Set<string>; tokenFiles: string[] }> {
  const all = await listFiles(repoRoot);
  const tokenFiles = all.filter(looksLikeTokenFile);
  const allowedHex = new Set<string>();
  for (const tf of tokenFiles) {
    try {
      const content = await readFile(join(repoRoot, tf), "utf8");
      content.replace(HEX_COLOR, (m) => {
        allowedHex.add(m.toLowerCase());
        return m;
      });
    } catch { /* skip */ }
  }
  return { allowedHex, tokenFiles };
}

export async function checkDesignConsistency(
  repoRoot: string,
  standards: AgentStandards
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const kind = standards.ci?.kind;

  if (kind !== "web" && kind !== "mobile") {
    findings.push({
      severity: "info",
      code: "DESIGN_NOT_APPLICABLE",
      message: `ci.kind=${kind ?? "unknown"} — design consistency checks only run on 'web' or 'mobile' projects.`,
    });
    return findings;
  }

  const all = await listFiles(repoRoot);
  if (all.length === 0) {
    findings.push({
      severity: "warn",
      code: "DESIGN_NOT_GIT_REPO",
      message: `${repoRoot} doesn't appear to be a git repo (or git ls-files returned nothing). Cannot enumerate UI files.`,
    });
    return findings;
  }

  const { allowedHex, tokenFiles } = await loadDesignTokens(repoRoot);
  if (tokenFiles.length === 0) {
    findings.push({
      severity: "warn",
      code: "DESIGN_NO_TOKENS_FILE",
      message: "No design tokens file detected. Looked for files matching tokens|theme|design-system|colors|palette|spacing|typography. Without a tokens file, raw hex/size values can't be distinguished from drift.",
      fix: "Create a packages/ui/tokens.ts (or design-system equivalent) defining colors, spacing scale, radii, typography ramp.",
    });
  }

  const stats: AggregatedStats = {
    uniqueColors: new Set(),
    uniqueFonts: new Set(),
    uniqueOffScaleSizes: new Set(),
    inlineStyleHits: 0,
    filesScanned: 0,
  };

  for (const rel of all) {
    if (shouldSkip(rel)) continue;
    if (!UI_FILE_RE.test(rel)) continue;
    if (looksLikeTokenFile(rel)) continue; // tokens file is the source of truth

    let content: string;
    try {
      content = await readFile(join(repoRoot, rel), "utf8");
    } catch { continue; }

    stats.filesScanned += 1;

    // 1. Hex colors not in tokens
    const hexMatches = content.match(HEX_COLOR);
    if (hexMatches) {
      for (const m of hexMatches) {
        const norm = m.toLowerCase();
        // 3-digit shorthand maps to 6-digit
        if (allowedHex.has(norm)) continue;
        stats.uniqueColors.add(norm);
        findings.push({
          severity: "warn",
          code: "DESIGN_HARDCODED_COLOR",
          message: `Hardcoded color ${m} in ${rel} not present in design tokens.`,
          fix: "Add to the tokens file with a semantic name, then reference the token.",
        });
      }
    }

    // 2. Tailwind arbitrary color values
    for (const m of content.match(TW_ARBITRARY) ?? []) {
      stats.uniqueColors.add(m.toLowerCase());
      findings.push({
        severity: "warn",
        code: "DESIGN_TAILWIND_ARBITRARY_COLOR",
        message: `Arbitrary color ${m} in ${rel}. Use a semantic class from the tokens.`,
      });
    }

    // 3. Tailwind arbitrary size values
    for (const m of content.match(TW_ARBITRARY_SIZE) ?? []) {
      stats.uniqueOffScaleSizes.add(m);
      findings.push({
        severity: "warn",
        code: "DESIGN_OFF_SCALE_SPACING",
        message: `Off-scale spacing ${m} in ${rel}. Use a class on the spacing scale.`,
      });
    }

    // 4. Inline styles in JSX (proxy for "bypassing the design system")
    const inlineHits = (content.match(INLINE_STYLE) ?? []).length;
    stats.inlineStyleHits += inlineHits;
    if (inlineHits > 0 && /\.(tsx|jsx)$/.test(rel)) {
      findings.push({
        severity: "info",
        code: "DESIGN_INLINE_STYLE",
        message: `${inlineHits} inline style attribute(s) in ${rel}. Inline styles bypass the design system — prefer semantic classes / styled components.`,
      });
    }

    // 5. Font-family declarations
    const fontMatches: string[] = [
      ...(content.match(FONT_FAMILY) ?? []),
      ...(content.match(FONT_FAMILY_TS) ?? []),
    ];
    for (const m of fontMatches) {
      // Pull the first quoted name as a proxy for the family
      const mm = m.match(/['"][^'"]+['"]/);
      if (mm) stats.uniqueFonts.add(mm[0].toLowerCase());
    }
  }

  // Aggregate findings — hard caps from the design rules
  if (stats.uniqueFonts.size > 2) {
    findings.push({
      severity: "warn",
      code: "DESIGN_FONT_CAP_EXCEEDED",
      message: `${stats.uniqueFonts.size} distinct font families detected (cap is 2). Found: ${[...stats.uniqueFonts].slice(0, 5).join(", ")}.`,
      fix: "Consolidate to 2 fonts. Earn a 3rd by documenting its semantic role (display vs. body vs. mono).",
    });
  }
  if (stats.uniqueColors.size > 3) {
    findings.push({
      severity: "warn",
      code: "DESIGN_COLOR_CAP_EXCEEDED",
      message: `${stats.uniqueColors.size} distinct off-token colors detected (informal cap is 3). Tokenise or remove.`,
    });
  }

  if (findings.length === 0 || (findings.length === 1 && findings[0]!.code === "DESIGN_NO_TOKENS_FILE")) {
    findings.push({
      severity: "info",
      code: "DESIGN_OK",
      message: `Scanned ${stats.filesScanned} UI files. No design-consistency violations.`,
    });
  }

  return findings;
}
