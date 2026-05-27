import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import type { Finding } from "./check-ci.js";
import type { AgentStandards } from "./standards.js";

const exec = promisify(execCb);

/**
 * View / component file-size check (Beyond-W15 cash-up).
 *
 * Mobile/web only (no-op for service/library projects). Flags view or
 * component files exceeding the configured line limit (default 200). A
 * view over 200 lines is a smell — the rule comes from org-defaults's
 * style_ui invariant.
 *
 * File detection: heuristic globs that catch components/screens/pages
 * across React, Vue, Svelte, Flutter, SwiftUI. Project override via
 * architecture.view_size_paths.
 *
 * Configurable limit via architecture.view_size_limit_lines (default 200).
 */

const DEFAULT_LIMIT = 200;

const DEFAULT_VIEW_GLOBS = [
  // React / Next.js / generic
  "**/components/**/*.tsx",
  "**/components/**/*.jsx",
  "**/pages/**/*.tsx",
  "**/app/**/*.tsx",
  "**/views/**/*.tsx",
  "**/screens/**/*.tsx",
  // React Native + Expo
  "apps/mobile/**/*.tsx",
  // Vue
  "**/components/**/*.vue",
  "**/views/**/*.vue",
  // Svelte
  "**/*.svelte",
  // Flutter
  "**/lib/**/screens/**/*.dart",
  "**/lib/**/pages/**/*.dart",
  "**/lib/**/widgets/**/*.dart",
  // SwiftUI
  "**/*View.swift",
  "**/Views/**/*.swift",
  "**/Screens/**/*.swift",
];

const SKIP_DIRS = /\/(?:node_modules|dist|build|\.next|coverage|\.dart_tool|Pods|DerivedData|generated)\//;
const SKIP_GENERATED = /\.(?:g|freezed|gr|config)\.dart$/;

async function listTrackedFiles(repoRoot: string): Promise<string[]> {
  try {
    const { stdout } = await exec("git ls-files", { cwd: repoRoot, maxBuffer: 50 * 1024 * 1024 });
    return stdout.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export async function checkViewSize(
  repoRoot: string,
  standards: AgentStandards
): Promise<Finding[]> {
  const kind = standards.ci?.kind;
  if (kind !== "mobile" && kind !== "web") {
    return [{
      severity: "info",
      code: "VIEW_SIZE_NOT_UI",
      message: `ci.kind='${kind ?? "<unset>"}' — view-size check applies only to mobile/web projects.`,
    }];
  }

  const arch = standards.architecture as
    | { view_size_paths?: string[]; view_size_limit_lines?: number }
    | undefined;
  const globs = arch?.view_size_paths ?? DEFAULT_VIEW_GLOBS;
  const limit = arch?.view_size_limit_lines ?? DEFAULT_LIMIT;

  const allFiles = await listTrackedFiles(repoRoot);
  const { minimatch } = await import("minimatch");
  const candidates = allFiles.filter((f) => {
    if (SKIP_DIRS.test(f)) return false;
    if (SKIP_GENERATED.test(f)) return false;
    if (/\.test\.|\.spec\.|test_|_test\.[a-z]+$/.test(f)) return false;
    return globs.some((g) => minimatch(f, g));
  });

  if (candidates.length === 0) {
    return [{
      severity: "info",
      code: "VIEW_SIZE_NO_FILES",
      message: `No view/component files matched globs. Override via architecture.view_size_paths if needed.`,
    }];
  }

  const findings: Finding[] = [];
  for (const file of candidates) {
    let content: string;
    try {
      content = await readFile(join(repoRoot, file), "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n").length;
    if (lines > limit) {
      findings.push({
        severity: "warn",
        code: "VIEW_SIZE_EXCEEDED",
        message:
          `${file}: ${lines} lines exceeds limit of ${limit}. ` +
          `A view file > ${limit} lines is a smell — extract subviews or move logic to hooks/services.`,
        fix:
          "Identify cohesive sections of the view and extract them to sibling components. The shared component library is the home for cross-feature primitives.",
      });
    }
  }

  if (findings.length === 0) {
    return [{
      severity: "info",
      code: "VIEW_SIZE_OK",
      message: `Scanned ${candidates.length} view/component file(s). All within ${limit} lines.`,
    }];
  }

  return findings;
}
