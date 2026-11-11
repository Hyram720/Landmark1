#!/bin/bash
# Register the REA reverse-engineering MCP server and skill with Claude Code
# in cloud sessions. Idempotent: REA's setup only rewrites what has drifted.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

npx -y rea-agents@6.7.0 setup --client claude_code --yes --format json >/dev/null
