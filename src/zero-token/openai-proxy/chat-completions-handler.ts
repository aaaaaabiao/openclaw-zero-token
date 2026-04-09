/**
 * /v1/chat/completions handler
 *
 * Receives standard OpenAI chat completion requests, resolves credentials,
 * creates a StreamFn via the existing web-stream-factories, and converts
 * the pi-ai event stream back into OpenAI format.
 *
 * Session reuse:
 *   - StreamFn instances are cached per provider (so the underlying web client
 *     and its module-level sessionMap/parentMessageMap are preserved).
 *   - A stable `sessionId` is derived from the `user` field or a custom
 *     `x-session-id` header. When neither is provided, a default session
 *     per provider is used, enabling multi-turn conversations out of the box.
 *   - Send `x-session-id: new` to force a fresh session.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { listWebStreamApiIds } from "../streams/web-stream-factories.js";
import {
  convertOpenAiMessagesToPiContext,
  type OpenAiMessage,
  type OpenAiTool,
  type PiModel,
} from "./message-converter.js";
import { getCachedStreamFn } from "./stream-cache.js";
import { sendJson, streamToOpenAiResponse, streamToOpenAiSse } from "./stream-converter.js";

interface ChatCompletionRequest {
  model: string;
  messages: OpenAiMessage[];
  stream?: boolean;
  tools?: OpenAiTool[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  user?: string;
}

/**
 * Parse "provider/modelId" from the model string.
 * Accepts formats: "deepseek-web/deepseek-chat" or "deepseek-web"
 */
function parseModelString(model: string): { provider: string; modelId: string } | undefined {
  const trimmed = model.trim();
  if (!trimmed) {
    return undefined;
  }

  const slashIndex = trimmed.indexOf("/");
  if (slashIndex > 0) {
    return {
      provider: trimmed.slice(0, slashIndex),
      modelId: trimmed.slice(slashIndex + 1),
    };
  }

  // If no slash, treat the whole thing as provider and use a default model id
  const apis = listWebStreamApiIds();
  if (apis.includes(trimmed as never)) {
    return { provider: trimmed, modelId: "default" };
  }

  return undefined;
}

/**
 * Resolve the session ID for the request.
 *
 * Priority:
 *   1. `x-session-id` header (explicit session control)
 *      - "new" → generate a fresh UUID (force new session)
 *      - any other value → use as-is
 *   2. `user` field in request body
 *   3. Default: "proxy-default" (stable, enables multi-turn by default)
 */
function resolveSessionId(req: IncomingMessage, body: ChatCompletionRequest): string {
  const headerValue =
    typeof req.headers["x-session-id"] === "string" ? req.headers["x-session-id"].trim() : "";

  if (headerValue) {
    if (headerValue.toLowerCase() === "new") {
      return `proxy-${randomUUID()}`;
    }
    return headerValue;
  }

  if (body.user) {
    return body.user;
  }

  return "proxy-default";
}

export async function handleChatCompletions(
  req: IncomingMessage,
  res: ServerResponse,
  body: ChatCompletionRequest,
): Promise<void> {
  const runId = `chatcmpl-${randomUUID()}`;

  // 1. Parse model
  const parsed = parseModelString(body.model);
  if (!parsed) {
    const apis = listWebStreamApiIds();
    sendJson(res, 400, {
      error: {
        message: `Invalid model "${body.model}". Use format: "provider/model", e.g. "deepseek-web/deepseek-chat". Available providers: ${apis.join(", ")}`,
        type: "invalid_request_error",
      },
    });
    return;
  }

  // 2. Get cached StreamFn (reuses web client + session state)
  const cached = getCachedStreamFn(parsed.provider);
  if (!cached) {
    // Distinguish between "unsupported provider" and "no credentials"
    const apis = listWebStreamApiIds();
    const isKnown = apis.includes(parsed.provider as never);
    if (!isKnown) {
      sendJson(res, 400, {
        error: {
          message: `Unsupported provider "${parsed.provider}". Available: ${apis.join(", ")}`,
          type: "invalid_request_error",
        },
      });
    } else {
      sendJson(res, 401, {
        error: {
          message: `No credentials found for provider "${parsed.provider}". Run "./onboard.sh webauth" to configure.`,
          type: "authentication_error",
        },
      });
    }
    return;
  }

  // 3. Build pi-ai model and context
  const piModel: PiModel = {
    id: parsed.modelId === "default" ? parsed.provider : parsed.modelId,
    provider: parsed.provider,
    api: parsed.provider,
  };

  const sessionId = resolveSessionId(req, body);
  const piContext = convertOpenAiMessagesToPiContext({
    messages: body.messages,
    tools: body.tools,
    sessionId,
  });

  console.log(
    `[openai-proxy] model=${body.model} session=${sessionId} messages=${body.messages.length} stream=${!!body.stream}`,
  );

  // 4. Call StreamFn — it returns an AsyncIterable<AssistantMessageEvent>
  try {
    const eventStream = cached.streamFn(
      piModel as never,
      piContext as never,
      { signal: undefined } as never,
    );

    if (body.stream) {
      await streamToOpenAiSse({
        stream: eventStream as AsyncIterable<{ type: string; [key: string]: unknown }>,
        res,
        req,
        runId,
        model: body.model,
      });
    } else {
      const response = await streamToOpenAiResponse({
        stream: eventStream as AsyncIterable<{ type: string; [key: string]: unknown }>,
        runId,
        model: body.model,
      });
      sendJson(res, 200, response);
    }
  } catch (err) {
    console.error(`[openai-proxy] chat completions error:`, err);
    if (!res.headersSent) {
      sendJson(res, 500, {
        error: {
          message: `Internal error: ${err instanceof Error ? err.message : String(err)}`,
          type: "api_error",
        },
      });
    }
  }
}
