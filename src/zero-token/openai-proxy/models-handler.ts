/**
 * /v1/models handler
 *
 * Lists all available web models (providers that have both a stream factory
 * and valid credentials).
 */
import type { ServerResponse } from "node:http";
import { listWebStreamApiIds } from "../streams/web-stream-factories.js";
import { resolveCredentialForProvider } from "./credential-resolver.js";
import { sendJson } from "./stream-converter.js";

// Hardcoded model catalog — matches web-providers.ts definitions
const MODEL_CATALOG: Record<string, Array<{ id: string; name: string; context_window: number }>> = {
  "deepseek-web": [
    { id: "deepseek-chat", name: "DeepSeek V3 (Web)", context_window: 64000 },
    { id: "deepseek-reasoner", name: "DeepSeek R1 (Web)", context_window: 64000 },
  ],
  "claude-web": [
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Web)", context_window: 200000 },
    { id: "claude-opus-4-6", name: "Claude Opus 4.6 (Web)", context_window: 200000 },
    { id: "claude-haiku-4-6", name: "Claude Haiku 4.6 (Web)", context_window: 200000 },
  ],
  "chatgpt-web": [
    { id: "gpt-4", name: "GPT-4 (Web)", context_window: 128000 },
    { id: "gpt-4-turbo", name: "GPT-4 Turbo (Web)", context_window: 128000 },
  ],
  "qwen-web": [
    { id: "qwen3.5-plus", name: "Qwen 3.5 Plus", context_window: 32000 },
    { id: "qwen3.5-turbo", name: "Qwen 3.5 Turbo", context_window: 32000 },
  ],
  "qwen-cn-web": [
    { id: "Qwen3.5-Plus", name: "Qwen 3.5 Plus (CN)", context_window: 128000 },
    { id: "Qwen3.5-Turbo", name: "Qwen 3.5 Turbo (CN)", context_window: 128000 },
  ],
  "kimi-web": [
    { id: "moonshot-v1-8k", name: "Moonshot v1 8K (Web)", context_window: 8000 },
    { id: "moonshot-v1-32k", name: "Moonshot v1 32K (Web)", context_window: 32000 },
    { id: "moonshot-v1-128k", name: "Moonshot v1 128K (Web)", context_window: 128000 },
  ],
  "doubao-web": [
    { id: "doubao-seed-2.0", name: "Doubao-Seed 2.0 (Web)", context_window: 64000 },
    { id: "doubao-pro", name: "Doubao Pro (Web)", context_window: 64000 },
  ],
  "gemini-web": [
    { id: "gemini-pro", name: "Gemini Pro (Web)", context_window: 32000 },
    { id: "gemini-ultra", name: "Gemini Ultra (Web)", context_window: 32000 },
  ],
  "grok-web": [
    { id: "grok-1", name: "Grok 1 (Web)", context_window: 32000 },
    { id: "grok-2", name: "Grok 2 (Web)", context_window: 32000 },
  ],
  "glm-web": [
    { id: "glm-4-plus", name: "GLM-4 Plus (Web)", context_window: 128000 },
    { id: "glm-4-think", name: "GLM-4 Think (Web)", context_window: 128000 },
  ],
  "glm-intl-web": [
    { id: "glm-4-plus", name: "GLM-4 Plus (Intl)", context_window: 128000 },
    { id: "glm-4-think", name: "GLM-4 Think (Intl)", context_window: 128000 },
  ],
  "perplexity-web": [
    { id: "perplexity-web", name: "Perplexity (Sonar)", context_window: 128000 },
    { id: "perplexity-pro", name: "Perplexity Pro", context_window: 128000 },
  ],
  "xiaomimo-web": [{ id: "xiaomimo-chat", name: "MiMo Chat", context_window: 128000 }],
};

export function handleListModels(res: ServerResponse): void {
  const apiIds = listWebStreamApiIds();
  // const availableProviders = new Set(listAvailableProviders());
  const now = Math.floor(Date.now() / 1000);

  const data: Array<{
    id: string;
    object: "model";
    created: number;
    owned_by: string;
    context_window?: number;
  }> = [];

  for (const api of apiIds) {
    // Check if we have credentials for this provider
    const hasCredential = resolveCredentialForProvider(api) !== undefined;
    const models = MODEL_CATALOG[api] ?? [{ id: api, name: api, context_window: 32000 }];

    for (const model of models) {
      data.push({
        id: `${api}/${model.id}`,
        object: "model",
        created: now,
        owned_by: api + (hasCredential ? "" : " (no credentials)"),
        context_window: model.context_window,
      });
    }
  }

  sendJson(res, 200, { object: "list", data });
}
