/**
 * /v1/chat/completions handler
 *
 * Receives standard OpenAI chat completion requests, resolves credentials,
 * creates a StreamFn via the existing web-stream-factories, and converts
 * the pi-ai event stream back into OpenAI format.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getWebStreamFactory, listWebStreamApiIds } from "../streams/web-stream-factories.js";
import { resolveCredentialForProvider } from "./credential-resolver.js";
import {
  convertOpenAiMessagesToPiContext,
  type OpenAiMessage,
  type OpenAiTool,
  type PiModel,
} from "./message-converter.js";
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

  // 2. Get stream factory
  const factory = getWebStreamFactory(parsed.provider);
  if (!factory) {
    const apis = listWebStreamApiIds();
    sendJson(res, 400, {
      error: {
        message: `Unsupported provider "${parsed.provider}". Available: ${apis.join(", ")}`,
        type: "invalid_request_error",
      },
    });
    return;
  }

  // 3. Resolve credentials
  const cred = resolveCredentialForProvider(parsed.provider);
  if (!cred) {
    sendJson(res, 401, {
      error: {
        message: `No credentials found for provider "${parsed.provider}". Run "./onboard.sh webauth" to configure.`,
        type: "authentication_error",
      },
    });
    return;
  }

  // 4. Create StreamFn
  const streamFn = factory(cred.credential);

  // 5. Build pi-ai model and context
  const piModel: PiModel = {
    id: parsed.modelId === "default" ? parsed.provider : parsed.modelId,
    provider: parsed.provider,
    api: parsed.provider,
  };

  const sessionId = body.user ?? `proxy-${randomUUID()}`;
  const piContext = convertOpenAiMessagesToPiContext({
    messages: body.messages,
    tools: body.tools,
    sessionId,
  });

  // 6. Call StreamFn — it returns an AsyncIterable<AssistantMessageEvent>
  try {
    const eventStream = streamFn(
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
