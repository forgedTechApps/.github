#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolve } from "node:path";
import { createServer } from "./server.js";

function parseArgs(argv: string[]): { repoRoot?: string; name?: string } {
  const out: { repoRoot?: string; name?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--repo-root") {
      const v = argv[++i];
      if (!v) throw new Error("--repo-root requires a value");
      out.repoRoot = resolve(v);
    } else if (arg?.startsWith("--repo-root=")) {
      out.repoRoot = resolve(arg.slice("--repo-root=".length));
    } else if (arg === "--name") {
      const v = argv[++i];
      if (!v) throw new Error("--name requires a value");
      out.name = v;
    } else if (arg?.startsWith("--name=")) {
      out.name = arg.slice("--name=".length);
    } else if (arg === "--help" || arg === "-h") {
      process.stderr.write(
        "Usage: agent-standards-mcp [--repo-root <path>] [--name <server-name>]\n" +
          "\n" +
          "Options:\n" +
          "  --repo-root <path>   Default repo root for tools that take repo_root.\n" +
          "                       Set this in each project's .claude/settings.json.\n" +
          "  --name <name>        Override the server name advertised over MCP.\n"
      );
      process.exit(0);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const server = createServer({ defaultRepoRoot: args.repoRoot, name: args.name });
const transport = new StdioServerTransport();
await server.connect(transport);
