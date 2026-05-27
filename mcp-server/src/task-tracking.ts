import { readFile, writeFile, access, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { minimatch } from "minimatch";
import type { Finding } from "./check-ci.js";
import { classifyModel, type AgentStandards, type Phase } from "./standards.js";

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
  phase: Phase;
  declared_model?: string;
  expected_reads: string[];
  expected_writes: string[];
  actual_reads: string[];
  actual_writes: string[];
  notes: string[];
  // ── Definition-of-ready (Increment 2) — populated when DoR gate is enabled ──
  scope_statement?: string;
  files_intended?: string[];
  test_approach?: string;
  definition_of_done?: string;
  out_of_scope?: string[];
  size?: "trivial" | "standard" | "large";
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
  phase?: Phase;
  current_model?: string; // agent-declared, e.g. "claude-opus-4-7"
  expected_reads?: string[];
  expected_writes?: string[];
  // ── Definition-of-ready (Increment 2) ──
  scope_statement?: string;
  files_intended?: string[];
  test_approach?: string;
  definition_of_done?: string;
  out_of_scope?: string[];
  size?: "trivial" | "standard" | "large";
}

export interface StartTaskResult {
  task_id: string;
  phase: Phase;
  recommended_model?: { model: string; effort?: string };
  blocked: boolean;
  message: string;
  /** When the DoR gate fires, lists the field names that were missing. */
  dor_missing_fields?: string[];
}

/** Default required DoR fields; project can override via standards.gates.definition_of_ready.required_fields. */
const DEFAULT_DOR_REQUIRED = [
  "scope_statement",
  "files_intended",
  "test_approach",
  "definition_of_done",
  "out_of_scope",
] as const;

type DorField = (typeof DEFAULT_DOR_REQUIRED)[number];

/** Returns the missing DoR fields, or [] if all required fields are present. */
function checkDoR(args: StartTaskArgs, required: readonly DorField[]): DorField[] {
  const missing: DorField[] = [];
  for (const f of required) {
    const v = args[f];
    if (v === undefined || v === null) { missing.push(f); continue; }
    if (typeof v === "string" && v.trim().length === 0) { missing.push(f); continue; }
    if (Array.isArray(v) && v.length === 0) { missing.push(f); continue; }
  }
  return missing;
}

export async function startTask(
  repoRoot: string,
  args: StartTaskArgs,
  standards: AgentStandards,
): Promise<StartTaskResult> {
  const phase: Phase = args.phase ?? "planning";
  const expected = standards.models?.[phase];
  const declared = classifyModel(args.current_model);

  // Block if the agent declared a model that doesn't match the phase's expected family.
  // Default policy: block. Agent can override by dispatching a subagent on the right model.
  let blocked = false;
  let blockMessage: string | undefined;
  if (expected && declared && declared !== expected.model) {
    blocked = true;
    blockMessage =
      `Phase '${phase}' expects model family '${expected.model}'${expected.effort ? ` (effort: ${expected.effort})` : ""}, ` +
      `but current_model='${args.current_model}' resolves to '${declared}'. ` +
      `Dispatch a subagent: Agent({ model: "claude-${expected.model}-...", description: "...", prompt: "..." }). ` +
      `If you intend to bypass, omit current_model — the MCP can't enforce what isn't declared.`;
  }

  if (blocked) {
    return {
      task_id: "",
      phase,
      recommended_model: expected ? { model: expected.model, effort: expected.effort } : undefined,
      blocked: true,
      message: blockMessage!,
    };
  }

  // ── Definition-of-ready gate (Increment 2) ─────────────────────────────────
  // Fires on phase='execution' when the project has opted in and size != trivial.
  const dorEnabled = standards.gates?.definition_of_ready?.enabled === true;
  const dorRequired = (standards.gates?.definition_of_ready?.required_fields ?? DEFAULT_DOR_REQUIRED) as readonly DorField[];
  const size = args.size ?? "standard";
  if (dorEnabled && phase === "execution" && size !== "trivial") {
    const missing = checkDoR(args, dorRequired);
    if (missing.length > 0) {
      return {
        task_id: "",
        phase,
        recommended_model: expected ? { model: expected.model, effort: expected.effort } : undefined,
        blocked: true,
        message:
          `TASK_DOR_INCOMPLETE: phase='execution' requires definition-of-ready fields ` +
          `[${missing.join(", ")}]. Fill them on the planning side before transitioning, or pass size='trivial' ` +
          `to bypass (the bypass is logged). Required by this project's gates.definition_of_ready.enabled.`,
        dor_missing_fields: missing,
      };
    }
  }

  const data = await load(repoRoot);
  const task: TaskRecord = {
    id: randomUUID().slice(0, 8),
    created_at: new Date().toISOString(),
    description: args.description,
    hypothesis: args.hypothesis,
    phase,
    declared_model: args.current_model,
    expected_reads: args.expected_reads ?? [],
    expected_writes: args.expected_writes ?? [],
    actual_reads: [],
    actual_writes: [],
    notes: [],
    scope_statement: args.scope_statement,
    files_intended: args.files_intended,
    test_approach: args.test_approach,
    definition_of_done: args.definition_of_done,
    out_of_scope: args.out_of_scope,
    size: args.size,
  };
  if (dorEnabled && phase === "execution" && size === "trivial") {
    task.notes.push(`[${new Date().toISOString()}] DoR bypassed via size='trivial'.`);
  }
  data.tasks.push(task);
  data.active_task_id = task.id;
  await save(repoRoot, data);

  const tips: string[] = [];
  if (!declared) {
    tips.push("Tip: pass current_model so the MCP can verify model/phase alignment. Without it, alignment is advisory only.");
  }
  if (expected) {
    tips.push(`Phase '${phase}' uses model='${expected.model}'${expected.effort ? ` effort='${expected.effort}'` : ""}.`);
  }
  if (dorEnabled && phase === "planning") {
    tips.push("DoR gate is enabled — fill scope_statement / files_intended / test_approach / definition_of_done / out_of_scope before transitioning to execution.");
  }

  return {
    task_id: task.id,
    phase,
    recommended_model: expected ? { model: expected.model, effort: expected.effort } : undefined,
    blocked: false,
    message: `Task ${task.id} started (phase=${phase}). ${tips.join(" ")}`,
  };
}

