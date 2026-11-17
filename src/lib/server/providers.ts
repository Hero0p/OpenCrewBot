// Which model providers have a key on this server. Keys are read from the
// environment here and handed straight to Mastra; they never reach the browser.
import type { ProviderId, ProviderStatus } from "@/lib/shared/types";
import { PROVIDERS, providerInfo, splitModelId } from "@/lib/shared/providers";

/**
 * Read a provider's API key from its env vars, in the order the provider lists them.
 * @param id - the provider
 * @returns the key, or undefined when none of its env vars is set
 */
export function providerApiKey(id: ProviderId): string | undefined {
  for (const name of providerInfo(id).keyEnvVars) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** @returns every provider, in preference order, with whether this server has its key */
export function providerStatuses(): ProviderStatus[] {
  return PROVIDERS.map((p) => ({ ...p, configured: Boolean(providerApiKey(p.id)) }));
}

/**
 * The model new bots start with:
 * 1. `OPENCREWBOT_DEFAULT_MODEL` when it's set;
 * 2. otherwise the recommended model of the first provider (in preference order) that has a key;
 * 3. otherwise the first provider's recommended model (the app is in mock mode then, so it isn't called).
 * @returns a full model id
 * @throws Error when OPENCREWBOT_DEFAULT_MODEL is set but doesn't start with a known provider
 */
export function defaultModel(): string {
  const fromEnv = process.env.OPENCREWBOT_DEFAULT_MODEL?.trim();
  if (fromEnv) {
    if (!splitModelId(fromEnv)) {
      throw new Error(`OPENCREWBOT_DEFAULT_MODEL="${fromEnv}" must start with a known provider, e.g. "google/gemini-2.5-flash".`);
    }
    return fromEnv;
  }
  const firstWithKey = PROVIDERS.find((p) => providerApiKey(p.id));
  return (firstWithKey ?? PROVIDERS[0]).recommendedModel;
}
