#!/usr/bin/env node
/**
 * Claude Code SessionStart hook.
 *
 * Outputs `additionalContext` with the project's model routing + active task
 * state. Helps the agent see at session start: what phase the active task is
 * in, what model family is expected, and where state lives.
 *
 * Does NOT detect the actual running model — that would require API
 * metadata not visible to the hook. Honour-system limit acknowledged.
 *
 * Read sources:
 *   - $CLAUDE_PROJECT_DIR/.agent-standards.yml (models block, gates block)
 *   - $CLAUDE_PROJECT_DIR/.agent-standards-tasks.json (active task)
 *
 * Output: prints a single JSON object to stdout, exit 0.
 *
 * Failure mode: any read/parse error → exit 0 with empty output (silent).
 * The hook must never block a session because of its own bugs.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

function readMaybe(path) {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
}

// Tiny YAML extractor — only pulls top-level keys we need. Avoids depending
// on a YAML parser, since hooks need to be zero-install.
function grepYamlValue(yaml, dottedPath) {
  // Supports "models.planning.model" by walking indentation. Returns the
  // first string/scalar value or null.
  const segments = dottedPath.split(".");
  const lines = yaml.split("\n");
  let depth = 0;
  let i = 0;
  for (const seg of segments) {
    const indentRegex = new RegExp(`^${" ".repeat(depth)}${seg}\\s*:\\s*(.*)$`);
    let found = false;
    while (i < lines.length) {
      const line = lines[i];
      const m = line.match(indentRegex);
      if (m) {
        if (m[1].trim().length > 0) {
          // scalar value on same line
          return m[1].trim().replace(/^["']|["']$/g, "");
        }
        // nested — walk deeper next iteration
        depth += 2;
        i++;
        found = true;
        break;
      }
      i++;
    }
    if (!found) return null;
  }
  return null;
}

const standardsPath = join(PROJECT_DIR, ".agent-standards.yml");
const tasksPath = join(PROJECT_DIR, ".agent-standards-tasks.json");

const standardsYaml = readMaybe(standardsPath);
const tasksRaw = readMaybe(tasksPath);

// Silent exit if there's nothing useful to say (project doesn't use agent-standards).
if (!standardsYaml) {
  process.exit(0);
}

const planningModel = grepYamlValue(standardsYaml, "models.planning.model") ?? "opus";
const planningEffort = grepYamlValue(standardsYaml, "models.planning.effort");
const executionModel = grepYamlValue(standardsYaml, "models.execution.model") ?? "sonnet";

let activeBlock = "";
if (tasksRaw) {
  try {
    const tasks = JSON.parse(tasksRaw);
    if (tasks.active_task_id) {
      const task = (tasks.tasks ?? []).find((t) => t.id === tasks.active_task_id);
      if (task && !task.closed_at) {
        const expected = task.phase === "execution" ? executionModel : planningModel;
        activeBlock =
          `\n**Active task: ${task.id}**\n` +
          `- phase: \`${task.phase}\`\n` +
          `- expected model: \`${expected}\`\n` +
          `- description: ${task.description}\n` +
          (task.scope_statement ? `- scope: ${task.scope_statement}\n` : "") +
          (task.files_intended?.length
            ? `- files_intended (${task.files_intended.length}): ${task.files_intended.slice(0, 4).join(", ")}${task.files_intended.length > 4 ? "..." : ""}\n`
            : "") +
          `- declared_model: \`${task.declared_model ?? "(not set)"}\``;
      }
    }
  } catch {
    // ignore parse errors
  }
}

const context =
  `## agent-standards session check\n\n` +
  `**Model routing for this project:**\n` +
  `- planning → \`${planningModel}\`${planningEffort ? ` (effort: ${planningEffort})` : ""}\n` +
  `- execution → \`${executionModel}\`\n` +
  `\n` +
  `Two-phase workflow: planning happens on \`${planningModel}\`, execution dispatched as a \`${executionModel}\` subagent.\n` +
  `Honour-system: the MCP can only verify model family if the agent declares \`current_model\` on \`start_task\` and \`propose_change\`.\n` +
  activeBlock;

process.stdout.write(JSON.stringify({ additionalContext: context }));
process.exit(0);
