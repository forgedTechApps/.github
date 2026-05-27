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
  // ── Auth-change ASVS artifact (Increment 5) ──
  asvs_review?: AsvsReview;
  // ── Task classification + bugfix root cause (Increment 8.5) ──
  task_type?: TaskType;
  root_cause?: string;
  // ── Surface uncertainty (Increment 8.5) ──
  uncertainties?: SurfacedUncertainty[];
  // ── Reversibility (Beyond-W15, W19) ──
  reversibility?: Reversibility;
}

export type Reversibility = "easy" | "moderate" | "hard";

export type TaskType = "feature" | "bugfix" | "architecture" | "auth_change" | "trivial";

export type UncertaintyCategory =
  | "ambiguous_spec"
  | "unknown_dependency"
  | "conflicting_rule"
  | "unexpected_state";

export interface SurfacedUncertainty {
  category: UncertaintyCategory;
  description: string;
  proposed_options: string[];
  surfaced_at: string;
  resolved_at?: string;
  resolution?: string;
}

export interface AsvsReview {
  /** ASVS L1 control IDs touched, e.g. ["V2.1.1", "V3.4.1"]. */
  controls_touched: string[];
  /** What was checked, and how. Free text. */
  verification: string;
  /** Who or what reviewed (agent name, person, automated tool). */
  reviewer: string;
  attached_at: string;
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
  // ── Task classification + bugfix root cause (Increment 8.5) ──
  task_type?: TaskType;
  root_cause?: string;
  // ── Reversibility (Beyond-W15, W19) ──
  reversibility?: Reversibility;
}

export interface StartTaskResult {
  task_id: string;
  phase: Phase;
  recommended_model?: { model: string; effort?: string };
  blocked: boolean;
  message: string;
  /** When the DoR gate fires, lists the field names that were missing. */
  dor_missing_fields?: string[];
  /** When the bugfix_root_cause gate fires. */
  root_cause_missing?: boolean;
}

const ROOT_CAUSE_PLACEHOLDERS = new Set(["", "unknown", "unclear", "tbd", "tba", "todo", "?"]);

