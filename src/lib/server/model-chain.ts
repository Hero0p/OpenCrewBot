// Decides which models a bot tries, in order: its own model first, then its
// fallbacks. Mastra walks this list itself: when a model fails (rate limit,
// outage, unknown model), it retries it RETRIES_PER_MODEL times and then moves on
// to the next one. This file is the one place where defaults and fallbacks are
// decided, so the rules are easy to find.
import type { ModelWithRetries } from "@mastra/core/agent";
import { StreamErrorRetryProcessor, type Processor } from "@mastra/core/processors";
import type { Bot, ProviderId } from "@/lib/shared/types";
import { automaticFallbacks, providerInfo, splitModelId } from "@/lib/shared/providers";
import { providerApiKey, providerStatuses } from "./providers";

/** How many times Mastra retries one model before moving to the next in the chain. */
const RETRIES_PER_MODEL = 1;

export type ModelConfigErrorCode = "MODEL_UNKNOWN_PROVIDER" | "MODEL_PROVIDER_NOT_CONFIGURED";

/** A bot's model settings can't be used as they are. The message says how to fix it. */
export class ModelConfigError extends Error {
  readonly code: ModelConfigErrorCode;

  constructor(code: ModelConfigErrorCode, message: string) {
    super(message);
    this.name = "ModelConfigError";
    this.code = code;
  }
}

/** One model in a bot's chain, with the key needed to call it. */
export interface ChainModel {
  id: `${ProviderId}/${string}`;
  apiKey: string;
}

function resolveOne(id: string, role: "model" | "fallback model"): ChainModel {
  const parts = splitModelId(id);
  if (!parts) {
    throw new ModelConfigError(
      "MODEL_UNKNOWN_PROVIDER",
      `The ${role} "${id}" doesn't start with a supported provider (google, groq, openrouter or nebius). Choose another model in the bot's Details.`,
    );
  }
  const apiKey = providerApiKey(parts.provider);
  if (!apiKey) {
    const info = providerInfo(parts.provider);
    throw new ModelConfigError(
      "MODEL_PROVIDER_NOT_CONFIGURED",
      `The ${role} "${id}" runs on ${info.label}, but ${info.keyEnvVars[0]} isn't set in .env. Add the key and restart, or choose another model in the bot's Details.`,
    );
  }
  return { id: `${parts.provider}/${parts.model}`, apiKey };
}

/**
 * The models to try for one bot, in order. Every model in the list must be
 * callable; a model that isn't is a setup mistake, so it fails loudly instead
 * of being skipped.
 * @param bot - the bot's model and optional fallback list
 * @returns the bot's own model first, then each fallback, without duplicates
 * @throws ModelConfigError when a listed model's provider is unknown or has no key
 */
export function resolveModelChain(bot: Pick<Bot, "model" | "fallbackModels">): ChainModel[] {
  const fallbackIds = bot.fallbackModels ?? automaticFallbacks(bot.model, providerStatuses());
  const ids = [...new Set([bot.model, ...fallbackIds])];
  return ids.map((id, index) => resolveOne(id, index === 0 ? "model" : "fallback model"));
}

/**
 * Convert a chain into the list form Mastra's Agent accepts for `model`.
 * @param chain - from {@link resolveModelChain}
 * @returns one entry per model, each with its own key and retry budget
 */
export function toMastraModels(chain: ChainModel[]): ModelWithRetries[] {
  return chain.map((m) => ({ model: { id: m.id, apiKey: m.apiKey }, maxRetries: RETRIES_PER_MODEL }));
}

// ── retrying a failed step ──────────────────────────────────────────────

/** All the text an error carries (message, provider response body, causes), for matching. */
function errorText(error: unknown, depth = 0): string {
  if (depth > 5 || typeof error !== "object" || error === null) return typeof error === "string" ? error : "";
  const parts: string[] = [];
  if ("message" in error && typeof error.message === "string") parts.push(error.message);
  if ("responseBody" in error && typeof error.responseBody === "string") parts.push(error.responseBody);
  if ("cause" in error) parts.push(errorText(error.cause, depth + 1));
  return parts.join(" ");
}

/**
 * Groq rejects a reply when its model wrote a tool call that isn't valid JSON
 * ("tool_use_failed: Failed to parse tool call arguments as JSON") or doesn't match
 * the tool's schema ("Tool call validation failed"). The error arrives in the middle
 * of the stream, so Mastra doesn't fall back to the next model; it ends the turn.
 * The tool never ran, and asking the same model again usually produces a valid call,
 * so this step is worth retrying.
 */
export function isMalformedToolCall(error: unknown): boolean {
  return /tool_use_failed|Failed to parse tool call arguments|Tool call validation failed/i.test(errorText(error));
}

/** A dropped connection is worth retrying (Mastra's default retry also covers this). */
export function isConnectionReset(error: unknown): boolean {
  return /ECONNRESET|socket hang up/i.test(errorText(error));
}

/**
 * The agent's step-retry policy: retry a model step twice, half a second apart, on a
 * malformed tool call or a dropped connection. This replaces Mastra's default retry
 * processor (same id); its built-in provider checks stay on.
 * @returns the processor, for the Agent's `errorProcessors`
 */
export function modelStepRetry(): StreamErrorRetryProcessor {
  return new StreamErrorRetryProcessor({ maxRetries: 2, delayMs: 500, matchers: [isMalformedToolCall, isConnectionReset] });
}

/** Mastra's AgentController puts its session details in the request context under this key. */
function conversationIdOf(requestContext: { get(key: string): unknown } | undefined): string | undefined {
  const controller = requestContext?.get("controller");
  if (typeof controller !== "object" || controller === null || !("scope" in controller)) return undefined;
  return typeof controller.scope === "string" ? controller.scope : undefined;
}

/** A processor with `processLLMResponse` present, which Mastra's `inputProcessors` requires for this hook. */
type ResponseProcessor = Processor & Required<Pick<Processor, "processLLMResponse">>;

/**
 * A Mastra processor that reports which model produced each response.
 * Mastra calls `processLLMResponse` only for the model that actually answered,
 * so after a fallback it names the fallback, not the model that failed.
 * The conversation id comes from the session's `scope`, which runtime.ts sets.
 * @param onAnswer - called with the conversation id and the full model id that answered
 * @returns the processor, for the Agent's `inputProcessors`
 */
export function answeringModelReporter(onAnswer: (conversationId: string, modelId: string) => void): ResponseProcessor {
  return {
    id: "answering-model-reporter",
    processLLMResponse({ model, requestContext }) {
      const conversationId = conversationIdOf(requestContext);
      if (conversationId) onAnswer(conversationId, `${model.provider}/${model.modelId}`);
    },
  };
}
