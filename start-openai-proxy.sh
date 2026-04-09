#!/usr/bin/env bash
# start-openai-proxy.sh — Start the OpenAI-compatible proxy server
#
# Usage:
#   ./start-openai-proxy.sh [--port 9090] [--token YOUR_TOKEN]
#
# This script builds (if needed) and starts the standalone OpenAI proxy
# that directly calls web platform APIs using saved credentials.
#
# Prerequisites:
#   1. Run `pnpm build` at least once
#   2. Run `./onboard.sh webauth` to configure credentials
#   3. (Optional) Start Chrome debug mode: `./start-chrome-debug.sh`

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# State directory — same as server.sh / onboard.sh
STATE_DIR="$SCRIPT_DIR/.openclaw-upstream-state"
export OPENCLAW_STATE_DIR="$STATE_DIR"
export OPENCLAW_CONFIG_PATH="$STATE_DIR/openclaw.json"

# Check Node.js version
NODE_VERSION=$(node -v 2>/dev/null | sed 's/v//')
REQUIRED_VERSION="22.12.0"
if [ "$(printf '%s\n' "$REQUIRED_VERSION" "$NODE_VERSION" | sort -V | head -n1)" != "$REQUIRED_VERSION" ]; then
  echo "Error: Node.js >= $REQUIRED_VERSION required (found: $NODE_VERSION)"
  exit 1
fi

# Check if dist exists
ENTRY="$SCRIPT_DIR/dist/zero-token/openai-proxy/index.js"
if [ ! -f "$ENTRY" ]; then
  echo "dist/ not found. Running pnpm build..."
  cd "$SCRIPT_DIR" && pnpm build
fi

if [ ! -f "$ENTRY" ]; then
  echo "Error: $ENTRY not found after build. Check build output."
  exit 1
fi

echo "Starting OpenAI Proxy Server..."
exec node "$ENTRY" "$@"