function isPlausibleRootCause(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length < 10) return false; // too short to be a real cause
  if (ROOT_CAUSE_PLACEHOLDERS.has(trimmed)) return false;
  return true;
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

  // ── Bugfix root-cause gate (Increment 8.5) ─────────────────────────────────
  // When enabled AND task_type='bugfix', root_cause must be a plausible
  // hypothesis (≥10 chars, not a placeholder like 'unknown'/'tbd').
  const bugfixGate = standards.gates?.bugfix_root_cause?.enabled === true;
  if (bugfixGate && args.task_type === "bugfix" && !isPlausibleRootCause(args.root_cause)) {
    return {
      task_id: "",
      phase,
      recommended_model: expected ? { model: expected.model, effort: expected.effort } : undefined,
      blocked: true,
      message:
        `TASK_BUGFIX_NO_ROOT_CAUSE: task_type='bugfix' requires a plausible root_cause hypothesis ` +
        `(≥10 chars, not 'unknown'/'unclear'/'tbd'). Bug fixes that ship before the cause is ` +
        `identified produce a different class of mistake than ones with a wrong hypothesis. ` +
        `State your hypothesis even if you're not certain — the verification step in ` +
        `definition_of_done is where you confirm it.`,
      root_cause_missing: true,
    };
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
    task_type: args.task_type,
    root_cause: args.root_cause,
    reversibility: args.reversibility,
  };
  if (dorEnabled && phase === "execution" && size === "trivial") {
    task.notes.push(`[${new Date().toISOString()}] DoR bypassed via size='trivial'.`);
  }
  if (args.reversibility === "hard") {
    task.notes.push(`[${new Date().toISOString()}] HARD reversibility declared — verify rollback plan exists before any propose_change.`);
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
  if (args.reversibility === "hard") {
    tips.push("⚠️  HARD reversibility declared. Confirm with the user that the rollback plan exists before propose_change. Hard-to-reverse changes (migrations, deploys, data deletions) compound the cost of being wrong.");
  } else if (args.reversibility === "moderate") {
    tips.push("Moderate reversibility — make sure git checkpoints are clean before each propose_change.");
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

  // ── Auth-change ASVS artifact gate (Increment 5) ─────────────────────────
  // When enabled, propose_change against any auth-sensitive path requires an
  // attached asvs_review on the active task. Replaces 'mental review' with
  // an audit trail.
  const asvsGate = standards.gates?.auth_change_asvs_artifact?.enabled === true;
  if (asvsGate && !task.asvs_review) {
    const defaultAuthPaths = ["**/auth/**", "**/permissions/**", "**/session/**"];
    const authPaths = standards.gates?.auth_change_asvs_artifact?.paths ?? defaultAuthPaths;
    const matchedAuthPaths = args.paths.filter((p) =>
      authPaths.some((pat) => minimatch(p, pat))
    );
    if (matchedAuthPaths.length > 0) {
      findings.push({
        severity: "error",
        code: "TASK_AUTH_NO_ASVS_ARTIFACT",
        message:
          `Proposed write(s) ${JSON.stringify(matchedAuthPaths)} touch auth paths ` +
          `(${authPaths.join(", ")}) but task ${id} has no asvs_review attached. ` +
          `Auth changes require an ASVS L1 review artifact before merge.`,
        fix:
          `Call attach_asvs_review({ task_id: '${id}', controls_touched: ['V2.1.1', ...], ` +
          `verification: '<what you checked, how>', reviewer: '<who/what>' }) before retrying. ` +
          `ASVS L1 controls list: https://owasp.org/www-project-application-security-verification-standard/`,
      });
    }
  }

  // ── Surface-uncertainty gate (Increment 8.5) ─────────────────────────────
  // When the project is in strict mode AND there are open (unresolved)
  // uncertainties on the active task, block propose_change until they're
  // resolved via surface_uncertainty({ resolve: { description, resolution } }).
  const uncertaintyGate = standards.gates?.surface_uncertainty;
  if (uncertaintyGate?.enabled) {
    const open = (task.uncertainties ?? []).filter((u) => !u.resolved_at);
    const projectName = standards.repo?.split("/").pop() ?? "";
    const strict =
      uncertaintyGate.default_mode === "block" ||
      (uncertaintyGate.strict_mode_projects ?? []).includes(projectName);
    if (strict && open.length > 0) {
      findings.push({
        severity: "error",
        code: "TASK_OPEN_UNCERTAINTY",
        message:
          `Task ${id} has ${open.length} open uncertainty/uncertainties. ` +
          `Categories: ${open.map((u) => u.category).join(", ")}. ` +
          `Strict mode blocks propose_change until they're resolved.`,
        fix:
          `For each open item, ask the user to clarify, then call ` +
          `surface_uncertainty({ task_id: '${id}', resolve: { description: '<the original description>', resolution: '<what was decided>' } }).`,
      });
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

// ─── surface_uncertainty ───────────────────────────────────────────────────

export interface SurfaceUncertaintyArgs {
  task_id?: string;
  category: UncertaintyCategory;
  description: string;
  proposed_options?: string[];
  /** When resolving a previously-surfaced item: pass the prior description (or omit, see resolve()). */
  resolve?: { description: string; resolution: string };
}

export interface SurfaceUncertaintyResult {
  task_id: string;
  uncertainty?: SurfacedUncertainty;
  open_count: number;
  blocked: boolean;
  message: string;
}

export async function surfaceUncertainty(
  repoRoot: string,
  args: SurfaceUncertaintyArgs,
  standards: AgentStandards
): Promise<SurfaceUncertaintyResult> {
  const data = await load(repoRoot);
  const id = args.task_id ?? data.active_task_id;
  if (!id) {
    return {
      task_id: "",
      open_count: 0,
      blocked: true,
      message: "No active task. Call start_task first.",
    };
  }
  const task = data.tasks.find((t) => t.id === id);
  if (!task) {
    return {
      task_id: id,
      open_count: 0,
      blocked: true,
      message: `Task ${id} not found.`,
    };
  }

  task.uncertainties = task.uncertainties ?? [];

  // Resolve path: mark a prior uncertainty as resolved
  if (args.resolve) {
    const target = task.uncertainties.find(
      (u) => u.description === args.resolve!.description && !u.resolved_at
    );
    if (!target) {
      return {
        task_id: id,
        open_count: task.uncertainties.filter((u) => !u.resolved_at).length,
        blocked: false,
        message: `No open uncertainty matching '${args.resolve.description.slice(0, 60)}'.`,
      };
    }
    target.resolved_at = new Date().toISOString();
    target.resolution = args.resolve.resolution;
    task.notes.push(
      `[${target.resolved_at}] surface_uncertainty resolved (${target.category}): ${args.resolve.resolution}`
    );
    await save(repoRoot, data);
    return {
      task_id: id,
      uncertainty: target,
      open_count: task.uncertainties.filter((u) => !u.resolved_at).length,
      blocked: false,
      message: `Uncertainty resolved. Open count: ${task.uncertainties.filter((u) => !u.resolved_at).length}.`,
    };
  }

  // Surface path: record a new uncertainty
  const surfaced: SurfacedUncertainty = {
    category: args.category,
    description: args.description,
    proposed_options: args.proposed_options ?? [],
    surfaced_at: new Date().toISOString(),
  };
  task.uncertainties.push(surfaced);
  task.notes.push(
    `[${surfaced.surfaced_at}] surface_uncertainty (${surfaced.category}): ${args.description.slice(0, 120)}`
  );
  await save(repoRoot, data);

  const openCount = task.uncertainties.filter((u) => !u.resolved_at).length;
  const strictProjects = standards.gates?.surface_uncertainty?.strict_mode_projects ?? [];
  const projectName = standards.repo?.split("/").pop() ?? "";
  const strict =
    standards.gates?.surface_uncertainty?.default_mode === "block" ||
    strictProjects.includes(projectName);

  return {
    task_id: id,
    uncertainty: surfaced,
    open_count: openCount,
    blocked: false,
    message:
      `Uncertainty surfaced (${surfaced.category}). Open: ${openCount}. ` +
      (strict
        ? "Strict mode: propose_change will block until this is resolved via surface_uncertainty({ resolve: {...} })."
        : "Log-only mode: propose_change will continue, but findings are tracked."),
  };
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

// ─── attach_asvs_review ────────────────────────────────────────────────────

export interface AttachAsvsReviewArgs {
  task_id?: string;
  controls_touched: string[];
  verification: string;
  reviewer: string;
}

export interface AttachAsvsReviewResult {
  task_id: string;
  asvs_review?: AsvsReview;
  blocked: boolean;
  message: string;
}

export async function attachAsvsReview(
  repoRoot: string,
  args: AttachAsvsReviewArgs
): Promise<AttachAsvsReviewResult> {
  const data = await load(repoRoot);
  const id = args.task_id ?? data.active_task_id;
  if (!id) {
    return {
      task_id: "",
      blocked: true,
      message: "No active task. Call start_task first.",
    };
  }
  const task = data.tasks.find((t) => t.id === id);
  if (!task) {
    return {
      task_id: id,
      blocked: true,
      message: `Task ${id} not found.`,
    };
  }
  if (args.controls_touched.length === 0) {
    return {
      task_id: id,
      blocked: true,
      message:
        "controls_touched must list at least one ASVS L1 control (e.g. 'V2.1.1' for password length). " +
        "If the change genuinely doesn't touch any ASVS control, it probably isn't auth-changing — " +
        "reconsider whether this task needed the gate.",
    };
  }

  const review: AsvsReview = {
    controls_touched: args.controls_touched,
    verification: args.verification,
    reviewer: args.reviewer,
    attached_at: new Date().toISOString(),
  };
  task.asvs_review = review;
  task.notes.push(
    `[${review.attached_at}] attach_asvs_review: controls=[${review.controls_touched.join(", ")}], reviewer='${review.reviewer}'`
  );
  await save(repoRoot, data);

  return {
    task_id: id,
    asvs_review: review,
    blocked: false,
    message: `ASVS review attached to task ${id}.`,
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
