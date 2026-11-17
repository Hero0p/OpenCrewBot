// The model providers OpenCrewBot can call, and pure helpers for model ids.
// Only plain facts live here (names, env var names, links), so the browser can
// use them too. Whether a key is actually set is decided on the server, in
// `src/lib/server/providers.ts`.
//
// A model id is always "<provider>/<model>". The provider is the first segment;
// everything after the first "/" is the provider's own model name, which may
// contain more slashes: "groq/openai/gpt-oss-120b" is Groq's "openai/gpt-oss-120b".
import type { ProviderId, ProviderInfo, ProviderStatus } from "./types";

// A Record forces exactly one entry per ProviderId, so adding a provider to the
// type without describing it here is a compile error.
const PROVIDER_INFO: Record<ProviderId, ProviderInfo> = {
  google: {
    id: "google",
    label: "Google Gemini",
    keyEnvVars: ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
    signupUrl: "https://aistudio.google.com/apikey",
    recommendedModel: "google/gemini-2.5-flash",
  },
  groq: {
    id: "groq",
    label: "Groq",
    keyEnvVars: ["GROQ_API_KEY"],
    signupUrl: "https://console.groq.com/keys",
    recommendedModel: "groq/openai/gpt-oss-120b",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    keyEnvVars: ["OPENROUTER_API_KEY"],
    signupUrl: "https://openrouter.ai/keys",
    recommendedModel: "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
  },
  nebius: {
    id: "nebius",
    label: "Nebius Token Factory",
    keyEnvVars: ["NEBIUS_API_KEY"],
    signupUrl: "https://tokenfactory.nebius.com",
    recommendedModel: "nebius/MiniMaxAI/MiniMax-M3",
  },
};

/**
 * Every provider, in preference order. The first one with a key supplies the
 * default model for new bots, and automatic fallbacks are tried in this order.
 */
export const PROVIDERS: readonly ProviderInfo[] = [PROVIDER_INFO.google, PROVIDER_INFO.groq, PROVIDER_INFO.openrouter, PROVIDER_INFO.nebius];

/**
 * Look up the fixed facts about one provider.
 * @param id - the provider
 * @returns its label, key env vars, signup link and recommended model
 */
export function providerInfo(id: ProviderId): ProviderInfo {
  return PROVIDER_INFO[id];
}

/**
 * @param value - any string, e.g. the first segment of a model id
 * @returns true when it names a provider OpenCrewBot supports
 */
export function isProviderId(value: string): value is ProviderId {
  return Object.hasOwn(PROVIDER_INFO, value);
}

/**
 * Split a full model id into its provider and the provider's own model name.
 * @param id - e.g. "groq/openai/gpt-oss-120b"
 * @returns `{ provider: "groq", model: "openai/gpt-oss-120b" }`, or null when the
 *   id doesn't start with a supported provider or has no model name
 */
export function splitModelId(id: string): { provider: ProviderId; model: string } | null {
  const slash = id.indexOf("/");
  if (slash <= 0) return null;
  const provider = id.slice(0, slash);
  const model = id.slice(slash + 1);
  if (!isProviderId(provider) || !model) return null;
  return { provider, model };
}

/**
 * The fallback rule for bots that don't list their own fallbacks: the
 * recommended model of every *other* provider that has a key, in provider order.
 * @param primaryId - the bot's own model id
 * @param providers - every provider with its `configured` flag
 * @returns full model ids to try after the bot's own model
 */
export function automaticFallbacks(primaryId: string, providers: readonly ProviderStatus[]): string[] {
  const primaryProvider = splitModelId(primaryId)?.provider;
  return providers.filter((p) => p.configured && p.id !== primaryProvider).map((p) => p.recommendedModel);
}
