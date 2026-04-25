#!/usr/bin/env node
/**
 * forgedtech project scaffolder.
 *
 * Bootstraps a project (new or existing) with:
 *   - .github/workflows/ci.yml (canonical, from generateCi)
 *   - .agent-standards.yml (template per kind)
 *   - .claude/settings.json (registers the agent-standards MCP)
 *
 * Usage:
 *   pnpm tsx scripts/init-project.ts \
 *     --target /Users/dev/Development/myproject \
 *     --repo  forgedTechApps/myproject \
 *     --language node \
 *     --kind   service \
 *     --name   myproject \
 *     [--unit-coverage 80] \
 *     [--integration-coverage 70] \
 *     [--swift-scheme MyScheme] \
 *     [--working-directory apps/api] \
 *     [--railway-service-name my-service] \
 *     [--deploy-target railway]
 */

import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { generateCi, type CiKind, type Language } from "../mcp-server/src/init-repo.js";

const execp = promisify(execCb);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const MCP_BIN = resolve(ROOT, "mcp-server/dist/index.js");
const TEMPLATES = resolve(ROOT, "mcp-server/templates/agent-standards");

interface Args {
  target: string;
  repo: string;
  language: Language;
  kind: CiKind;
  name: string;
  unitCoverage: number;
  integrationCoverage: number;
  swiftScheme?: string;
  workingDirectory?: string;
  railwayServiceName?: string;
  deployTarget?: string;
  force: boolean;
  skipCi: boolean;
  ensureBranches: boolean;
}

function parseArgs(argv: string[]): Args {
  const map = new Map<string, string>();
  let force = false;
  let skipCi = false;
  let ensureBranches = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") { force = true; continue; }
    if (a === "--skip-ci") { skipCi = true; continue; }
    if (a === "--ensure-branches") { ensureBranches = true; continue; }
    if (!a?.startsWith("--")) continue;
    const key = a.slice(2);
    const val = argv[++i];
    if (val === undefined) throw new Error(`${a} requires a value`);
    map.set(key, val);
  }

  const must = (k: string) => {
    const v = map.get(k);
    if (!v) throw new Error(`--${k} is required`);
    return v;
  };

  const language = must("language") as Language;
  if (!["swift", "flutter", "node", "python", "dotnet", "mixed"].includes(language)) {
    throw new Error(`--language must be one of swift|flutter|node|python|dotnet|mixed`);
  }
  const kind = must("kind") as CiKind;
  if (!["service", "library", "mobile", "web"].includes(kind)) {
    throw new Error(`--kind must be one of service|library|mobile|web`);
  }

  return {
    target: resolve(must("target")),
    repo: must("repo"),
    language,
    kind,
    name: must("name"),
    unitCoverage: parseInt(map.get("unit-coverage") ?? "80", 10),
    integrationCoverage: parseInt(map.get("integration-coverage") ?? "70", 10),
    swiftScheme: map.get("swift-scheme"),
    workingDirectory: map.get("working-directory"),
    railwayServiceName: map.get("railway-service-name") ?? map.get("name") ?? undefined,
    deployTarget: map.get("deploy-target"),
    force,
    skipCi,
    ensureBranches,
  };
}

