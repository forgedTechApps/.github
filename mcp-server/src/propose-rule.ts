import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Append a proposed rule to a structured file the user reviews periodically.
 * Never auto-edits CLAUDE.md or .agent-standards.yml — agents propose,
 * humans accept.
 *
 * File: <repo_root>/.agent-standards-proposals.md
 * Format: a markdown table of timestamped proposals.
 */

const PROPOSALS_FILE = ".agent-standards-proposals.md";

const HEADER = `# Proposed Agent-Standards Additions

> Proposals from agents based on real friction encountered in sessions. Review
> periodically; promote good ones into \`.agent-standards.yml\` or \`CLAUDE.md\`,
> delete the rest. Never auto-applied.

| When | Target | Rule | Reason |
| ---- | ------ | ---- | ------ |
`;

export interface ProposalArgs {
  repo_root: string;
  target: "claude_md" | "agent_standards";
  rule: string;
  reason: string;
}

export interface ProposalResult {
  written_to: string;
  total_proposals: number;
}

function escapePipe(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export async function proposeRule(args: ProposalArgs): Promise<ProposalResult> {
  const path = join(args.repo_root, PROPOSALS_FILE);

  let content: string;
  try {
    await access(path);
    content = await readFile(path, "utf8");
  } catch {
    content = HEADER;
  }

  const when = new Date().toISOString().slice(0, 19).replace("T", " ");
  const targetLabel = args.target === "claude_md" ? "CLAUDE.md" : ".agent-standards.yml";
  const row = `| ${when} | ${targetLabel} | ${escapePipe(args.rule)} | ${escapePipe(args.reason)} |\n`;

  const next = content + row;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, next, "utf8");

  // Count rows by counting `| 20` (timestamp lines) — header has no such row
  const total = (next.match(/^\| \d{4}-/gm) ?? []).length;

  return { written_to: path, total_proposals: total };
}