// ─── propose_change ────────────────────────────────────────────────────────

export interface ProposeChangeArgs {
  task_id?: string; // defaults to active task
  paths: string[];
  rationale: string;
  current_model?: string; // agent-declared, for execution-phase model check
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

  // Model/phase check: writes happen in the execution phase. If the task is
  // in 'planning' phase but the agent is now writing, that's a phase mismatch
  // — the agent should have transitioned (via start_task with phase=execution
  // on a Sonnet subagent).
  const declared = classifyModel(args.current_model);
  const expected = standards.models?.execution;
  if (declared && expected && declared !== expected.model) {
    findings.push({
      severity: "error",
      code: "TASK_WRONG_MODEL_FOR_EXECUTION",
      message:
        `Writes (execution phase) expect model family '${expected.model}', ` +
        `but current_model='${args.current_model}' resolves to '${declared}'. ` +
        `Dispatch a subagent: Agent({ model: "claude-${expected.model}-...", ... }).`,
      fix: "Stop writing from the planning model. Hand off to an execution subagent.",
    });
  }
  if (task.phase === "planning" && (args.paths?.length ?? 0) > 0) {
    findings.push({
      severity: mode === "hard" ? "error" : "warn",
      code: "TASK_PLANNING_PHASE_WRITE",
      message: `Task ${id} is in 'planning' phase but propose_change is being called with ${args.paths.length} path(s). Plans don't write code — start a new task with phase='execution' on the execution model.`,
      fix: "If the plan is approved and ready to execute, call start_task again with phase='execution' and current_model from the execution subagent.",
    });
  }

  // ── Scope-expansion gate (Increment 3) ───────────────────────────────────
  // When enabled + the active task has files_intended (from DoR), block any
  // proposed path that doesn't match. Stronger than TASK_OUT_OF_SCOPE_WRITE:
  // always errors, regardless of investigation.mode, and instructs the agent
  // to call expand_scope to unblock.
  const scopeGate = standards.gates?.scope_expansion?.enabled === true;
  const filesIntended = task.files_intended ?? [];
  if (scopeGate && filesIntended.length > 0) {
    for (const path of args.paths) {
      const matches = filesIntended.some((pat) => minimatch(path, pat));
      if (!matches) {
        findings.push({
          severity: "error",
          code: "TASK_SCOPE_EXPANSION",
          message:
            `Proposed write '${path}' is not in task ${id}'s files_intended ${JSON.stringify(filesIntended)}. ` +
            `Scope-expansion gate blocks this write.`,
          fix:
            `Call expand_scope({ task_id: '${id}', path: '${path}', reason: '<why>', user_confirmed: true }) ` +
            `after explicitly asking the user. If they decline, revert and complete the original scope first.`,
        });
      }
    }
  }

  // Legacy expected_writes check (kept for non-canary projects without the gate).
  // Suppressed when the scope-expansion gate is firing — it would double-report.
  if (!scopeGate) {
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

// ─── expand_scope ──────────────────────────────────────────────────────────

export interface ExpandScopeArgs {
  task_id?: string;
  /** Path or glob to add to the active task's files_intended. */
  path: string;
  /** Why the original plan didn't cover this file. */
  reason: string;
  /**
   * The user has explicitly approved adding this path. The MCP server can't
   * actually see user confirmation — this is agent-declared and logged.
   * Without it, expand_scope refuses; with it, the agent is asserting "I asked,
   * the user said yes".
   */
  user_confirmed: boolean;
}

export interface ExpandScopeResult {
  task_id: string;
  files_intended: string[];
  blocked: boolean;
  message: string;
}

export async function expandScope(
  repoRoot: string,
  args: ExpandScopeArgs
): Promise<ExpandScopeResult> {
  const data = await load(repoRoot);
  const id = args.task_id ?? data.active_task_id;
  if (!id) {
    return {
      task_id: "",
      files_intended: [],
      blocked: true,
      message: "No active task. Call start_task first.",
    };
  }
  const task = data.tasks.find((t) => t.id === id);
  if (!task) {
    return {
      task_id: id,
      files_intended: [],
      blocked: true,
      message: `Task ${id} not found.`,
    };
  }
  if (!args.user_confirmed) {
    return {
      task_id: id,
      files_intended: task.files_intended ?? [],
      blocked: true,
      message:
        "expand_scope requires user_confirmed=true. The scope-expansion gate exists " +
        "to make scope creep deliberate — ask the user before declaring confirmation. " +
        "If they decline, revert and complete the original scope first.",
    };
  }

  task.files_intended = [...(task.files_intended ?? []), args.path];
  task.notes.push(
    `[${new Date().toISOString()}] expand_scope: added '${args.path}' — ${args.reason} (user_confirmed=true)`
  );
  await save(repoRoot, data);

  return {
    task_id: id,
    files_intended: task.files_intended,
    blocked: false,
    message: `Added '${args.path}' to task ${id}'s files_intended.`,
  };
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
