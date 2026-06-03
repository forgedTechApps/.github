import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Finding } from "./check-ci.js";
import type { AgentStandards, FrameworkEol } from "./standards.js";

/**
 * Runtime / SDK end-of-support check.
 *
 * Reads the version a project DECLARES for each runtime it uses, and compares
 * it against an end-of-support (EOL) table maintained in org-defaults
 * (architecture-free: `framework_support.frameworks`). Flags:
 *   - past EOL  → error (running an unsupported runtime)
 *   - within `warn_within_months` of EOL → warn (plan the upgrade)
 *   - supported → info OK
 *
 * Binary + offline + deterministic: version strings are read mechanically,
 * EOL dates are facts maintained in the standards file (not fetched). No AST,
 * no network. `today` is injectable for tests.
 *
 * Version sources per framework `id`:
 *   - dotnet:  global.json `sdk.version`, else *.csproj <TargetFramework>net8.0</…>
 *   - flutter: pubspec.yaml `environment: { flutter: ">=3.x" }`
 *   - dart:    pubspec.yaml `environment: { sdk: ">=3.x" }`
 *   - node:    .nvmrc, else package.json `engines.node`
 *   - swift:   Package.swift `swift-tools-version:5.x`
 *   - python:  .python-version, else pyproject `requires-python`
 *
 * The declared version is normalised to a major or major.minor key and looked
 * up in that framework's `eol` map. If the project doesn't use a framework
 * (no version file) it's silently skipped — no false positive.
 */

async function readMaybe(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/** First capture group of the first matching pattern, or null. */
function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Normalise a raw version string to "major" or "major.minor" (digits only). */
function normalise(raw: string): string | null {
  const m = raw.match(/(\d+)(?:\.(\d+))?/);
  if (!m?.[1]) return null;
  return m[2] !== undefined ? `${m[1]}.${m[2]}` : m[1];
}

/** Read the declared version for one framework id from the repo, or null. */
async function declaredVersion(repoRoot: string, id: FrameworkEol["id"]): Promise<string | null> {
  const read = (p: string) => readMaybe(join(repoRoot, p));
  switch (id) {
    case "dotnet": {
      const gj = await read("global.json");
      if (gj) {
        const v = firstMatch(gj, [/"version"\s*:\s*"(\d+\.\d+)/]);
        if (v) return v;
      }
      // Fall back to a TargetFramework in any csproj at the root level.
      for (const f of ["Directory.Build.props", "global.csproj"]) {
        const c = await read(f);
        if (c) {
          const v = firstMatch(c, [/<TargetFramework>\s*net(\d+\.\d+)/i]);
          if (v) return v;
        }
      }
      return null;
    }
    case "flutter": {
      const p = await read("pubspec.yaml");
      return p ? firstMatch(p, [/flutter:\s*["']?[>=^ ]*(\d+\.\d+)/]) : null;
    }
    case "dart": {
      const p = await read("pubspec.yaml");
      return p ? firstMatch(p, [/sdk:\s*["']?[>=^ ]*(\d+\.\d+)/]) : null;
    }
    case "node": {
      const nvmrc = await read(".nvmrc");
      if (nvmrc?.trim()) return normalise(nvmrc.trim());
      const pkg = await read("package.json");
      return pkg ? firstMatch(pkg, [/"node"\s*:\s*"[>=^~ ]*(\d+)/]) : null;
    }
    case "swift": {
      const p = await read("Package.swift");
      return p ? firstMatch(p, [/swift-tools-version:\s*(\d+\.\d+)/]) : null;
    }
    case "python": {
      const pv = await read(".python-version");
      if (pv?.trim()) return normalise(pv.trim());
      const pp = await read("pyproject.toml");
      return pp ? firstMatch(pp, [/requires-python\s*=\s*["'][>=^~ ]*(\d+\.\d+)/]) : null;
    }
  }
}

/** Look up the EOL date for a declared version, trying major.minor then major. */
function eolFor(version: string, table: Record<string, string>): string | undefined {
  if (table[version]) return table[version];
  const major = version.split(".")[0] ?? version;
  return table[major];
}

export async function checkFrameworkSupport(
  repoRoot: string,
  standards: AgentStandards,
  today: Date = new Date(),
): Promise<Finding[]> {
  const cfg = standards.framework_support;
  if (!cfg?.frameworks?.length) {
    return [{
      severity: "info",
      code: "FRAMEWORK_SUPPORT_NOT_CONFIGURED",
      message: "framework_support not configured (no EOL table) — runtime end-of-support isn't checked for this project.",
    }];
  }

  const warnMonths = cfg.warn_within_months ?? 6;
  const findings: Finding[] = [];
  let checkedAny = false;

  for (const fw of cfg.frameworks) {
    const version = await declaredVersion(repoRoot, fw.id);
    if (version === null) continue; // framework not used here — skip, no false positive
    checkedAny = true;

    const eolStr = eolFor(version, fw.eol);
    if (!eolStr) {
      findings.push({
        severity: "info",
        code: "FRAMEWORK_VERSION_UNKNOWN_EOL",
        message: `${fw.id} ${version} is declared but has no entry in the framework_support EOL table — add it so support can be tracked.`,
      });
      continue;
    }

    const eol = new Date(`${eolStr}T00:00:00Z`);
    const msUntil = eol.getTime() - today.getTime();
    const daysUntil = Math.floor(msUntil / 86_400_000);
    const warnWindowDays = warnMonths * 30;

    if (daysUntil < 0) {
      findings.push({
        severity: "error",
        code: "FRAMEWORK_PAST_EOL",
        message: `${fw.id} ${version} reached end-of-support on ${eolStr} (${-daysUntil} days ago) — running an unsupported runtime. Upgrade.`,
        fix: `Upgrade ${fw.id} to a supported version (see the framework_support table in org-defaults).`,
      });
    } else if (daysUntil <= warnWindowDays) {
      findings.push({
        severity: "warn",
        code: "FRAMEWORK_NEAR_EOL",
        message: `${fw.id} ${version} reaches end-of-support on ${eolStr} (in ${daysUntil} days) — plan the upgrade.`,
        fix: `Schedule a ${fw.id} upgrade before ${eolStr}.`,
      });
    }
  }

  if (findings.length === 0) {
    findings.push({
      severity: "info",
      code: checkedAny ? "FRAMEWORK_SUPPORT_OK" : "FRAMEWORK_SUPPORT_NO_VERSION_FILES",
      message: checkedAny
        ? "All declared runtimes are within support."
        : "framework_support is configured but no matching version files were found — nothing to check in this repo.",
    });
  }

  return findings;
}
