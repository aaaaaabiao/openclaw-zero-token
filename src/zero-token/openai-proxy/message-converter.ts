/**
 * Message Converter — Direct Passthrough
 *
 * Converts OpenAI `/v1/chat/completions` messages into the minimal context
 * shape that each `StreamFn` expects.  Follows the same approach as the
 * AskOnce DeepSeek adapter: content is passed as plain strings, not wrapped
 * in ContentPart arrays.
 */

// ------- OpenAI input types -------

export interface OpenAiMessage {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content?: string | OpenAiContentPart[] | null;
  name?: string;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

export interface OpenAiContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface OpenAiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OpenAiTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: unknown;
  };
}

// ------- Conversion -------

/**
 * Build the minimal context object that StreamFn accepts.
 *
 * - `system` messages are merged into a single `systemPrompt` string.
 * - `user` / `assistant` / `tool` messages are converted to objects with
 *   string `content`, matching the format downstream web-stream handlers
 *   already support (see deepseek-web-stream.ts line 124).
 */
export function buildStreamContext(params: {
  messages: OpenAiMessage[];
  tools?: OpenAiTool[];
  sessionId?: string;
}): {
  messages: Array<Record<string, unknown>>;
  systemPrompt: string;
  tools: Array<{ name: string; description: string; parameters?: unknown }>;
  sessionId: string | undefined;
} {
  const { messages, tools, sessionId } = params;

  const TAG = "[msg-converter]";
  console.log(
    `${TAG} ── INPUT ── messages=${messages.length} tools=${tools?.length ?? 0} sessionId=${sessionId ?? "(none)"}`,
  );

  // 1. Extract system prompt
  const systemParts: string[] = [];
  const passthrough: Array<Record<string, unknown>> = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === "system" || msg.role === "developer") {
      const text = extractText(msg.content);
      systemParts.push(text);
      continue;
    }

    if (msg.role === "user") {
      const text = extractText(msg.content);
      passthrough.push({ role: "user", content: text });
      continue;
    }

    if (msg.role === "assistant") {
      const text = extractText(msg.content);
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const tcText = msg.tool_calls
          .map(
            (tc) =>
              `<tool_call id="${tc.id}" name="${tc.function.name}">${tc.function.arguments}</tool_call>`,
          )
          .join("\n");
        const merged = text ? `${text}\n${tcText}` : tcText;
        passthrough.push({ role: "assistant", content: merged });
      } else {
        passthrough.push({ role: "assistant", content: text });
      }
      continue;
    }

    if (msg.role === "tool") {
      const resultText = extractText(msg.content);
      passthrough.push({
        role: "toolResult",
        content: resultText,
        toolCallId: msg.tool_call_id,
        toolName: msg.name ?? "unknown",
      });
      continue;
    }
  }

  // 2. Convert tools
  const piTools = (tools ?? []).map((t) => ({
    name: t.function.name,
    description: t.function.description ?? "",
    parameters: t.function.parameters,
  }));

  const systemPrompt = systemParts.join("\n");

  return {
    messages: passthrough,
    systemPrompt,
    tools: piTools,
    sessionId,
  };
}

/** Extract plain text from OpenAI content (string | ContentPart[] | null). */
function extractText(content: string | OpenAiContentPart[] | null | undefined): string {
  if (!content) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text!)
      .join("\n");
  }
  return "";
}
