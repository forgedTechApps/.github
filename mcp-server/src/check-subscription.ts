import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import type { Finding } from "./check-ci.js";

/**
 * Subscription / wiring health check.
 *
 * Verifies a project is fully + correctly wired into the agent-standards
 * framework. Every gap here is binary and mechanically checkable — this is
 * the onboarding-verify tool: one call tells you a repo is correctly set up,
 * and catches drift after the fact.
 *
 * Assertions:
 *   1. `.agent-standards.yml` exists and `extends: forgedtech/org-defaults`.
 *   2. `CLAUDE.md` exists and references the org template / agent-standards.
 *   3. `.mcp.json` wires the agent-standards MCP server.
 *   4. The agent-standards server is NOT also configured in
 *      `.claude/settings.json` — duplicate config hangs Claude Code on init
 *      (known footgun; see memory feedback_mcp_config_no_duplicates).
 *   5. MCP wiring is portable — uses ${AGENT_STANDARDS_HOME}, not an absolute
 *      /Users|/home path that breaks on a teammate's machine.
 *   6. The interview-me skill is present (`.claude/skills/interview-me`).
 *   7. `.gitignore` ignores `.claude/settings.local.json` (the personal file).
 *
 * Findings are warn (a project can function with a gap, but shouldn't ship
 * one). SUBSCRIPTION_OK when everything is wired.
 */

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/** Absolute-path patterns that indicate non-portable wiring. */
const ABSOLUTE_PATH = /["'](?:\/Users\/|\/home\/|[A-Z]:\\)/;

export async function checkSubscription(repoRoot: string): Promise<Finding[]> {
  const findings: Finding[] = [];

  // 1. .agent-standards.yml extends org-defaults
  const standardsYml = await readIfExists(join(repoRoot, ".agent-standards.yml"));
  if (standardsYml === null) {
    findings.push({
      severity: "warn",
      code: "SUBSCRIPTION_NO_STANDARDS_FILE",
      message: "No .agent-standards.yml — this repo isn't subscribed to org standards.",
      fix: "Run init_repo, or add `.agent-standards.yml` with `extends: forgedtech/org-defaults`.",
    });
  } else if (!/extends:\s*\S*forgedtech\/org-defaults/.test(standardsYml)) {
    findings.push({
      severity: "warn",
      code: "SUBSCRIPTION_NOT_EXTENDING_ORG",
      message: ".agent-standards.yml does not `extends: forgedtech/org-defaults` — org-wide rules won't apply.",
      fix: "Add `extends: forgedtech/org-defaults` to .agent-standards.yml.",
    });
  }

  // 2. CLAUDE.md exists + references the framework
  const claudeMd = await readIfExists(join(repoRoot, "CLAUDE.md"));
  if (claudeMd === null) {
    findings.push({
      severity: "warn",
      code: "SUBSCRIPTION_NO_CLAUDE_MD",
      message: "No CLAUDE.md — the workflow conventions + project rules aren't surfaced to the agent.",
      fix: "Add a CLAUDE.md (start from agent-standards/templates/CLAUDE.md.template).",
    });
  } else if (!/(agent-standards|org-defaults|CLAUDE\.md\.template|PRINCIPLES\.md)/.test(claudeMd)) {
    findings.push({
      severity: "warn",
      code: "SUBSCRIPTION_CLAUDE_MD_UNLINKED",
      message: "CLAUDE.md doesn't reference the org template or agent-standards — it may be drifting from the shared conventions.",
      fix: "Link agent-standards/templates/CLAUDE.md.template (workflow) + PRINCIPLES.md.",
    });
  }

  // 3. + 4. + 5. MCP wiring: present, not duplicated, portable
  const mcpJson = await readIfExists(join(repoRoot, ".mcp.json"));
  const settingsJson = await readIfExists(join(repoRoot, ".claude/settings.json"));

  const mcpHasAgentStandards = mcpJson !== null && /agent-standards/.test(mcpJson);
  const settingsHasMcpServers = settingsJson !== null && /"mcpServers"/.test(settingsJson);

  if (!mcpHasAgentStandards && !settingsHasMcpServers) {
    findings.push({
      severity: "warn",
      code: "SUBSCRIPTION_NO_MCP_WIRING",
      message: "agent-standards MCP server isn't wired (no .mcp.json mcpServers entry).",
      fix: "Add the agent-standards server to .mcp.json (see agent-standards/SETUP.md).",
    });
  }

  // 4. Duplicate config hangs Claude Code on init.
  if (mcpHasAgentStandards && settingsHasMcpServers) {
    findings.push({
      severity: "warn",
      code: "SUBSCRIPTION_DUPLICATE_MCP_CONFIG",
      message: "agent-standards MCP is configured in BOTH .mcp.json and .claude/settings.json mcpServers — duplicate config hangs Claude Code on init.",
      fix: "Keep the MCP server in .mcp.json only; remove the mcpServers block from .claude/settings.json.",
    });
  }

  // 5. Portability — absolute paths in committed MCP wiring break teammates.
  if (mcpJson !== null && ABSOLUTE_PATH.test(mcpJson)) {
    findings.push({
      severity: "warn",
      code: "SUBSCRIPTION_MCP_NOT_PORTABLE",
      message: ".mcp.json uses an absolute path (e.g. /Users/...) — broken on any other machine.",
      fix: "Use ${AGENT_STANDARDS_HOME}/mcp-server/dist/index.js + ${PWD} for --repo-root. See agent-standards/SETUP.md.",
    });
  }

  // 6. interview-me skill present
  const interviewMe = await exists(join(repoRoot, ".claude/skills/interview-me/SKILL.md"));
  if (!interviewMe) {
    findings.push({
      severity: "warn",
      code: "SUBSCRIPTION_NO_INTERVIEW_ME",
      message: "interview-me skill not found at .claude/skills/interview-me — the planning interview won't be available.",
      fix: "Symlink the canonical skill: ln -s <forgedtech>/agent-standards/skills/interview-me .claude/skills/interview-me",
    });
  }

  // 7. gitignore hygiene — personal file must be ignored
  const gitignore = await readIfExists(join(repoRoot, ".gitignore"));
  const localIgnoredGlobally = gitignore !== null && /\.claude\/settings\.local\.json/.test(gitignore);
  // Only flag if a settings.local.json exists AND isn't ignored by this repo's .gitignore.
  const hasLocalSettings = await exists(join(repoRoot, ".claude/settings.local.json"));
  if (hasLocalSettings && !localIgnoredGlobally) {
    findings.push({
      severity: "warn",
      code: "SUBSCRIPTION_LOCAL_SETTINGS_NOT_IGNORED",
      message: ".claude/settings.local.json exists but isn't in .gitignore — a teammate could commit their personal/machine-specific settings.",
      fix: "Add `.claude/settings.local.json` to .gitignore (don't rely on a global excludesfile).",
    });
  }

  if (findings.length === 0) {
    findings.push({
      severity: "info",
      code: "SUBSCRIPTION_OK",
      message: "Project is correctly wired: standards extend org-defaults, CLAUDE.md present, MCP wired (single source, portable), interview-me available, gitignore hygiene ok.",
    });
  }

  return findings;
}
