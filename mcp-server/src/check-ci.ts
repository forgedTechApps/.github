import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { AgentStandards } from "./standards.js";

export type Severity = "error" | "warn" | "info";

export interface Finding {
  severity: Severity;
  code: string;
  message: string;
  fix?: string;
}

const CANONICAL_REUSABLE_WORKFLOWS = [
  "quality-gate-swift.yml",
  "quality-gate-flutter.yml",
  "quality-gate-node.yml",
  "quality-gate-python.yml",
  "quality-gate-dotnet.yml",
];

const CANONICAL_OWNER_REPO = "forgedTechApps/.github";

interface ParsedWorkflow {
  permissions?: Record<string, string> | string;
  jobs?: Record<string, ParsedJob>;
}

interface ParsedJob {
  uses?: string;
  with?: Record<string, unknown>;
  needs?: string | string[];
  if?: string;
  permissions?: Record<string, string> | string;
}

export async function checkCiSetup(
  repoRoot: string,
  standards: AgentStandards
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const workflowPath = join(repoRoot, ".github/workflows/ci.yml");

  let raw: string;
  try {
    raw = await readFile(workflowPath, "utf8");
  } catch {
    findings.push({
      severity: "error",
      code: "CI_MISSING",
      message: `No CI workflow at ${workflowPath}.`,
      fix: `Call init_repo to scaffold one for kind=${standards.ci?.kind ?? "<set ci.kind in .agent-standards.yml>"}.`,
    });
    return findings;
  }

  let parsed: ParsedWorkflow;
  try {
    parsed = parseYaml(raw) as ParsedWorkflow;
  } catch (err) {
    findings.push({
      severity: "error",
      code: "CI_PARSE_ERROR",
      message: `${workflowPath} failed to parse: ${(err as Error).message}`,
    });
    return findings;
  }

  const jobs = parsed.jobs ?? {};
  const jobEntries = Object.entries(jobs);

  // Find jobs that call a canonical quality-gate-* reusable workflow.
  const qgJobs = jobEntries.filter(([, job]) =>
    job.uses?.includes(CANONICAL_OWNER_REPO) &&
    CANONICAL_REUSABLE_WORKFLOWS.some((wf) => job.uses?.includes(wf))
  );

  if (qgJobs.length === 0) {
    findings.push({
      severity: "error",
      code: "CI_NO_CANONICAL_QUALITY_GATE",
      message:
        `${workflowPath} does not call any canonical quality-gate-*.yml from ${CANONICAL_OWNER_REPO}.`,
      fix: "Replace bespoke CI with a quality-gate-<stack>.yml@v1 call. See product-ci-examples/.",
    });
  }

  // Coverage threshold check — values must meet what standards declare.
  const wantUnit = standards.test_coverage?.unit_min;
  const wantInt = standards.test_coverage?.integration_min;
  for (const [name, job] of qgJobs) {
    const wInputs = (job.with ?? {}) as Record<string, unknown>;
    const unit = parseInt(String(wInputs["unit-coverage-threshold"] ?? ""), 10);
    const intg = parseInt(String(wInputs["integration-coverage-threshold"] ?? ""), 10);

    if (wantUnit !== undefined && (Number.isNaN(unit) || unit < wantUnit)) {
      findings.push({
        severity: "error",
        code: "CI_COVERAGE_BELOW_STANDARD",
        message: `Job '${name}' has unit-coverage-threshold=${wInputs["unit-coverage-threshold"] ?? "<unset>"} but .agent-standards.yml requires ${wantUnit}.`,
        fix: `Set unit-coverage-threshold: '${wantUnit}' in job '${name}'.`,
      });
    }
    if (wantInt !== undefined && (Number.isNaN(intg) || intg < wantInt)) {
      findings.push({
        severity: "error",
        code: "CI_COVERAGE_BELOW_STANDARD",
        message: `Job '${name}' has integration-coverage-threshold=${wInputs["integration-coverage-threshold"] ?? "<unset>"} but .agent-standards.yml requires ${wantInt}.`,
        fix: `Set integration-coverage-threshold: '${wantInt}' in job '${name}'.`,
      });
    }
  }

  // Top-level permissions must include issues:write (security-scan notify needs it).
  const topPerms = parsed.permissions;
  if (typeof topPerms === "object" && topPerms !== null) {
    if (!("issues" in topPerms) || topPerms.issues !== "write") {
      findings.push({
        severity: "warn",
        code: "CI_MISSING_ISSUES_WRITE",
        message:
          "Top-level permissions block does not include issues:write — security-scan.yml notify job will fail.",
        fix: "Add `issues: write` to the top-level permissions block.",
      });
    }
  } else {
    findings.push({
      severity: "warn",
      code: "CI_NO_PERMISSIONS_BLOCK",
      message: "No top-level permissions block. Reusable workflows can't get issues:write.",
      fix: "Add a top-level permissions block including contents:read, checks:write, pull-requests:write, security-events:write, issues:write.",
    });
  }

  // Deploy jobs must depend on CI.
  const ciJobNames = new Set(qgJobs.map(([n]) => n));
  for (const [name, job] of jobEntries) {
    const isDeploy =
      name.startsWith("deploy") ||
      job.uses?.includes("deploy-railway.yml") ||
      job.uses?.includes("deploy-vercel.yml");
    if (!isDeploy) continue;

    const needs = Array.isArray(job.needs) ? job.needs : job.needs ? [job.needs] : [];
    const dependsOnCi = needs.some((n) => ciJobNames.has(n));
    if (!dependsOnCi) {
      findings.push({
        severity: "error",
        code: "CI_DEPLOY_WITHOUT_NEEDS_CI",
        message: `Deploy job '${name}' does not depend on a quality-gate job. Tests can be skipped before deploy.`,
        fix: `Add 'needs: [${[...ciJobNames].join(", ") || "ci"}]' to job '${name}'.`,
      });
    }
  }

  // ci.kind sanity: mobile repos shouldn't have deploy-railway, services should.
  const kind = standards.ci?.kind;
  const hasRailwayDeploy = jobEntries.some(([, j]) =>
    j.uses?.includes("deploy-railway.yml")
  );

  if (kind === "mobile" && hasRailwayDeploy) {
    findings.push({
      severity: "warn",
      code: "CI_KIND_MISMATCH",
      message: "ci.kind=mobile but workflow includes deploy-railway. Mobile apps deploy via app stores.",
    });
  }
  if (kind === "service" && !hasRailwayDeploy && standards.ci?.deploy_target === "railway") {
    findings.push({
      severity: "warn",
      code: "CI_KIND_MISMATCH",
      message: "ci.kind=service with deploy_target=railway but no deploy-railway job in workflow.",
      fix: "Add a deploy job: `uses: forgedTechApps/.github/.github/workflows/deploy-railway.yml@v1`.",
    });
  }

  if (findings.length === 0) {
    findings.push({
      severity: "info",
      code: "CI_OK",
      message: `${workflowPath} passes all standards checks.`,
    });
  }

  return findings;
}
