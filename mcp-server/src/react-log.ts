import { appendFile, mkdir, readFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * ReAct reasoning trace log. Persisted in <repo_root>/.agent-standards-react.jsonl
 * (gitignored). Captures thought→action→observation at MCP decision points.
 * Never throws — a logging failure must never block the gate that triggered it.
 *
 * Call sites fire-and-forget: appendReactEntry(...).catch(() => {})
 */

const REACT_FILE = ".agent-standards-react.jsonl";

export type ReactEntryKind = "start_task" | "propose_change" | "expand_scope";

export interface ReactEntry {
  ts: string;
  kind: ReactEntryKind;
  task_id: string;
  thought?: string;
  action: {
    description: string;
    paths?: string[];
  };
  observation: {
    outcome: "allowed" | "blocked" | "warned";
    codes: string[];
    summary: string;
  };
}

export interface ReactLogSummary {
  total: number;
  thought_coverage: number; // 0–100 percentage
  entries: ReactEntry[];
}

function pathFor(repoRoot: string): string {
  return join(repoRoot, REACT_FILE);
}

export async function appendReactEntry(repoRoot: string, entry: ReactEntry): Promise<void> {
  try {
    const path = pathFor(repoRoot);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    /* swallow — react log is best-effort */
  }
}

export async function readReactLog(
  repoRoot: string,
  limit = 50,
  taskId?: string,
): Promise<ReactLogSummary> {
  const path = pathFor(repoRoot);
  let raw = "";
  try {
    await access(path);
    raw = await readFile(path, "utf8");
  } catch {
    return { total: 0, thought_coverage: 0, entries: [] };
  }

  const all: ReactEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as ReactEntry;
      if (!taskId || e.task_id === taskId) all.push(e);
    } catch { /* skip malformed */ }
  }

  const withThought = all.filter((e) => e.thought !== undefined).length;
  const thought_coverage = all.length > 0 ? Math.round((withThought / all.length) * 100) : 0;
  const entries = all.slice(-limit);

  return { total: all.length, thought_coverage, entries };
}
