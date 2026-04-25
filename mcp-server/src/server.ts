import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { minimatch } from "minimatch";
import { loadStandards, StandardsError } from "./standards.js";
import { checkCiSetup } from "./check-ci.js";
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

  const server = new Server({ name, version }, { capabilities: { tools: {} } });

  const RepoRoot = defaultRepoRoot
    ? z.string().default(defaultRepoRoot)
    : z.string();

  const GetStandardsArgs = z.object({ repo_root: RepoRoot });
  const CheckPathsArgs = z.object({
    repo_root: RepoRoot,
    paths: z.array(z.string()),
  });
  const CheckCiSetupArgs = z.object({ repo_root: RepoRoot });
  const InitRepoArgs = z.object({
    language: z.enum(["swift", "flutter", "node", "python", "dotnet", "mixed"]),
    kind: z.enum(["service", "library", "mobile", "web"]),
    unit_coverage_threshold: z.number().int().min(0).max(100).default(80),
    integration_coverage_threshold: z.number().int().min(0).max(100).default(70),
    swift_scheme: z.string().optional(),
    working_directory: z.string().optional(),
    railway_service_name: z.string().optional(),
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
