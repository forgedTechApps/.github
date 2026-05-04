import { readFile, writeFile, access, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { minimatch } from "minimatch";
import type { Finding } from "./check-ci.js";
import type { AgentStandards } from "./standards.js";

/**
 * Hypothesis-first task tracking. Persisted in <repo_root>/.agent-standards-tasks.json
 * (gitignored). Three tools:
 *
 *   start_task        — record the agent's hypothesis about what needs changing
 *                       and which files it expects to read/write.
 *   propose_change    — before writing, validate that the proposed write paths
 *                       are within scope of the hypothesis. Hard mode blocks
 *                       on out-of-scope writes; soft mode warns.
 *   commit_checkpoint — record progress: which files were actually read/written.
 *                       Used by future tools to compute read/write ratio etc.
 *
 * Scope is intentionally bounded — this isn't a full audit log, it's a
 * lightweight "did the work match the plan" check.
 */

const TASKS_FILE = ".agent-standards-tasks.json";
const MAX_TASKS = 50; // rolling buffer

export interface TaskRecord {
  id: string;
  created_at: string;
  closed_at?: string;
  description: string;
  hypothesis: string;
  expected_reads: string[];
  expected_writes: string[];
  actual_reads: string[];
  actual_writes: string[];
  notes: string[];
}

interface TasksFile {
  active_task_id?: string;
  tasks: TaskRecord[];
}

function pathFor(repoRoot: string): string {
  return join(repoRoot, TASKS_FILE);
}

async function load(repoRoot: string): Promise<TasksFile> {
  const path = pathFor(repoRoot);
  try {
    await access(path);
    return JSON.parse(await readFile(path, "utf8")) as TasksFile;
  } catch {
    return { tasks: [] };
  }
}

async function save(repoRoot: string, data: TasksFile): Promise<void> {
  const path = pathFor(repoRoot);
  // Trim
  if (data.tasks.length > MAX_TASKS) {
    data.tasks = data.tasks.slice(data.tasks.length - MAX_TASKS);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

// ─── start_task ────────────────────────────────────────────────────────────

export interface StartTaskArgs {
  description: string;
  hypothesis: string;
  expected_reads?: string[];
  expected_writes?: string[];
}

export interface StartTaskResult {
  task_id: string;
  message: string;
}

export async function startTask(repoRoot: string, args: StartTaskArgs): Promise<StartTaskResult> {
  const data = await load(repoRoot);
  const task: TaskRecord = {
    id: randomUUID().slice(0, 8),
    created_at: new Date().toISOString(),
    description: args.description,
    hypothesis: args.hypothesis,
    expected_reads: args.expected_reads ?? [],
    expected_writes: args.expected_writes ?? [],
    actual_reads: [],
    actual_writes: [],
    notes: [],
  };
  data.tasks.push(task);
  data.active_task_id = task.id;
  await save(repoRoot, data);
  return {
    task_id: task.id,
    message: `Task ${task.id} started. Hypothesis recorded; expected reads=${task.expected_reads.length}, expected writes=${task.expected_writes.length}.`,
  };
}

// ─── propose_change ────────────────────────────────────────────────────────

export interface ProposeChangeArgs {
  task_id?: string; // defaults to active task
  paths: string[];
  rationale: string;
}

export async function proposeChange(
  repoRoot: string,
  args: ProposeChangeArgs,
  standards: AgentStandards
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const data = await load(repoRoot);
  const id = args.task_id ?? data.active_task_id;
  if (!id) {
    findings.push({
      severity: "warn",
      code: "TASK_NO_ACTIVE",
      message: "No active task. Call start_task first to record a hypothesis.",
    });
    return findings;
  }

  const task = data.tasks.find((t) => t.id === id);
  if (!task) {
    findings.push({
      severity: "error",
      code: "TASK_NOT_FOUND",
      message: `Task ${id} not found.`,
    });
    return findings;
  }

  const mode = standards.investigation?.mode ?? "soft";

  // For each proposed path, check if it's within expected_writes (glob match).
  for (const path of args.paths) {
    const matches = task.expected_writes.some((pat) => minimatch(path, pat));
    if (!matches) {
      findings.push({
        severity: mode === "hard" ? "error" : "warn",
        code: "TASK_OUT_OF_SCOPE_WRITE",
        message: `Proposed write '${path}' is not in task ${id}'s expected_writes ${JSON.stringify(task.expected_writes)}.`,
        fix: mode === "hard"
          ? "Either update the task scope (note + re-state expected_writes) or revisit whether this change belongs in a different task."
          : "Document why scope is widening (the agent should append a note via commit_checkpoint).",
      });
    }
  }

  // Append notes documenting the proposal — keeps an audit trail
  task.notes.push(`[${new Date().toISOString()}] propose_change: ${args.rationale} :: paths=${JSON.stringify(args.paths)}`);
  await save(repoRoot, data);

  if (findings.length === 0) {
    findings.push({
      severity: "info",
      code: "TASK_PROPOSE_OK",
      message: `Proposed paths fit within task ${id} scope.`,
    });
  }

  return findings;
}

// ─── commit_checkpoint ─────────────────────────────────────────────────────

export interface CommitCheckpointArgs {
  task_id?: string;
  reads?: string[];
  writes?: string[];
  note?: string;
  close?: boolean;
}

export interface CommitCheckpointResult {
  task_id: string;
  reads_total: number;
  writes_total: number;
  read_write_ratio: number | null;
  closed: boolean;
}

export async function commitCheckpoint(
  repoRoot: string,
  args: CommitCheckpointArgs
): Promise<CommitCheckpointResult> {
  const data = await load(repoRoot);
  const id = args.task_id ?? data.active_task_id;
  if (!id) throw new Error("No active task; call start_task first.");
  const task = data.tasks.find((t) => t.id === id);
  if (!task) throw new Error(`Task ${id} not found.`);

  if (args.reads) task.actual_reads.push(...args.reads);
  if (args.writes) task.actual_writes.push(...args.writes);
  if (args.note) task.notes.push(`[${new Date().toISOString()}] ${args.note}`);
  if (args.close) {
    task.closed_at = new Date().toISOString();
    if (data.active_task_id === id) data.active_task_id = undefined;
  }
  await save(repoRoot, data);

  const reads = task.actual_reads.length;
  const writes = task.actual_writes.length;
  return {
    task_id: id,
    reads_total: reads,
    writes_total: writes,
    read_write_ratio: writes === 0 ? null : reads / writes,
    closed: !!task.closed_at,
  };
}
