import { appendFile, mkdir, readFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Append-only audit log for MCP gate decisions. Persisted in
 * <repo_root>/.agent-standards-audit.jsonl (gitignored). Never throws —
 * a logging failure must never block the gate that triggered it.
 *
 * Call sites fire-and-forget: appendAuditEvent(...).catch(() => {})
 */

const AUDIT_FILE = ".agent-standards-audit.jsonl";

export type AuditEventKind =
  | "task_started"         // start_task called
  | "trivial_bypass"       // size: 'trivial' declared
  | "propose_change"       // propose_change call + outcome
  | "gate_fired"           // a gate blocked propose_change
  | "expand_scope"         // scope expanded, user_confirmed=true
  | "surface_uncertainty"; // uncertainty surfaced or resolved

export interface AuditEvent {
  ts: string;
  kind: AuditEventKind;
  task_id?: string;
  detail: Record<string, unknown>;
}

export interface AuditSummary {
  total: number;
  by_kind: Partial<Record<AuditEventKind, number>>;
  events: AuditEvent[];
}

function pathFor(repoRoot: string): string {
  return join(repoRoot, AUDIT_FILE);
}

export async function appendAuditEvent(repoRoot: string, event: AuditEvent): Promise<void> {
  try {
    const path = pathFor(repoRoot);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, JSON.stringify(event) + "\n", "utf8");
  } catch {
    /* swallow — audit log is best-effort */
  }
}

export async function readAuditLog(repoRoot: string, limit = 100): Promise<AuditSummary> {
  const path = pathFor(repoRoot);
  let raw = "";
  try {
    await access(path);
    raw = await readFile(path, "utf8");
  } catch {
    return { total: 0, by_kind: {}, events: [] };
  }

  const all: AuditEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      all.push(JSON.parse(line) as AuditEvent);
    } catch { /* skip malformed */ }
  }

  const by_kind: Partial<Record<AuditEventKind, number>> = {};
  for (const e of all) {
    by_kind[e.kind] = (by_kind[e.kind] ?? 0) + 1;
  }

  const events = all.slice(-limit);

  return { total: all.length, by_kind, events };
}

export function auditSummaryLine(summary: AuditSummary): string {
  if (summary.total === 0) return "Audit log: no events recorded.";
  const parts = (Object.entries(summary.by_kind) as [AuditEventKind, number][])
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${k}`)
    .join(", ");
  return `Audit log: ${summary.total} events — ${parts}`;
}
