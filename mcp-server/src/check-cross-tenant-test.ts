import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { minimatch } from "minimatch";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import type { Finding } from "./check-ci.js";
import type { AgentStandards } from "./standards.js";

const exec = promisify(execCb);

/**
 * Cross-tenant integration test invariant (Beyond-W15 / W17-18).
 *
 * Generic AST check for "authorisation at the resource level" is
 * impractical (auth patterns vary by domain). The mechanical proxy is:
 *
 *   For every authenticated route, there must exist an integration-test
 *   assertion that the route returns 403 when called with a foreign
 *   tenant ID.
 *
 * Kurata's `cross-household.integration.test.ts` is the canonical example.
 * This check enforces it across any project that opts in by setting
 * `architecture.tenant_isolation.cross_tenant_test_file`.
 *
 * Approach (conservative — false positives erode trust):
 *   1. If cross_tenant_test_file isn't configured → info: not configured.
 *   2. If configured but the file doesn't exist → error.
 *   3. Count authenticated route handlers in route_files.
 *   4. Count assertions in the cross-tenant test file (loose: occurrences
 *      of "403", "Forbidden", or "toBe(403)" etc.).
 *   5. If routes > assertions by more than 20%, warn — likely routes were
 *      added without test rows.
 *
 * The 20% slack acknowledges that one assertion can cover multiple
 * routes via parameterisation; the check is a proxy, not a count match.
 */

const DEFAULT_ROUTE_GLOBS = [
  "**/routes/**/*.ts",
  "**/routes/**/*.js",
  "**/routes/**/*.py",
  "**/router.py",
  "**/*.routes.ts",
];

