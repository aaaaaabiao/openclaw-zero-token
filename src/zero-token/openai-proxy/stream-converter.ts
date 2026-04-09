/**
 * Stream Converter: pi-ai AssistantMessageEvent → OpenAI SSE format
 *
 * Converts the async iterator of AssistantMessageEvent (from StreamFn)
 * into OpenAI-compatible chat completion chunks or full responses.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

// We work with the event shapes emitted by StreamFn without importing
// the pi-ai module directly — the stream is typed as AsyncIterable<AssistantMessageEvent>
// which has .type discriminator.

export interface OpenAiChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: "assistant";
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: "function";
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason: "stop" | "tool_calls" | null;
  }>;
}

export interface OpenAiChatCompletion {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: "stop" | "tool_calls";
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

// ------- SSE helpers -------

export function setSseHeaders(res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
}

export function writeSseChunk(res: ServerResponse, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function writeSseDone(res: ServerResponse): void {
  res.write("data: [DONE]\n\n");
  res.end();
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// ------- Stream event → OpenAI SSE -------

/**
 * Consume a StreamFn async iterable and write OpenAI-compatible SSE chunks.
 */
export async function streamToOpenAiSse(params: {
  stream: AsyncIterable<{ type: string; [key: string]: unknown }>;
  res: ServerResponse;
  req: IncomingMessage;
  runId: string;
  model: string;
}): Promise<void> {
  const { stream, res, req, runId, model } = params;
  const created = Math.floor(Date.now() / 1000);
  let wroteRole = false;
  let closed = false;
  let hasToolCalls = false;

  // Track tool calls for proper finish_reason
  const toolCallTracker = new Map<number, { id: string; name: string; arguments: string }>();

  req.on("close", () => {
    closed = true;
  });

  setSseHeaders(res);

  for await (const event of stream) {
    if (closed) {
      break;
    }

    switch (event.type) {
      case "text_start": {
        if (!wroteRole) {
          wroteRole = true;
          writeSseChunk(res, {
            id: runId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
          });
        }
        break;
      }

      case "text_delta": {
        if (!wroteRole) {
          wroteRole = true;
          writeSseChunk(res, {
            id: runId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
          });
        }
        const delta = (event as { delta?: string }).delta ?? "";
        if (delta) {
          writeSseChunk(res, {
            id: runId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
          });
        }
        break;
      }

      case "thinking_start":
      case "thinking_delta": {
        // Forward thinking as content wrapped in <think> tags for transparency
        if (event.type === "thinking_start" && !wroteRole) {
          wroteRole = true;
          writeSseChunk(res, {
            id: runId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [
              { index: 0, delta: { role: "assistant", content: "<think>\n" }, finish_reason: null },
            ],
          });
        }
        if (event.type === "thinking_delta") {
          const delta = (event as { delta?: string }).delta ?? "";
          if (delta) {
            writeSseChunk(res, {
              id: runId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
            });
          }
        }
        break;
      }

      case "thinking_end": {
        writeSseChunk(res, {
          id: runId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: { content: "\n</think>\n" }, finish_reason: null }],
        });
        break;
      }

      case "toolcall_start": {
        hasToolCalls = true;
        if (!wroteRole) {
          wroteRole = true;
          writeSseChunk(res, {
            id: runId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
          });
        }

        const partial = event.partial as
          | { content?: Array<{ type: string; id?: string; name?: string }> }
          | undefined;
        const contentIndex = (event as { contentIndex?: number }).contentIndex ?? 0;
        const toolPart = partial?.content?.[contentIndex];
        const toolId = toolPart?.id ?? `call_${Date.now()}`;
        const toolName = toolPart?.name ?? "";

        toolCallTracker.set(contentIndex, { id: toolId, name: toolName, arguments: "" });

        writeSseChunk(res, {
          id: runId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: contentIndex,
                    id: toolId,
                    type: "function",
                    function: { name: toolName, arguments: "" },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        });
        break;
      }

      case "toolcall_delta": {
        const delta = (event as { delta?: string }).delta ?? "";
        const contentIndex = (event as { contentIndex?: number }).contentIndex ?? 0;
        const tracked = toolCallTracker.get(contentIndex);
        if (tracked) {
          tracked.arguments += delta;
        }
        if (delta) {
          writeSseChunk(res, {
            id: runId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: contentIndex,
                      function: { arguments: delta },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          });
        }
        break;
      }

      case "done": {
        const finishReason = hasToolCalls ? "tool_calls" : "stop";
        writeSseChunk(res, {
          id: runId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
        });
        writeSseDone(res);
        return;
      }

      case "error": {
        // Surface the error as a final SSE chunk, then close
        const errorMsg = (event as { error?: { content?: Array<{ text?: string }> } }).error;
        const errorText = errorMsg?.content?.[0]?.text ?? "Unknown error";
        writeSseChunk(res, {
          id: runId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            { index: 0, delta: { content: `\n[Error: ${errorText}]` }, finish_reason: "stop" },
          ],
        });
        writeSseDone(res);
        return;
      }

      default:
        // Ignore unknown event types (lifecycle, etc.)
        break;
    }
  }

  // If stream ended without explicit done event
  if (!closed) {
    const finishReason = hasToolCalls ? "tool_calls" : "stop";
    writeSseChunk(res, {
      id: runId,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
    });
    writeSseDone(res);
  }
}

/**
 * Consume a StreamFn async iterable and collect into a non-streaming OpenAI response.
 */
export async function streamToOpenAiResponse(params: {
  stream: AsyncIterable<{ type: string; [key: string]: unknown }>;
  runId: string;
  model: string;
}): Promise<OpenAiChatCompletion> {
  const { stream, runId, model } = params;
  let fullText = "";
  let inThinking = false;
  const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

  for await (const event of stream) {
    switch (event.type) {
      case "thinking_start":
        inThinking = true;
        fullText += "<think>\n";
        break;
      case "thinking_delta":
        fullText += (event as { delta?: string }).delta ?? "";
        break;
      case "thinking_end":
        inThinking = false;
        fullText += "\n</think>\n";
        break;
      case "text_delta":
        if (!inThinking) {
          fullText += (event as { delta?: string }).delta ?? "";
        }
        break;
      case "toolcall_start": {
        const contentIndex = (event as { contentIndex?: number }).contentIndex ?? 0;
        const partial = event.partial as
          | { content?: Array<{ type: string; id?: string; name?: string }> }
          | undefined;
        const toolPart = partial?.content?.[contentIndex];
        toolCalls.set(contentIndex, {
          id: toolPart?.id ?? `call_${Date.now()}`,
          name: toolPart?.name ?? "",
          arguments: "",
        });
        break;
      }
      case "toolcall_delta": {
        const contentIndex = (event as { contentIndex?: number }).contentIndex ?? 0;
        const tc = toolCalls.get(contentIndex);
        if (tc) {
          tc.arguments += (event as { delta?: string }).delta ?? "";
        }
        break;
      }
      default:
        break;
    }
  }

  const hasTools = toolCalls.size > 0;
  const toolCallsArr = hasTools
    ? [...toolCalls.values()].map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      }))
    : undefined;

  return {
    id: runId,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: fullText || null,
          ...(toolCallsArr ? { tool_calls: toolCallsArr } : {}),
        },
        finish_reason: hasTools ? "tool_calls" : "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}
