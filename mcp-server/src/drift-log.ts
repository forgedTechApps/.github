import { mkdir, readFile, writeFile, access, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Finding } from "./check-ci.js";

/**
 * Lightweight rolling log of standards-check findings per repo. JSONL,
 * append-only, gitignored. Lets `get_drift_log` surface trends ("3 of 4
 * recent runs show CI_NO_PERMISSIONS_BLOCK") instead of one-shot signals.
 */

const LOG_FILE = ".agent-standards-drift.jsonl";
const MAX_ENTRIES = 500;

export interface DriftEntry {
  ts: string;          // ISO timestamp
  source: string;      // "check_ci_setup" | "check_branching" | "check_secrets" | "check_design_consistency"
  severity: "error" | "warn" | "info";
  code: string;
  message: string;
}

function pathFor(repoRoot: string): string {
  return join(repoRoot, LOG_FILE);
}

export async function appendDrift(repoRoot: string, source: string, findings: Finding[]): Promise<void> {
  const path = pathFor(repoRoot);
  const ts = new Date().toISOString();
  const lines = findings
    .map((f) => JSON.stringify({ ts, source, severity: f.severity, code: f.code, message: f.message }))
    .join("\n") + "\n";

  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, lines, "utf8");
  } catch {
    /* swallow — drift log is best-effort */
  }

  // Trim if file exceeds MAX_ENTRIES
  try {
    const content = await readFile(path, "utf8");
    const allLines = content.trim().split("\n").filter(Boolean);
    if (allLines.length > MAX_ENTRIES) {
      const trimmed = allLines.slice(allLines.length - MAX_ENTRIES).join("\n") + "\n";
      await writeFile(path, trimmed, "utf8");
    }
  } catch {
    /* swallow */
  }
}

export interface DriftSummary {
  total_entries: number;
  window_days: number;
  by_code: Array<{ code: string; count: number; latest: string; severity: string }>;
  by_source: Record<string, number>;
}

export async function getDriftLog(repoRoot: string, windowDays = 14): Promise<DriftSummary> {
  const path = pathFor(repoRoot);
  let raw = "";
  try {
    await access(path);
    raw = await readFile(path, "utf8");
  } catch {
    return { total_entries: 0, window_days: windowDays, by_code: [], by_source: {} };
  }

  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const entries: DriftEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as DriftEntry;
      if (Date.parse(e.ts) >= cutoff) entries.push(e);
    } catch { /* skip */ }
  }

  const codeMap = new Map<string, { count: number; latest: string; severity: string }>();
  const sourceMap: Record<string, number> = {};
  for (const e of entries) {
    sourceMap[e.source] = (sourceMap[e.source] ?? 0) + 1;
    const cur = codeMap.get(e.code);
    if (cur) {
      cur.count += 1;
      if (e.ts > cur.latest) cur.latest = e.ts;
    } else {
      codeMap.set(e.code, { count: 1, latest: e.ts, severity: e.severity });
    }
  }

  const by_code = [...codeMap.entries()]
    .map(([code, v]) => ({ code, count: v.count, latest: v.latest, severity: v.severity }))
    .sort((a, b) => b.count - a.count);

  return {
    total_entries: entries.length,
    window_days: windowDays,
    by_code,
    by_source: sourceMap,
  };
}
