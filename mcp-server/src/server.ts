import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { minimatch } from "minimatch";
import { loadStandards, StandardsError } from "./standards.js";
import { checkCiSetup } from "./check-ci.js";
import { checkBranching } from "./check-branching.js";
import { checkSecrets } from "./check-secrets.js";
import { checkDesignConsistency } from "./check-design-consistency.js";
import { proposeRule } from "./propose-rule.js";
import { appendDrift, getDriftLog } from "./drift-log.js";
import {
  startTask,
  proposeChange,
  commitCheckpoint,
} from "./task-tracking.js";
import { generateCi, type CiKind, type Language } from "./init-repo.js";

export interface CreateServerOptions {
  /**
   * Default repo root used when a tool is called without an explicit `repo_root` arg.
   * Set this from the project's MCP config (e.g. via the `--repo-root` CLI flag) so
   * agents inside that project don't have to know the absolute path.
   */
  defaultRepoRoot?: string;

  /**
   * Server name advertised over the MCP handshake. Override per project to make it
   * obvious which project an agent is wired to (e.g. `forgedtech-agent-standards/forge`).
   */
  name?: string;

  /** Server version. Defaults to the core package version. */
  version?: string;
}

const PACKAGE_VERSION = "0.1.0";

/** Build a fully wired MCP `Server`. Caller is responsible for connecting it to a transport. */
export function createServer(options: CreateServerOptions = {}): Server {
  const { defaultRepoRoot, name = "forgedtech-agent-standards", version = PACKAGE_VERSION } = options;

  // We only support tools — do NOT declare prompts/resources capabilities.
  // Declaring them (even as empty objects) tells Claude Code's /mcp menu the
  // server has prompts/resources available, and the menu hangs when it tries
  // to render them. Clients that ignore the capability map and ask anyway
  // will get a JSON-RPC -32601 (Method not found), which is the correct
  // and well-handled response per the MCP spec.
  const server = new Server(
    { name, version },
    { capabilities: { tools: {} } }
  );

  const RepoRoot = defaultRepoRoot
    ? z.string().default(defaultRepoRoot)
    : z.string();

  const GetStandardsArgs = z.object({ repo_root: RepoRoot });
  const CheckPathsArgs = z.object({
    repo_root: RepoRoot,
    paths: z.array(z.string()),
  });
  const CheckCiSetupArgs = z.object({ repo_root: RepoRoot });
  const CheckBranchingArgs = z.object({ repo_root: RepoRoot });
  const InitRepoArgs = z.object({
    language: z.enum(["swift", "flutter", "node", "python", "dotnet", "mixed"]),
    kind: z.enum(["service", "library", "mobile", "web"]),
    unit_coverage_threshold: z.number().int().min(0).max(100).default(80),
    integration_coverage_threshold: z.number().int().min(0).max(100).default(70),
    swift_scheme: z.string().optional(),
    working_directory: z.string().optional(),
    railway_service_name: z.string().optional(),
  });

  const CheckSecretsArgs = z.object({
    repo_root: RepoRoot,
    scope: z.enum(["staged", "tracked", "all"]).default("staged"),
  });

  const CheckDesignConsistencyArgs = z.object({ repo_root: RepoRoot });

  const RunLocalChecksArgs = z.object({
    repo_root: RepoRoot,
    include: z.array(z.enum(["ci", "branching", "secrets", "design"])).optional(),
    secrets_scope: z.enum(["staged", "tracked", "all"]).default("staged"),
  });

  const ProposeRuleArgs = z.object({
    repo_root: RepoRoot,
    target: z.enum(["claude_md", "agent_standards"]),
    rule: z.string().min(5),
    reason: z.string().min(5),
  });

  const GetDriftLogArgs = z.object({
    repo_root: RepoRoot,
    window_days: z.number().int().min(1).max(365).default(14),
  });

  const StartTaskArgsZ = z.object({
    repo_root: RepoRoot,
    description: z.string().min(5),
    hypothesis: z.string().min(5),
    expected_reads: z.array(z.string()).optional(),
    expected_writes: z.array(z.string()).optional(),
  });

  const ProposeChangeArgsZ = z.object({
    repo_root: RepoRoot,
    task_id: z.string().optional(),
    paths: z.array(z.string()),
    rationale: z.string().min(5),
  });

  const CommitCheckpointArgsZ = z.object({
    repo_root: RepoRoot,
    task_id: z.string().optional(),
    reads: z.array(z.string()).optional(),
    writes: z.array(z.string()).optional(),
    note: z.string().optional(),
    close: z.boolean().optional(),
  });

  const repoRootProp = defaultRepoRoot
    ? {
        type: "string",
        description: `Defaults to ${defaultRepoRoot} (set by --repo-root). Override only when targeting a sibling repo.`,
      }
    : { type: "string", description: "Absolute path to repo." };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "get_standards",
        description:
          "Load .agent-standards.yml for the given repo. Returns coding style, architecture rules, " +
          "test coverage targets, review gates, and investigation policy. Call this at the start of every task.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: { repo_root: repoRootProp },
        },
      },
      {
        name: "check_paths",
        description:
          "Check whether a list of intended write paths trigger any standards gates: " +
          "explicit-approval, sensitive, or regression-test-required.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? ["paths"] : ["repo_root", "paths"],
          properties: {
            repo_root: repoRootProp,
            paths: { type: "array", items: { type: "string" } },
          },
        },
      },
      {
        name: "check_ci_setup",
        description:
          "Validate the repo's CI workflow against the org's standards: must exist, must call a " +
          "canonical quality-gate-*.yml, must meet coverage thresholds from .agent-standards.yml, " +
          "must include issues:write permission, must have deploy jobs depending on CI. ALWAYS call " +
          "this at task start.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: { repo_root: repoRootProp },
        },
      },
      {
        name: "check_branching",
        description:
          "Validate the repo against its branching policy: required branches exist on origin " +
          "(default: main + dev), the default branch matches, and the current branch name conforms " +
          "to the feature-branch pattern. Degrades to warnings when offline or remote unreachable.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: { repo_root: repoRootProp },
        },
      },
      {
        name: "init_repo",
        description:
          "Generate a proposed `.github/workflows/ci.yml` for a repo that lacks one. Returns text only — " +
          "does NOT write. Choose `kind`: service (API + Railway), library (code-only), mobile " +
          "(iOS/Flutter), web (Next.js/Vite + Railway).",
        inputSchema: {
          type: "object",
          required: ["language", "kind"],
          properties: {
            language: { type: "string", enum: ["swift", "flutter", "node", "python", "dotnet", "mixed"] },
            kind: { type: "string", enum: ["service", "library", "mobile", "web"] },
            unit_coverage_threshold: { type: "number", default: 80 },
            integration_coverage_threshold: { type: "number", default: 70 },
            swift_scheme: { type: "string", description: "Required for kind=mobile + language=swift." },
            working_directory: { type: "string", description: "For monorepos — sub-app path." },
            railway_service_name: { type: "string", description: "Required for service or web with Railway." },
          },
        },
      },
      {
        name: "check_secrets",
        description:
          "Scan files for likely secrets (cloud keys, bearer tokens, JWTs, private keys). " +
          "Default scope: staged files (pre-commit gate). Use 'tracked' for the full repo, 'all' for an unindexed walk. " +
          "Conservative pattern set — for deep scanning, run gitleaks/trufflehog in CI.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: {
            repo_root: repoRootProp,
            scope: { type: "string", enum: ["staged", "tracked", "all"], default: "staged" },
          },
        },
      },
      {
        name: "check_design_consistency",
        description:
          "Lint UI files for design-system drift: hardcoded hex colors not in tokens, off-scale spacing, " +
          "more than 2 fonts or 3 colors (org-wide hard caps), inline styles in JSX. " +
          "Only meaningful for ci.kind=web or mobile; no-ops elsewhere. " +
          "Detects token files via convention (tokens|theme|design-system|colors|palette|spacing|typography).",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: { repo_root: repoRootProp },
        },
      },
      {
        name: "run_local_checks",
        description:
          "One-call aggregator for the standard local checks: ci_setup, branching, secrets, design. " +
          "Use this before committing — closes the gap of having to call each tool individually. " +
          "Findings are appended to the drift log; query trends with get_drift_log.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: {
            repo_root: repoRootProp,
            include: {
              type: "array",
              items: { type: "string", enum: ["ci", "branching", "secrets", "design"] },
              description: "Subset of checks to run. Default: all four.",
            },
            secrets_scope: { type: "string", enum: ["staged", "tracked", "all"], default: "staged" },
          },
        },
      },
      {
        name: "propose_claude_md_rule",
        description:
          "Append a proposed addition to <repo_root>/.agent-standards-proposals.md. Use when the agent " +
          "made a mistake the user had to correct, AND the agent has identified a one-line rule that " +
          "would have prevented it. Never auto-edits CLAUDE.md / .agent-standards.yml — humans review.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? ["target", "rule", "reason"] : ["repo_root", "target", "rule", "reason"],
          properties: {
            repo_root: repoRootProp,
            target: { type: "string", enum: ["claude_md", "agent_standards"] },
            rule: { type: "string", description: "One-line rule that would have prevented the mistake." },
            reason: { type: "string", description: "What went wrong and why this rule helps." },
          },
        },
      },
      {
        name: "get_drift_log",
        description:
          "Summarise standards-check findings recorded in the last N days. Surfaces trends rather " +
          "than one-shot results: which violations recur, which sources fire most. Reads from " +
          "<repo_root>/.agent-standards-drift.jsonl (gitignored, populated by run_local_checks).",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: {
            repo_root: repoRootProp,
            window_days: { type: "number", default: 14 },
          },
        },
      },
      {
        name: "start_task",
        description:
          "Record a hypothesis-first plan before doing work. Captures: description, hypothesis " +
          "about what needs changing, expected files to read/write. Returns a task_id used by " +
          "propose_change and commit_checkpoint. Persisted in .agent-standards-tasks.json.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? ["description", "hypothesis"] : ["repo_root", "description", "hypothesis"],
          properties: {
            repo_root: repoRootProp,
            description: { type: "string" },
            hypothesis: { type: "string" },
            expected_reads: { type: "array", items: { type: "string" }, description: "File paths or globs you expect to read." },
            expected_writes: { type: "array", items: { type: "string" }, description: "File paths or globs you expect to modify." },
          },
        },
      },
      {
        name: "propose_change",
        description:
          "Validate intended write paths against the active task's expected_writes. Hard mode " +
          "(.agent-standards.yml investigation.mode=hard) blocks on out-of-scope writes; soft mode warns. " +
          "Call before writing — surfaces scope creep early.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? ["paths", "rationale"] : ["repo_root", "paths", "rationale"],
          properties: {
            repo_root: repoRootProp,
            task_id: { type: "string", description: "Defaults to the active task." },
            paths: { type: "array", items: { type: "string" } },
            rationale: { type: "string" },
          },
        },
      },
      {
        name: "commit_checkpoint",
        description:
          "Record progress on the active (or specified) task: files actually read/written, optional " +
          "note, and an optional close flag. Returns running totals + read/write ratio. Pair with " +
          "start_task / propose_change to build a hypothesis-first audit trail.",
        inputSchema: {
          type: "object",
          required: defaultRepoRoot ? [] : ["repo_root"],
          properties: {
            repo_root: repoRootProp,
            task_id: { type: "string" },
            reads: { type: "array", items: { type: "string" } },
            writes: { type: "array", items: { type: "string" } },
            note: { type: "string" },
            close: { type: "boolean" },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      if (req.params.name === "get_standards") {
        const args = GetStandardsArgs.parse(req.params.arguments ?? {});
        const standards = await loadStandards(args.repo_root);
        return { content: [{ type: "text", text: JSON.stringify(standards, null, 2) }] };
      }

      if (req.params.name === "check_ci_setup") {
        const args = CheckCiSetupArgs.parse(req.params.arguments ?? {});
        const standards = await loadStandards(args.repo_root);
        const findings = await checkCiSetup(args.repo_root, standards);
        const isError = findings.some((f) => f.severity === "error");
        return { isError, content: [{ type: "text", text: JSON.stringify(findings, null, 2) }] };
      }

      if (req.params.name === "check_branching") {
        const args = CheckBranchingArgs.parse(req.params.arguments ?? {});
        const standards = await loadStandards(args.repo_root);
        const findings = await checkBranching(args.repo_root, standards);
        const isError = findings.some((f) => f.severity === "error");
        return { isError, content: [{ type: "text", text: JSON.stringify(findings, null, 2) }] };
      }

      if (req.params.name === "init_repo") {
        const args = InitRepoArgs.parse(req.params.arguments ?? {});
        const result = generateCi({
          language: args.language as Language,
          kind: args.kind as CiKind,
          unitCoverageThreshold: args.unit_coverage_threshold,
          integrationCoverageThreshold: args.integration_coverage_threshold,
          swiftScheme: args.swift_scheme,
          workingDirectory: args.working_directory,
          railwayServiceName: args.railway_service_name,
        });
        return {
          content: [
            {
              type: "text",
              text:
                `# Proposed .github/workflows/ci.yml\n\n` +
                `\`\`\`yaml\n${result.workflow}\`\`\`\n\n` +
                `## Notes\n${result.notes.map((n) => `- ${n}`).join("\n")}\n`,
            },
          ],
        };
      }

      if (req.params.name === "check_paths") {
        const args = CheckPathsArgs.parse(req.params.arguments ?? {});
        const standards = await loadStandards(args.repo_root);
        const result = args.paths.map((path) => {
          const triggered: string[] = [];
          const sensitive = standards.architecture?.sensitive_paths ?? [];
          const approval = standards.review?.explicit_approval_required_for ?? [];
          const regression = standards.test_coverage?.regression_required_for ?? [];

          for (const pat of sensitive) if (minimatch(path, pat)) triggered.push(`sensitive:${pat}`);
          for (const pat of approval) if (minimatch(path, pat)) triggered.push(`approval-required:${pat}`);
          for (const pat of regression) if (minimatch(path, pat)) triggered.push(`regression-test-required:${pat}`);

          return { path, triggered };
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      if (req.params.name === "check_secrets") {
        const args = CheckSecretsArgs.parse(req.params.arguments ?? {});
        const findings = await checkSecrets(args.repo_root, args.scope);
        await appendDrift(args.repo_root, "check_secrets", findings);
        const isError = findings.some((f) => f.severity === "error");
        return { isError, content: [{ type: "text", text: JSON.stringify(findings, null, 2) }] };
      }

      if (req.params.name === "check_design_consistency") {
        const args = CheckDesignConsistencyArgs.parse(req.params.arguments ?? {});
        const standards = await loadStandards(args.repo_root);
        const findings = await checkDesignConsistency(args.repo_root, standards);
        await appendDrift(args.repo_root, "check_design_consistency", findings);
        const isError = findings.some((f) => f.severity === "error");
        return { isError, content: [{ type: "text", text: JSON.stringify(findings, null, 2) }] };
      }

      if (req.params.name === "run_local_checks") {
        const args = RunLocalChecksArgs.parse(req.params.arguments ?? {});
        const include = new Set(args.include ?? ["ci", "branching", "secrets", "design"]);
        const standards = await loadStandards(args.repo_root);
        const sections: Array<{ source: string; findings: import("./check-ci.js").Finding[] }> = [];
        if (include.has("ci")) {
          const f = await checkCiSetup(args.repo_root, standards);
          sections.push({ source: "check_ci_setup", findings: f });
          await appendDrift(args.repo_root, "check_ci_setup", f);
        }
        if (include.has("branching")) {
          const f = await checkBranching(args.repo_root, standards);
          sections.push({ source: "check_branching", findings: f });
          await appendDrift(args.repo_root, "check_branching", f);
        }
        if (include.has("secrets")) {
          const f = await checkSecrets(args.repo_root, args.secrets_scope);
          sections.push({ source: "check_secrets", findings: f });
          await appendDrift(args.repo_root, "check_secrets", f);
        }
        if (include.has("design")) {
          const f = await checkDesignConsistency(args.repo_root, standards);
          sections.push({ source: "check_design_consistency", findings: f });
          await appendDrift(args.repo_root, "check_design_consistency", f);
        }
        const isError = sections.some((s) => s.findings.some((f) => f.severity === "error"));
        return { isError, content: [{ type: "text", text: JSON.stringify(sections, null, 2) }] };
      }

      if (req.params.name === "propose_claude_md_rule") {
        const args = ProposeRuleArgs.parse(req.params.arguments ?? {});
        const result = await proposeRule(args);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      if (req.params.name === "get_drift_log") {
        const args = GetDriftLogArgs.parse(req.params.arguments ?? {});
        const summary = await getDriftLog(args.repo_root, args.window_days);
        return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
      }

      if (req.params.name === "start_task") {
        const args = StartTaskArgsZ.parse(req.params.arguments ?? {});
        const result = await startTask(args.repo_root, args);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      if (req.params.name === "propose_change") {
        const args = ProposeChangeArgsZ.parse(req.params.arguments ?? {});
        const standards = await loadStandards(args.repo_root);
        const findings = await proposeChange(args.repo_root, args, standards);
        const isError = findings.some((f) => f.severity === "error");
        return { isError, content: [{ type: "text", text: JSON.stringify(findings, null, 2) }] };
      }

      if (req.params.name === "commit_checkpoint") {
        const args = CommitCheckpointArgsZ.parse(req.params.arguments ?? {});
        const result = await commitCheckpoint(args.repo_root, args);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      throw new Error(`Unknown tool: ${req.params.name}`);
    } catch (err) {
      if (err instanceof StandardsError) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `${err.message}${err.errors ? `\n\nDetails:\n${JSON.stringify(err.errors, null, 2)}` : ""}`,
            },
          ],
        };
      }
      throw err;
    }
  });

  return server;
}
