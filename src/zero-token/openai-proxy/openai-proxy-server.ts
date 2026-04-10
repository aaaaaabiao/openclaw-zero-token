/**
 * OpenAI-Compatible Proxy Server
 *
 * A lightweight standalone HTTP server that exposes `/v1/chat/completions` and
 * `/v1/models` endpoints. It directly calls the web-stream-factories with
 * credentials from auth-profiles, completely bypassing the openclaw Gateway
 * and Agent system.
 *
 * Usage:
 *   node dist/zero-token/openai-proxy/index.js [--port 9090] [--token YOUR_TOKEN]
 *
 * Then:
 *   curl http://127.0.0.1:9090/v1/chat/completions \
 *     -H "Authorization: Bearer YOUR_TOKEN" \
 *     -H "Content-Type: application/json" \
 *     -d '{"model":"deepseek-web/deepseek-chat","messages":[{"role":"user","content":"Hello!"}],"stream":true}'
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { handleChatCompletions } from "./chat-completions-handler.js";
import { handleListModels } from "./models-handler.js";
import { sendJson } from "./stream-converter.js";

export interface ProxyServerOptions {
  port: number;
  token?: string;
  host?: string;
}

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10MB

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function authenticate(req: IncomingMessage, expectedToken?: string): boolean {
  if (!expectedToken) {
    return true;
  } // no auth required
  const authHeader = req.headers.authorization ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return false;
  }
  const provided = authHeader.slice(7).trim();
  return provided === expectedToken;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  token?: string,
): Promise<void> {
  // CORS preflight
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Session-Id");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  // Health check
  if (pathname === "/health" || pathname === "/") {
    sendJson(res, 200, { status: "ok", service: "openai-proxy" });
    return;
  }

  // Auth check (for API endpoints)
  if (!authenticate(req, token)) {
    sendJson(res, 401, { error: { message: "Unauthorized", type: "unauthorized" } });
    return;
  }

  // GET /v1/models
  if (pathname === "/v1/models" && req.method === "GET") {
    handleListModels(res);
    return;
  }

  // POST /v1/chat/completions
  if (pathname === "/v1/chat/completions" && req.method === "POST") {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw);

      // Dump raw request for debugging
      console.log(
        `[openai-proxy] ── RAW REQUEST ── model=${body.model} messages=${Array.isArray(body.messages) ? body.messages.length : "N/A"} stream=${body.stream ?? false}`,
      );
      if (Array.isArray(body.messages)) {
        for (let i = 0; i < body.messages.length; i++) {
          const m = body.messages[i];
          const cLen =
            typeof m.content === "string"
              ? m.content.length
              : Array.isArray(m.content)
                ? JSON.stringify(m.content).length
                : 0;
          console.log(
            `[openai-proxy]   raw[${i}] role="${m.role}" content_type=${typeof m.content === "string" ? "string" : Array.isArray(m.content) ? `array[${m.content.length}]` : String(m.content)} len=${cLen}`,
          );
        }
      }

      if (!body.model || !Array.isArray(body.messages)) {
        sendJson(res, 400, {
          error: {
            message: "Missing required fields: model, messages",
            type: "invalid_request_error",
          },
        });
        return;
      }

      await handleChatCompletions(req, res, body);
    } catch (err) {
      if (!res.headersSent) {
        sendJson(res, 400, {
          error: {
            message: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
            type: "invalid_request_error",
          },
        });
      }
    }
    return;
  }

  // 404
  sendJson(res, 404, {
    error: { message: `Unknown endpoint: ${req.method} ${pathname}`, type: "not_found" },
  });
}

export function startProxyServer(options: ProxyServerOptions): void {
  const { port, token, host } = options;
  const bindHost = host ?? "127.0.0.1";

  const server = createServer((req, res) => {
    handleRequest(req, res, token).catch((err) => {
      console.error("[openai-proxy] unhandled error:", err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: { message: "Internal server error", type: "api_error" } });
      }
    });
  });

  server.listen(port, bindHost, () => {
    console.log(`\n  OpenAI Proxy Server started`);
    console.log(`  ─────────────────────────────────`);
    console.log(`  Endpoint:  http://${bindHost}:${port}/v1/chat/completions`);
    console.log(`  Models:    http://${bindHost}:${port}/v1/models`);
    console.log(`  Auth:      ${token ? "Bearer token required" : "No auth (open)"}`);
    console.log(`  ─────────────────────────────────\n`);
    console.log(`  Example:`);
    console.log(`  curl http://${bindHost}:${port}/v1/chat/completions \\`);
    console.log(`    -H "Authorization: Bearer ${token || "YOUR_TOKEN"}" \\`);
    console.log(`    -H "Content-Type: application/json" \\`);
    console.log(
      `    -d '{"model":"deepseek-web/deepseek-chat","messages":[{"role":"user","content":"Hello!"}],"stream":true}'`,
    );
    console.log();
  });

  server.on("error", (err) => {
    console.error(`[openai-proxy] server error:`, err);
    process.exit(1);
  });
}
