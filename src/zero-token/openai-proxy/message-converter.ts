/**
 * Message Converter: OpenAI chat messages ↔ pi-ai Context.messages
 *
 * Converts standard OpenAI `/v1/chat/completions` message array into
 * the pi-ai `Context` shape that each `StreamFn` expects.
 */

// The pi-ai message types used by StreamFn context
export type PiRole = "user" | "assistant" | "system" | "toolResult";

export interface PiTextContent {
  type: "text";
  text: string;
}

export interface PiThinkingContent {
  type: "thinking";
  thinking: string;
}

export interface PiToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type PiContentPart = PiTextContent | PiThinkingContent | PiToolCallContent;

export interface PiMessage {
  role: PiRole;
  content: PiContentPart[] | string;
  // toolResult specific fields
  toolCallId?: string;
  toolName?: string;
}

export interface PiContext {
  messages: PiMessage[];
  systemPrompt?: string;
  tools?: Array<{ name: string; description: string; parameters?: unknown }>;
  sessionId?: string;
}

export interface PiModel {
  id: string;
  provider: string;
  api: string;
  name?: string;
}

// ------- OpenAI types -------

export interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
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
 * Convert an OpenAI messages array into pi-ai context shape.
 */
export function convertOpenAiMessagesToPiContext(params: {
  messages: OpenAiMessage[];
  tools?: OpenAiTool[];
  sessionId?: string;
}): PiContext {
  const { messages, tools, sessionId } = params;
  const piMessages: PiMessage[] = [];
  let systemPrompt = "";

  for (const msg of messages) {
    if (msg.role === "system") {
      // Accumulate system messages as system prompt
      const text = extractTextFromContent(msg.content);
      systemPrompt += (systemPrompt ? "\n" : "") + text;
      continue;
    }

    if (msg.role === "user") {
      const text = extractTextFromContent(msg.content);
      piMessages.push({ role: "user", content: [{ type: "text", text }] });
      continue;
    }

    if (msg.role === "assistant") {
      const parts: PiContentPart[] = [];

      // Text content
      const text = extractTextFromContent(msg.content);
      if (text) {
        parts.push({ type: "text", text });
      }

      // Tool calls
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            args = { raw: tc.function.arguments };
          }
          parts.push({
            type: "toolCall",
            id: tc.id,
            name: tc.function.name,
            arguments: args,
          });
        }
      }

      if (parts.length > 0) {
        piMessages.push({ role: "assistant", content: parts });
      }
      continue;
    }

    if (msg.role === "tool") {
      // Tool result message
      const text = extractTextFromContent(msg.content);
      piMessages.push({
        role: "toolResult" as PiRole,
        content: [{ type: "text", text }],
        toolCallId: msg.tool_call_id,
        toolName: msg.name ?? "unknown",
      });
      continue;
    }
  }

  const piTools = tools?.map((t) => ({
    name: t.function.name,
    description: t.function.description ?? "",
    parameters: t.function.parameters,
  }));

  return {
    messages: piMessages,
    systemPrompt: systemPrompt || undefined,
    tools: piTools,
    sessionId,
  };
}

function extractTextFromContent(content: string | OpenAiContentPart[] | null | undefined): string {
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