async function ensureDevBranch(repoRoot: string): Promise<string> {
  // Best-effort: create a local 'dev' branch if missing. Push to origin if there is one.
  try {
    await execp(`git rev-parse --is-inside-work-tree`, { cwd: repoRoot });
  } catch {
    return "skipped (not a git repo)";
  }
  try {
    await execp(`git rev-parse --verify dev`, { cwd: repoRoot });
    return "already present locally";
  } catch {
    /* fall through to create */
  }
  try {
    await execp(`git branch dev`, { cwd: repoRoot });
  } catch (err) {
    return `failed to create dev: ${(err as Error).message.split("\n")[0]}`;
  }
  // Try to push if there's a remote.
  try {
    const { stdout } = await execp(`git remote`, { cwd: repoRoot });
    if (stdout.trim()) {
      try {
        await execp(`git push -u origin dev`, { cwd: repoRoot });
        return "created locally and pushed to origin";
      } catch (err) {
        return `created locally; push failed: ${(err as Error).message.split("\n")[0]}`;
      }
    }
  } catch {
    /* no remote */
  }
  return "created locally (no remote)";
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function writeIfAbsent(path: string, content: string, force: boolean): Promise<"written" | "skipped"> {
  if (!force && (await exists(path))) return "skipped";
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  return "written";
}

function stackDefaults(language: Language): Record<string, string> {
  switch (language) {
    case "swift":
      return { PACKAGE_MANAGER: "swiftpm", TEST_RUNNER: "xcodebuild test", LINT: "swiftlint", FORMAT: "swift-format", BUILD: "xcodebuild build" };
    case "flutter":
      return { PACKAGE_MANAGER: "pub", TEST_RUNNER: "flutter test", LINT: "flutter analyze", FORMAT: "dart format", BUILD: "flutter build" };
    case "node":
      return { PACKAGE_MANAGER: "pnpm", TEST_RUNNER: "pnpm test", LINT: "pnpm lint", FORMAT: "pnpm format", BUILD: "pnpm build" };
    case "python":
      return { PACKAGE_MANAGER: "uv", TEST_RUNNER: "pytest", LINT: "ruff check", FORMAT: "ruff format", BUILD: "uv build" };
    case "dotnet":
      return { PACKAGE_MANAGER: "nuget", TEST_RUNNER: "dotnet test", LINT: "dotnet format --verify-no-changes", FORMAT: "dotnet format", BUILD: "dotnet build" };
    case "mixed":
      return { PACKAGE_MANAGER: "pnpm", TEST_RUNNER: "pnpm test", LINT: "pnpm lint", FORMAT: "pnpm format", BUILD: "pnpm build" };
  }
}

function defaultDeployTarget(kind: CiKind): string {
  switch (kind) {
    case "service": return "railway";
    case "web": return "railway";
    case "mobile": return "app-store";
    case "library": return "none";
  }
}

async function loadTemplate(kind: CiKind): Promise<string> {
  return readFile(join(TEMPLATES, `${kind}.agent-standards.yml`), "utf8");
}

function applyTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\$\{(\w+)\}/g, (_, key) => {
    const v = vars[key];
    if (v === undefined) throw new Error(`Template references unset variable: ${key}`);
    return v;
  });
}

function claudeSettings(repoRoot: string, mcpBin: string, projectName: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        "agent-standards": {
          command: "node",
          args: [mcpBin, "--repo-root", repoRoot, "--name", `agent-standards/${projectName}`],
        },
      },
    },
    null,
    2
  ) + "\n";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Sanity: target must exist (we don't create the project root itself).
  if (!(await exists(args.target))) {
    throw new Error(`Target directory does not exist: ${args.target}`);
  }

  const { workflow, notes } = generateCi({
    language: args.language,
    kind: args.kind,
    unitCoverageThreshold: args.unitCoverage,
    integrationCoverageThreshold: args.integrationCoverage,
    swiftScheme: args.swiftScheme,
    workingDirectory: args.workingDirectory,
    railwayServiceName: args.railwayServiceName,
  });

  const standardsTemplate = await loadTemplate(args.kind);
  const standardsContent = applyTemplate(standardsTemplate, {
    REPO: args.repo,
    LANGUAGE: args.language,
    UNIT_COVERAGE: String(args.unitCoverage),
    INTEGRATION_COVERAGE: String(args.integrationCoverage),
    DEPLOY_TARGET: args.deployTarget ?? defaultDeployTarget(args.kind),
    ...stackDefaults(args.language),
  });

  const settingsContent = claudeSettings(args.target, MCP_BIN, args.name);

  const writes: Array<[string, string]> = [];
  if (!args.skipCi) writes.push([join(args.target, ".github/workflows/ci.yml"), workflow]);
  writes.push([join(args.target, ".agent-standards.yml"), standardsContent]);
  writes.push([join(args.target, ".claude/settings.json"), settingsContent]);

  console.log(`\nScaffolding ${args.name} (${args.kind}/${args.language}) into ${args.target}\n`);

  for (const [path, content] of writes) {
    const status = await writeIfAbsent(path, content, args.force);
    console.log(`  ${status === "written" ? "✓ wrote   " : "→ skipped "} ${path}`);
  }

  if (args.ensureBranches) {
    const result = await ensureDevBranch(args.target);
    console.log(`\nBranching: dev branch — ${result}`);
  }

  console.log("\nNotes from CI generator:");
  for (const note of notes) console.log(`  - ${note}`);

  console.log("\nNext steps:");
  console.log("  1. Review and edit .agent-standards.yml — replace placeholder rules with real ones");
  console.log("  2. Commit: git add .github/workflows/ci.yml .agent-standards.yml .claude/settings.json");
  console.log("  3. Set branch protection (run from forgedtech repo): see agent-standards/README.md");
  console.log(`  4. Restart Claude Code in ${args.target} to pick up the MCP server\n`);
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
});
