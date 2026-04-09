import { listProfilesForProvider } from "../../agents/auth-profiles.js";
/**
 * Credential Resolver for OpenAI Proxy
 *
 * Reuses the existing auth-profiles store to load web model credentials
 * (cookies, bearer tokens) without modifying any upstream code.
 */
import { ensureAuthProfileStore } from "../../agents/auth-profiles/store.js";
import type { AuthProfileStore } from "../../agents/auth-profiles/types.js";

export interface ResolvedCredential {
  provider: string;
  credential: string;
  profileId: string;
}

let cachedStore: AuthProfileStore | undefined;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30_000; // refresh every 30s

function getStore(): AuthProfileStore {
  const now = Date.now();
  if (!cachedStore || now - cacheTimestamp > CACHE_TTL_MS) {
    cachedStore = ensureAuthProfileStore();
    cacheTimestamp = now;
  }
  return cachedStore;
}

/**
 * Resolve the credential (cookie/token/apiKey) for a given web provider.
 * Mirrors the logic in `src/agents/provider-stream.ts`.
 */
export function resolveCredentialForProvider(provider: string): ResolvedCredential | undefined {
  const store = getStore();
  const profileIds = listProfilesForProvider(store, provider);
  if (profileIds.length === 0) {
    return undefined;
  }

  const profile = store.profiles[profileIds[0]];
  if (!profile) {
    return undefined;
  }

  let credential: string | undefined;
  if (profile.type === "token" && profile.token) {
    credential = profile.token;
  } else if (profile.type === "api_key" && profile.key) {
    credential = profile.key;
  } else if (profile.type === "oauth") {
    credential = JSON.stringify(profile);
  }

  if (!credential) {
    return undefined;
  }

  return { provider, credential, profileId: profileIds[0] };
}

/**
 * List all providers that have valid credentials in the auth store.
 */
export function listAvailableProviders(): string[] {
  const store = getStore();
  const providers = new Set<string>();
  for (const profile of Object.values(store.profiles)) {
    if (profile.provider) {
      providers.add(profile.provider);
    }
  }
  return [...providers];
}

/** Force-refresh the cached auth store (e.g. after re-login). */
export function invalidateCredentialCache(): void {
  cachedStore = undefined;
  cacheTimestamp = 0;
}
