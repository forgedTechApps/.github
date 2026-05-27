#!/usr/bin/env node
/**
 * Claude Code PreCompact hook.
 *
 * Before context compaction (auto or user-invoked /compact), dumps:
 *   - Active task state (description, scope, files_intended, hypothesis)
 *   - Last 20 drift-log entries
 *   - Recent task notes
 * into $CLAUDE_PROJECT_DIR/.agent-state/pre-compact-{ISO_TIMESTAMP}.md
 *
 * Returns `additionalContext` pointing at the dump file so the post-compact
 * agent knows where to find what it might have lost.
 *
 * Read sources:
 *   - $CLAUDE_PROJECT_DIR/.agent-standards-tasks.json
 *   - $CLAUDE_PROJECT_DIR/.agent-standards-drift.jsonl
 *
 * Failure mode: any read/parse/write error → exit 0 with empty output.
 * The hook must never block compaction because of its own bugs.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

function readMaybe(path) {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
}

const tasksRaw = readMaybe(join(PROJECT_DIR, ".agent-standards-tasks.json"));
const driftRaw = readMaybe(join(PROJECT_DIR, ".agent-standards-drift.jsonl"));

if (!tasksRaw && !driftRaw) {
  // Nothing to preserve — project doesn't use agent-standards.
  process.exit(0);
}

let task = null;
try {
  if (tasksRaw) {
    const tasks = JSON.parse(tasksRaw);
    if (tasks.active_task_id) {
      task = (tasks.tasks ?? []).find((t) => t.id === tasks.active_task_id) ?? null;
    }
  }
} catch {}

const driftLines = [];
if (driftRaw) {
  // JSONL — take last 20 entries
  const lines = driftRaw.trim().split("\n").filter(Boolean);
  for (const line of lines.slice(-20)) {
    try {
      driftLines.push(JSON.parse(line));
    } catch {}
  }
}

const now = new Date();
const stampForFile = now.toISOString().replace(/[:.]/g, "-");
const stateDir = join(PROJECT_DIR, ".agent-state");
const dumpPath = join(stateDir, `pre-compact-${stampForFile}.md`);

let body = `# Pre-compact state dump\n\n`;
body += `Written: ${now.toISOString()}\n`;
body += `Project: ${PROJECT_DIR}\n\n`;

if (task) {
  body += `## Active task: ${task.id}\n\n`;
  body += `- **phase**: ${task.phase}\n`;
  body += `- **created_at**: ${task.created_at}\n`;
  body += `- **declared_model**: ${task.declared_model ?? "(not set)"}\n`;
  body += `- **description**: ${task.description}\n`;
  body += `- **hypothesis**: ${task.hypothesis}\n`;
  if (task.scope_statement) body += `- **scope_statement**: ${task.scope_statement}\n`;
  if (task.test_approach) body += `- **test_approach**: ${task.test_approach}\n`;
  if (task.definition_of_done) body += `- **definition_of_done**: ${task.definition_of_done}\n`;
  if (task.files_intended?.length) {
    body += `\n**files_intended:**\n`;
    for (const f of task.files_intended) body += `- ${f}\n`;
  }
  if (task.out_of_scope?.length) {
    body += `\n**out_of_scope:**\n`;
    for (const f of task.out_of_scope) body += `- ${f}\n`;
  }
  if (task.notes?.length) {
    body += `\n**Notes (most recent first):**\n`;
    for (const n of task.notes.slice(-10).reverse()) body += `- ${n}\n`;
  }
  if (task.actual_reads?.length || task.actual_writes?.length) {
    body += `\n**Progress:**\n`;
    body += `- reads: ${task.actual_reads?.length ?? 0}\n`;
    body += `- writes: ${task.actual_writes?.length ?? 0}\n`;
  }
  body += `\n`;
} else {
  body += `## Active task\n\nNo active task at compaction time.\n\n`;
}

if (driftLines.length > 0) {
  body += `## Recent drift-log (last ${driftLines.length} entries)\n\n`;
  for (const entry of driftLines) {
    body += `- \`${entry.timestamp ?? "?"}\` [${entry.source ?? "?"}] ${entry.code ?? ""}: ${(entry.message ?? "").slice(0, 200)}\n`;
  }
  body += `\n`;
}

body += `---\n\n`;
body += `*This dump exists so post-compact agents can recover load-bearing state. `;
body += `If a finding above conflicts with current conversation context, trust the current conversation.*\n`;

try {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(dumpPath, body, "utf8");
} catch {
  // Couldn't write — exit silently. The hook must not block compaction.
  process.exit(0);
}

const context =
  `## agent-standards: pre-compact state preserved\n\n` +
  `Active task + recent drift-log dumped to:\n\n` +
  `  \`${dumpPath}\`\n\n` +
  `After compaction, read that file if you need to recover ` +
  `${task ? `the active task '${task.id}' state` : "any pre-compaction findings"}.`;

process.stdout.write(JSON.stringify({ additionalContext: context }));
process.exit(0);
