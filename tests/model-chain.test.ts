// Step 2 behaviour: model ids, the default model, and each bot's model chain (its model, then fallbacks).
import { afterEach, describe, expect, it, vi } from "vitest";
import { automaticFallbacks, splitModelId } from "@/lib/shared/providers";
import { defaultModel, providerStatuses } from "@/lib/server/providers";
import { ModelConfigError, resolveModelChain, toMastraModels } from "@/lib/server/model-chain";

const PROVIDER_KEYS = ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "NEBIUS_API_KEY", "OPENCREWBOT_DEFAULT_MODEL"];

/** Start every test with no provider keys, then set exactly the ones the test needs. */
function onlyKeys(keys: Record<string, string>) {
  for (const name of PROVIDER_KEYS) vi.stubEnv(name, "");
  for (const [name, value] of Object.entries(keys)) vi.stubEnv(name, value);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("splitModelId", () => {
  it("splits at the first slash, so the provider's own model name can contain slashes", () => {
    expect(splitModelId("groq/openai/gpt-oss-120b")).toEqual({ provider: "groq", model: "openai/gpt-oss-120b" });
  });

  it("rejects ids that don't start with a supported provider", () => {
    expect(splitModelId("MiniMaxAI/MiniMax-M3")).toBeNull();
    expect(splitModelId("gemini-2.5-flash")).toBeNull();
    expect(splitModelId("google/")).toBeNull();
  });
});

describe("automaticFallbacks", () => {
  it("uses one recommended model from every other provider that has a key, in provider order", () => {
    onlyKeys({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q", OPENROUTER_API_KEY: "o" });
    expect(automaticFallbacks("google/gemini-2.5-flash", providerStatuses())).toEqual([
      "groq/openai/gpt-oss-120b",
      "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
    ]);
  });

  it("is empty when only one provider has a key", () => {
    onlyKeys({ GROQ_API_KEY: "q" });
    expect(automaticFallbacks("groq/openai/gpt-oss-20b", providerStatuses())).toEqual([]);
  });
});

describe("resolveModelChain", () => {
  it("puts the bot's own model first, then automatic fallbacks, each with its own key", () => {
    onlyKeys({ GEMINI_API_KEY: "gemini-key", GROQ_API_KEY: "groq-key" });
    const chain = resolveModelChain({ model: "google/gemini-2.5-flash" });
    expect(chain).toEqual([
      { id: "google/gemini-2.5-flash", apiKey: "gemini-key" },
      { id: "groq/openai/gpt-oss-120b", apiKey: "groq-key" },
    ]);
  });

  it("uses the bot's own fallback list instead of the automatic one, without duplicates", () => {
    onlyKeys({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q" });
    const chain = resolveModelChain({ model: "groq/openai/gpt-oss-20b", fallbackModels: ["groq/openai/gpt-oss-20b", "google/gemini-2.5-flash-lite"] });
    expect(chain.map((m) => m.id)).toEqual(["groq/openai/gpt-oss-20b", "google/gemini-2.5-flash-lite"]);
  });

  it("accepts GOOGLE_GENERATIVE_AI_API_KEY when GEMINI_API_KEY is not set", () => {
    onlyKeys({ GOOGLE_GENERATIVE_AI_API_KEY: "google-key" });
    expect(resolveModelChain({ model: "google/gemini-2.5-flash" })[0].apiKey).toBe("google-key");
  });

  it("fails with MODEL_PROVIDER_NOT_CONFIGURED, naming the missing env var, when the provider has no key", () => {
    onlyKeys({ GEMINI_API_KEY: "g" });
    const attempt = () => resolveModelChain({ model: "nebius/MiniMaxAI/MiniMax-M3" });
    expect(attempt).toThrow(ModelConfigError);
    expect(attempt).toThrow(/NEBIUS_API_KEY/);
    try {
      attempt();
    } catch (error) {
      expect((error as ModelConfigError).code).toBe("MODEL_PROVIDER_NOT_CONFIGURED");
    }
  });

  it("fails with MODEL_UNKNOWN_PROVIDER for an id without a supported provider", () => {
    onlyKeys({ GEMINI_API_KEY: "g" });
    try {
      resolveModelChain({ model: "MiniMaxAI/MiniMax-M3" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ModelConfigError);
      expect((error as ModelConfigError).code).toBe("MODEL_UNKNOWN_PROVIDER");
    }
  });

  it("converts to Mastra's fallback list with one retry per model", () => {
    onlyKeys({ GROQ_API_KEY: "q" });
    expect(toMastraModels(resolveModelChain({ model: "groq/openai/gpt-oss-20b" }))).toEqual([
      { model: { id: "groq/openai/gpt-oss-20b", apiKey: "q" }, maxRetries: 1 },
    ]);
  });
});

describe("defaultModel", () => {
  it("is the recommended model of the first provider with a key", () => {
    onlyKeys({ GROQ_API_KEY: "q", OPENROUTER_API_KEY: "o" });
    expect(defaultModel()).toBe("groq/openai/gpt-oss-120b");
  });

  it("follows OPENCREWBOT_DEFAULT_MODEL when set", () => {
    onlyKeys({ GROQ_API_KEY: "q", OPENCREWBOT_DEFAULT_MODEL: "groq/openai/gpt-oss-20b" });
    expect(defaultModel()).toBe("groq/openai/gpt-oss-20b");
  });

  it("rejects an OPENCREWBOT_DEFAULT_MODEL without a provider", () => {
    onlyKeys({ OPENCREWBOT_DEFAULT_MODEL: "gpt-oss-20b" });
    expect(() => defaultModel()).toThrow(/must start with a known provider/);
  });
});
