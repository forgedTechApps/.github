#!/usr/bin/env bash
#
# sync-and-build.sh — the "I pulled, what do I do?" script.
#
# Run from anywhere inside the forgedtech checkout. Syncs bundled org-defaults
# into mcp-server/templates/, builds the MCP server, prints next steps.
#
# Safe to run repeatedly. No destructive operations.

set -euo pipefail

# Resolve repo root from this script's location, independent of cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$REPO_ROOT"

echo "→ forgedtech sync-and-build"
echo "  repo: $REPO_ROOT"
echo

# 1. Sync bundled org-defaults so the MCP server's resolved 'extends:' target
#    matches the canonical source.
SRC="agent-standards/defaults/org-defaults.yml"
DST="mcp-server/templates/defaults/org-defaults.yml"
if [[ ! -f "$SRC" ]]; then
  echo "✗ Missing $SRC — repo state unexpected" >&2
  exit 1
fi
if cmp -s "$SRC" "$DST" 2>/dev/null; then
  echo "✓ bundled org-defaults already in sync"
else
  cp "$SRC" "$DST"
  echo "✓ bundled org-defaults synced from $SRC"
fi

# 2. Build the MCP server. Detect package manager.
cd mcp-server
if [[ -f pnpm-lock.yaml ]]; then
  PM="pnpm"
elif [[ -f package-lock.json ]]; then
  PM="npm"
elif [[ -f yarn.lock ]]; then
  PM="yarn"
else
  PM="pnpm" # default
fi

echo
echo "→ building MCP server (using $PM)..."
if ! "$PM" build 2>&1 | tail -5; then
  echo "✗ build failed" >&2
  exit 1
fi
echo "✓ MCP server built"

cd "$REPO_ROOT"

# 3. Tell the user what to do next.
cat <<'EOF'

──────────────────────────────────────────────────────────────────────────
Next: restart any active Claude Code session in your projects.

Why: the MCP server is spawned per-session. Active sessions hold the
previous binary in memory; new tools / rule changes won't appear until
a session restart picks up the rebuilt dist/.

Per-project opt-ins (gates that aren't on by default in org-defaults):
  • gates.definition_of_ready.enabled
  • gates.scope_expansion.enabled
  • gates.surface_uncertainty.enabled
  • gates.bugfix_root_cause.enabled

Add to your project's .agent-standards.yml if you want them active.

Always-on (org-default): auth_change_asvs_artifact, all check_* tools.
──────────────────────────────────────────────────────────────────────────
EOF
