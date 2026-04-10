/**
 * StreamFn Cache — RAW (no middleware)
 *
 * Caches StreamFn instances per provider so that:
 * 1. The underlying web client (e.g. DeepSeekWebClient) is created once and reused
 * 2. Module-level session maps (sessionMap, parentMessageMap) in each stream
 *    implementation are preserved across requests, enabling multi-turn conversations.
 *
 * IMPORTANT: Uses raw stream factories directly, bypassing the
 * `wrapWithToolCalling` middleware that strips context down to the last user
 * message. The proxy needs full context passthrough — the caller (e.g. Cursor)
 * manages its own conversation history.
 *
 * Cache entries are invalidated when credentials change.
 */
import type { StreamFn } from "@mariozechner/pi-agent-core";
import { createChatGPTWebStreamFn } from "../streams/chatgpt-web-stream.js";
import { createClaudeWebStreamFn } from "../streams/claude-web-stream.js";
import { createDeepseekWebStreamFn } from "../streams/deepseek-web-stream.js";
import { createDoubaoWebStreamFn } from "../streams/doubao-web-stream.js";
import { createGeminiWebStreamFn } from "../streams/gemini-web-stream.js";
import { createGlmIntlWebStreamFn } from "../streams/glm-intl-web-stream.js";
import { createGlmWebStreamFn } from "../streams/glm-web-stream.js";
import { createGrokWebStreamFn } from "../streams/grok-web-stream.js";
import { createKimiWebStreamFn } from "../streams/kimi-web-stream.js";
import { createPerplexityWebStreamFn } from "../streams/perplexity-web-stream.js";
import { createQwenCNWebStreamFn } from "../streams/qwen-cn-web-stream.js";
import { createQwenWebStreamFn } from "../streams/qwen-web-stream.js";
import { createXiaomiMimoWebStreamFn } from "../streams/xiaomimo-web-stream.js";
import { resolveCredentialForProvider } from "./credential-resolver.js";

/** Raw factories — NO middleware wrapper. */
const RAW_FACTORIES: Record<string, (cookie: string) => StreamFn> = {
  "deepseek-web": createDeepseekWebStreamFn,
  "claude-web": createClaudeWebStreamFn,
  "doubao-web": createDoubaoWebStreamFn,
  "chatgpt-web": createChatGPTWebStreamFn,
  "qwen-web": createQwenWebStreamFn,
  "qwen-cn-web": createQwenCNWebStreamFn,
  "kimi-web": createKimiWebStreamFn,
  "gemini-web": createGeminiWebStreamFn,
  "grok-web": createGrokWebStreamFn,
  "glm-web": createGlmWebStreamFn,
  "glm-intl-web": createGlmIntlWebStreamFn,
  "perplexity-web": createPerplexityWebStreamFn,
  "xiaomimo-web": createXiaomiMimoWebStreamFn,
};

export function listRawApiIds(): string[] {
  return Object.keys(RAW_FACTORIES);
}

interface CachedStream {
  streamFn: StreamFn;
  credential: string;
  createdAt: number;
}

const cache = new Map<string, CachedStream>();

/**
 * Get or create a cached StreamFn for the given provider.
 * Returns undefined if the provider is unsupported or has no credentials.
 */
export function getCachedStreamFn(
  provider: string,
): { streamFn: StreamFn; credential: string } | undefined {
  const factory = RAW_FACTORIES[provider];
  if (!factory) {
    return undefined;
  }

  const cred = resolveCredentialForProvider(provider);
  if (!cred) {
    return undefined;
  }

  const existing = cache.get(provider);
  if (existing && existing.credential === cred.credential) {
    return { streamFn: existing.streamFn, credential: cred.credential };
  }

  // Credential changed or first use — create new StreamFn
  const streamFn = factory(cred.credential);
  cache.set(provider, {
    streamFn,
    credential: cred.credential,
    createdAt: Date.now(),
  });

  return { streamFn, credential: cred.credential };
}

/** Evict a specific provider from the cache (e.g. after re-auth). */
export function evictCachedStreamFn(provider: string): void {
  cache.delete(provider);
}

/** Clear all cached StreamFn instances. */
export function clearStreamCache(): void {
  cache.clear();
}
