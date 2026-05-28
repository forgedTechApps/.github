import { mkdtemp, cp, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { parse as parseYaml } from "yaml";
import type { Finding } from "../check-ci.js";
import type { AgentStandards } from "../standards.js";

const exec = promisify(execCb);

export const FIXTURES_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
  "__tests__",
  "fixtures",
);

export type CheckFn = (repoRoot: string, standards: AgentStandards) => Promise<Finding[]>;

export interface Fixture {
  name: string;
  dir: string;
  standards: AgentStandards;
  expected: ExpectedFindings;
}

export interface ExpectedFinding {
  severity: Finding["severity"];
  code: string;
  /** Substring match against `message`. Use a stable fragment that won't churn on cosmetic edits. */
  messageIncludes?: string;
}

export interface ExpectedFindings {
  findings: ExpectedFinding[];
  /** When true, fixture must produce exactly the listed findings (in any order). */
  exact?: boolean;
}

export async function loadFixtures(checkDir: string): Promise<Fixture[]> {
  const root = join(FIXTURES_ROOT, checkDir);
  const entries = await readdir(root, { withFileTypes: true });
  const fixtures: Fixture[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    const standards = parseYaml(await readFile(join(dir, "standards.yml"), "utf8")) as AgentStandards;
    const expected = JSON.parse(await readFile(join(dir, "expected.json"), "utf8")) as ExpectedFindings;
    fixtures.push({ name: entry.name, dir, standards, expected });
  }
  return fixtures.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Copy a fixture dir to a tmpdir, init a git repo there (so `git ls-files`
 * works), and return the path. Caller invokes the check against the returned
 * path. Tmpdir is auto-cleaned by the OS — we don't bother removing it.
 */
export async function materialiseFixture(fixtureDir: string): Promise<string> {
  const tmp = await mkdtemp(join(tmpdir(), `mcp-fixture-${basename(fixtureDir)}-`));
  await cp(fixtureDir, tmp, { recursive: true });
  // Don't copy standards.yml / expected.json into git — they're test metadata.
  await writeFile(join(tmp, ".gitignore"), "standards.yml\nexpected.json\n");
  await exec("git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -q -m init", { cwd: tmp });
  return tmp;
}

export function assertFindings(actual: Finding[], expected: ExpectedFindings, fixtureName: string): void {
  const errors: string[] = [];
  for (const want of expected.findings) {
    const hit = actual.find(
      (f) =>
        f.severity === want.severity &&
        f.code === want.code &&
        (want.messageIncludes === undefined || f.message.includes(want.messageIncludes)),
    );
    if (!hit) {
      errors.push(
        `[${fixtureName}] missing expected finding: ${want.severity} ${want.code}` +
          (want.messageIncludes ? ` (message must include "${want.messageIncludes}")` : ""),
      );
    }
  }
  if (expected.exact && actual.length !== expected.findings.length) {
    errors.push(
      `[${fixtureName}] expected exactly ${expected.findings.length} finding(s), got ${actual.length}:\n` +
        actual.map((f) => `  - ${f.severity} ${f.code}: ${f.message}`).join("\n"),
    );
  }
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}

export async function runFixtureSuite(checkDir: string, check: CheckFn): Promise<void> {
  const { test } = await import("node:test");
  const fixtures = await loadFixtures(checkDir);
  for (const f of fixtures) {
    test(`${checkDir}/${f.name}`, async () => {
      const repoRoot = await materialiseFixture(f.dir);
      const findings = await check(repoRoot, f.standards);
      assertFindings(findings, f.expected, f.name);
    });
  }
}