/** Heuristics for "this line declares an authenticated route handler". */
const AUTH_ROUTE_PATTERNS: RegExp[] = [
  // FastAPI: @router.get("/foo"), @app.post("/bar")
  /@(?:router|app)\.(?:get|post|put|patch|delete)\s*\(/g,
  // Express / Fastify direct method: app.get('/x', ...), fastify.post(...)
  /\b(?:app|router|fastify|server)\.(?:get|post|put|patch|delete)\s*\(/g,
  // Fastify route-object style: { method: 'GET', ... } — one route per method declaration
  /method:\s*['"](?:GET|POST|PUT|PATCH|DELETE)['"]/g,
];

/** Heuristics for "this is a 403 assertion or expectation". */
const FORBIDDEN_ASSERTION_PATTERNS: RegExp[] = [
  /\.toBe\s*\(\s*403\s*\)/g,
  /\.toEqual\s*\(\s*403\s*\)/g,
  /\.status\s*\(\s*403\s*\)/g,
  /\bstatus_code\s*==\s*403\b/g,
  /\bstatusCode\s*===?\s*403\b/g,
  // Inequality "fail if not 403" — common in parameterised tests
  /\bstatusCode\s*!==?\s*403\b/g,
  /\bstatus_code\s*!=\s*403\b/g,
  /\bexpect_status\s*\(\s*403/g,
  // Python: assert response.status_code == 403
  /\bresponse\.status_code\s*==\s*403\b/g,
  // Loose: "expected 403" in a string is usually a test assertion message
  /\bexpected\s+403\b/gi,
];

async function listTrackedFiles(repoRoot: string): Promise<string[]> {
  try {
    const { stdout } = await exec("git ls-files", { cwd: repoRoot, maxBuffer: 50 * 1024 * 1024 });
    return stdout.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function countMatches(content: string, patterns: RegExp[]): number {
  let total = 0;
  for (const pat of patterns) {
    pat.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(content)) !== null) {
      total++;
      if (total > 1000) break; // safety bound
    }
  }
  return total;
}

export async function checkCrossTenantTest(
  repoRoot: string,
  standards: AgentStandards
): Promise<Finding[]> {
  const config = standards.architecture?.tenant_isolation;
  if (!config) {
    return [{
      severity: "info",
      code: "CROSS_TENANT_TEST_NOT_CONFIGURED",
      message: "architecture.tenant_isolation not configured. This check is a no-op for non-multi-tenant projects.",
    }];
  }
  if (!config.cross_tenant_test_file) {
    return [{
      severity: "warn",
      code: "CROSS_TENANT_TEST_NOT_DESIGNATED",
      message:
        "architecture.tenant_isolation is configured but cross_tenant_test_file is not set. " +
        "Designate a parameterised integration test that hits every authenticated route with a " +
        "foreign tenant ID and asserts 403. Kurata's packages/api/src/routes/cross-household.integration.test.ts " +
        "is the canonical example.",
    }];
  }

  // 1. Verify the file exists.
  const testPath = join(repoRoot, config.cross_tenant_test_file);
  try {
    await access(testPath);
  } catch {
    return [{
      severity: "error",
      code: "CROSS_TENANT_TEST_MISSING",
      message: `Cross-tenant test file '${config.cross_tenant_test_file}' does not exist.`,
      fix:
        "Create the file as a parameterised integration test asserting 403 for foreign tenant IDs " +
        "on every authenticated route. Add a row per new authenticated route.",
    }];
  }

  // 2. Count authenticated routes.
  const routeGlobs = config.route_files ?? DEFAULT_ROUTE_GLOBS;
  const allFiles = await listTrackedFiles(repoRoot);
  const routeFiles = allFiles.filter((f) =>
    routeGlobs.some((g) => minimatch(f, g)) &&
    !/(?:\.test\.|\.spec\.|test_)/.test(f)
  );

  let routeCount = 0;
  for (const f of routeFiles) {
    try {
      const content = await readFile(join(repoRoot, f), "utf8");
      routeCount += countMatches(content, AUTH_ROUTE_PATTERNS);
    } catch { /* skip */ }
  }

  // 3. Count assertions in the cross-tenant test file. Also detect
  // parameterised-test sentinels: a test that loops over EXPECTED_ROUTE_COUNT
  // (or similar) and asserts on each iteration covers N routes with one
  // assertion. When the sentinel is present + grounded against a number,
  // use that count as the effective assertion count.
  let assertionCount = 0;
  let isParameterised = false;
  try {
    const testContent = await readFile(testPath, "utf8");
    assertionCount = countMatches(testContent, FORBIDDEN_ASSERTION_PATTERNS);

    // Look for "EXPECTED_ROUTE_COUNT" or similar sentinels that ground the
    // parameterised count.
    const expectedConstMatch = testContent.match(
      /(?:EXPECTED_ROUTE_COUNT|EXPECTED_ROUTES|EXPECTED_AUTH_ROUTES|ROUTE_COUNT)\s*=\s*(\d+)/
    );
    const greaterThanMatch = testContent.match(
      /(?:EXPECTED_ROUTE_COUNT|EXPECTED_ROUTES|EXPECTED_AUTH_ROUTES|ROUTE_COUNT)\s*\)\s*\.\s*(?:toBeGreaterThanOrEqual|toBeGreaterThan|toEqual|toBe)\s*\(\s*(\d+)/
    );
    if (expectedConstMatch?.[1]) {
      isParameterised = true;
      assertionCount = Math.max(assertionCount, parseInt(expectedConstMatch[1], 10));
    } else if (greaterThanMatch?.[1]) {
      isParameterised = true;
      assertionCount = Math.max(assertionCount, parseInt(greaterThanMatch[1], 10));
    }
  } catch {
    // already checked existence; an error here is a permissions issue
    return [{
      severity: "error",
      code: "CROSS_TENANT_TEST_UNREADABLE",
      message: `Could not read ${config.cross_tenant_test_file}.`,
    }];
  }

  // 4. Parity check with 20% slack.
  const findings: Finding[] = [];
  if (routeCount === 0) {
    return [{
      severity: "info",
      code: "CROSS_TENANT_TEST_NO_ROUTES",
      message:
        `No authenticated route handlers found across ${routeFiles.length} route file(s) (globs: ${routeGlobs.join(", ")}). ` +
        `Either the patterns don't match this project's route style, or there are no routes yet.`,
    }];
  }

  const ratio = assertionCount / routeCount;
  if (assertionCount === 0) {
    findings.push({
      severity: "error",
      code: "CROSS_TENANT_TEST_EMPTY",
      message:
        `${config.cross_tenant_test_file} exists but contains zero 403 assertions, while ${routeCount} ` +
        `authenticated route handlers were detected. The file must assert 403 for foreign tenant IDs.`,
    });
  } else if (ratio < 0.8) {
    findings.push({
      severity: "warn",
      code: "CROSS_TENANT_TEST_UNDER_COVERAGE",
      message:
        `${assertionCount} 403 assertion(s) in ${config.cross_tenant_test_file} vs ${routeCount} ` +
        `authenticated route handler(s) detected. New routes may have been added without test rows. ` +
        `(20% slack applied; ratio: ${ratio.toFixed(2)}, threshold 0.80.)`,
      fix:
        "Add a row to the parameterised test for each new authenticated route. If a single row " +
        "legitimately covers multiple routes via parameterisation, that's fine — the check only warns.",
    });
  } else {
    findings.push({
      severity: "info",
      code: "CROSS_TENANT_TEST_OK",
      message:
        `${assertionCount} 403 assertion(s)${isParameterised ? " (parameterised)" : ""} vs ${routeCount} ` +
        `authenticated route(s) — within tolerance (ratio: ${ratio.toFixed(2)}).`,
    });
  }

  return findings;
}
