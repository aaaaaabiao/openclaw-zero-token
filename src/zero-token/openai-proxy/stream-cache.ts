/**
 * StreamFn Cache
 *
 * Caches StreamFn instances per provider so that:
 * 1. The underlying web client (e.g. DeepSeekWebClient) is created once and reused
 * 2. Module-level session maps (sessionMap, parentMessageMap) in each stream
 *    implementation are preserved across requests, enabling multi-turn conversations.
 *
 * Cache entries are invalidated when credentials change (detected via credential string comparison).
 */
import type { StreamFn } from "@mariozechner/pi-agent-core";
import { getWebStreamFactory } from "../streams/web-stream-factories.js";
import { resolveCredentialForProvider } from "./credential-resolver.js";

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
  const factory = getWebStreamFactory(provider);
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
