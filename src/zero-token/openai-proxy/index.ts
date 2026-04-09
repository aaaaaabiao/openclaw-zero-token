/**
 * OpenAI Proxy — CLI entry point
 *
 * Parses command-line arguments and starts the proxy server.
 *
 * Usage:
 *   node dist/zero-token/openai-proxy/index.js [--port 9090] [--token SECRET] [--host 0.0.0.0]
 *
 * Environment variables (lower priority than CLI args):
 *   OPENAI_PROXY_PORT   — default 9090
 *   OPENAI_PROXY_TOKEN  — Bearer token for auth
 *   OPENAI_PROXY_HOST   — bind address, default 127.0.0.1
 */
import { startProxyServer } from "./openai-proxy-server.js";

function parseArgs(): { port: number; token?: string; host?: string } {
  const args = process.argv.slice(2);
  let port = parseInt(process.env.OPENAI_PROXY_PORT ?? "9090", 10);
  let token = process.env.OPENAI_PROXY_TOKEN || undefined;
  let host = process.env.OPENAI_PROXY_HOST || undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      port = parseInt(args[++i], 10);
    } else if (args[i] === "--token" && args[i + 1]) {
      token = args[++i];
    } else if (args[i] === "--host" && args[i + 1]) {
      host = args[++i];
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`
OpenAI Proxy Server — Zero Token Web Models

Usage:
  node dist/zero-token/openai-proxy/index.js [options]

Options:
  --port <number>   Listen port (default: 9090, env: OPENAI_PROXY_PORT)
  --token <string>  Bearer token for authentication (env: OPENAI_PROXY_TOKEN)
  --host <string>   Bind address (default: 127.0.0.1, env: OPENAI_PROXY_HOST)
  --help, -h        Show this help

Environment Variables:
  OPENCLAW_STATE_DIR       Override openclaw state directory (for auth-profiles.json)
  OPENAI_PROXY_PORT        Default listen port
  OPENAI_PROXY_TOKEN       Default Bearer token
  OPENAI_PROXY_HOST        Default bind address

Examples:
  # Start with defaults (port 9090, no auth)
  node dist/zero-token/openai-proxy/index.js

  # Start with auth token
  node dist/zero-token/openai-proxy/index.js --port 8080 --token my-secret

  # Call it
  curl http://127.0.0.1:9090/v1/chat/completions \\
    -H "Content-Type: application/json" \\
    -d '{"model":"deepseek-web/deepseek-chat","messages":[{"role":"user","content":"Hello!"}],"stream":true}'
`);
      process.exit(0);
    }
  }

  if (isNaN(port) || port < 1 || port > 65535) {
    console.error(`Invalid port: ${port}`);
    process.exit(1);
  }

  return { port, token, host };
}

const options = parseArgs();
startProxyServer(options);
