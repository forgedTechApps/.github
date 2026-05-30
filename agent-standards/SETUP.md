# agent-standards — per-developer setup

The agent-standards MCP server and session hooks are wired into each project via
`.mcp.json` and `.claude/settings.json`. Those files are **committed and shared**, so
they must be portable — they reference the server by an environment variable, not a
hardcoded path.

You set that variable **once**, then every project's config works on your machine.

## The one variable: `AGENT_STANDARDS_HOME`

Point it at your local clone of the `forgedtech/.github` repo (the directory that
contains `mcp-server/` and `agent-standards/`):

```
AGENT_STANDARDS_HOME = <your clone>/.github      # the dir containing mcp-server/ and agent-standards/
```

Committed configs expand it at launch, e.g.:

```json
"args": ["${AGENT_STANDARDS_HOME}/mcp-server/dist/index.js", "--repo-root", "${PWD}", "--name", "agent-standards/<repo>"]
```

`${PWD}` resolves to the project you're working in, so `--repo-root` is always correct
without hardcoding.

## Where to set it

### Recommended — Claude user settings (`~/.claude/settings.json`)

Most reliable: it reaches the MCP launch and hooks regardless of how Claude Code was
started (terminal, IDE, app).

```json
{
  "env": {
    "AGENT_STANDARDS_HOME": "/Users/you/Development/forgedtech"
  }
}
```

(Merge into your existing `~/.claude/settings.json` — don't overwrite it.)

### Fallback — shell profile (`~/.zshrc` / `~/.bashrc`)

Works when Claude Code inherits your shell environment (terminal launches):

```sh
export AGENT_STANDARDS_HOME="$HOME/Development/forgedtech"
```

## One-time build

The MCP server runs from compiled output. After cloning (and after pulling server
changes):

```sh
cd "$AGENT_STANDARDS_HOME/mcp-server" && pnpm install && pnpm build
```

## Verify

From any project that has the agent-standards MCP wired, start a session and confirm the
server connects (the `mcp__agent-standards__*` tools are available). A quick headless
check:

```sh
AGENT_STANDARDS_HOME=<your path> claude --mcp-config .mcp.json -p "List the mcp__agent-standards tools available."
```

If the server fails to connect, check: (1) `AGENT_STANDARDS_HOME` is set in the
environment Claude Code sees, (2) `mcp-server/dist/index.js` exists (run the build), (3)
the path has no typo.

## Notes

- **`settings.local.json`** is per-developer and gitignored — put machine-specific or
  personal overrides there, never in the committed `settings.json`.
- **`.claude/skills/`** symlinks are machine-specific (absolute paths) and gitignored —
  each clone re-creates them locally.
- **Future:** once `@forgedtech/agent-standards-mcp` is published, configs can switch to
  `npx -y @forgedtech/agent-standards-mcp` and this env var goes away. Tracked separately.
