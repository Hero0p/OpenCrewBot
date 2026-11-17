// The model picker's catalog: the models OpenCrewBot offers, per provider.
//
// Google, Groq and OpenRouter rows: names, context sizes, capabilities and list
// prices come from models.dev (the catalog Mastra's model router uses), and each
// model answered a real test request on 2026-11-18. Nebius rows are the original
// built-in list; with NEBIUS_API_KEY set, Nebius's live catalog replaces them.
//
// Prices are list prices in $ per 1M tokens. Free-tier usage is billed $0.
import type { ModelOption } from "@/lib/shared/types";
import { providerInfo, splitModelId } from "@/lib/shared/providers";
import { providerApiKey } from "./providers";

type Row = [id: string, context: number, tools: boolean, reasoning: boolean, vision: boolean, inPerM: number, outPerM: number, label?: string];

const STATIC: Row[] = [
  // Google Gemini
  ["google/gemini-2.5-flash", 1048576, true, true, true, 0.3, 2.5, "Gemini 2.5 Flash"],
  ["google/gemini-2.5-flash-lite", 1048576, true, true, true, 0.1, 0.4, "Gemini 2.5 Flash-Lite"],
  // Groq
  ["groq/openai/gpt-oss-120b", 131072, true, true, false, 0.15, 0.6, "GPT OSS 120B"],
  ["groq/openai/gpt-oss-20b", 131072, true, true, false, 0.075, 0.3, "GPT OSS 20B"],
  ["groq/qwen/qwen3.8-27b", 131072, true, true, true, 0.8, 4, "Qwen3.8 27B"],
  // OpenRouter (free models; busy ones can return "rate limited")
  ["openrouter/nvidia/nemotron-3-ultra-550b-a55b:free", 1000000, true, true, false, 0, 0, "Nemotron 3 Ultra (free)"],
  ["openrouter/nvidia/nemotron-3.5-lightning:free", 1000000, true, true, false, 0, 0, "Nemotron 3.5 Lightning (free)"],
  ["openrouter/google/gemma-4-31b-it:free", 262144, true, true, true, 0, 0, "Gemma 4 31B (free)"],
  // Nebius Token Factory (the original OpenCrewBot list)
  ["nebius/MiniMaxAI/MiniMax-M3", 1048576, true, true, false, 0.3, 1.2],
  ["nebius/deepseek-ai/DeepSeek-V4-Flash-0731", 1024000, true, true, false, 0.14, 0.28],
  ["nebius/deepseek-ai/DeepSeek-V4.1-Flash", 1048000, true, true, true, 0.3, 1.2],
  ["nebius/deepseek-ai/DeepSeek-V4-Pro", 1048576, true, true, false, 1.75, 3.5],
  ["nebius/Qwen/Qwen3.5-397B-A17B", 262144, true, true, false, 0.6, 3.6],
  ["nebius/Qwen/Qwen3.8-27B", 262144, true, true, false, 0.45, 3],
  ["nebius/Qwen/Qwen3-235B-A22B-Instruct-2507", 262144, true, false, false, 0.2, 0.6],
  ["nebius/Qwen/Qwen3-30B-A3B-Instruct-2507", 262144, true, false, false, 0.1, 0.3],
  ["nebius/zai-org/GLM-5.3", 1024000, true, true, false, 1.4, 4.4],
  ["nebius/zai-org/GLM-5.3-Flash", 1024000, true, true, false, 0.15, 0.5],
  ["nebius/moonshotai/Kimi-K3", 1048576, true, true, false, 3, 15],
  ["nebius/moonshotai/Kimi-K2.7-Code", 262144, true, true, false, 0.95, 4],
  ["nebius/nvidia/Nemotron-3_5-Lightning", 1048576, true, true, false, 0.06, 0.24],
  ["nebius/nvidia/nemotron-3-super-120b-a12b", 262144, true, true, false, 0.3, 0.9],
  ["nebius/nvidia/Nemotron-3-Ultra-550b-a55b", 1048576, true, true, false, 1, 3],
  ["nebius/openai/gpt-oss-120b", 131072, true, true, false, 0.15, 0.6],
  ["nebius/NousResearch/Hermes-4-405B", 131072, true, true, false, 1, 3],
  ["nebius/google/gemma-3-27b-it", 110000, true, false, true, 0.1, 0.3],
];

/** A readable name from a model id when no label is given: "nebius/MiniMaxAI/MiniMax-M3" → "MiniMax M3". */
function labelFromId(id: string): string {
  const name = id.split("/").pop() ?? id;
  return name.replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
}

function fromRow([id, context, tools, reasoning, vision, inPerM, outPerM, label]: Row): ModelOption {
  const parts = splitModelId(id);
  // A row with an unknown provider is a typo in the list above; fail at startup, not later.
  if (!parts) throw new Error(`models.ts: "${id}" doesn't start with a supported provider.`);
  return {
    id,
    label: label ?? labelFromId(id),
    provider: parts.provider,
    providerLabel: providerInfo(parts.provider).label,
    context,
    tools,
    reasoning,
    vision,
    inputPerM: inPerM,
    outputPerM: outPerM,
    live: false,
    available: false,
  };
}

const staticOptions = STATIC.map(fromRow);

// ── Nebius live catalog (unchanged from the original, except ids now carry the "nebius/" prefix) ──

interface LiveModel {
  id: string;
  name?: string;
  context_length?: number;
  architecture?: { modality?: string };
  pricing?: { prompt?: string; completion?: string };
  supported_features?: string[] | null;
  status?: string | null;
}

const g = globalThis as unknown as { __opencrewbotModels?: { at: number; options: ModelOption[] } };
const LIVE_TTL_MS = 10 * 60 * 1000;

async function fetchNebiusLive(): Promise<ModelOption[] | null> {
  const key = providerApiKey("nebius");
  if (!key) return null;
  try {
    const res = await fetch("https://api.tokenfactory.nebius.com/v1/models?verbose=true", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: LiveModel[] };
    const known = new Map(staticOptions.map((o) => [o.id, o]));
    const options: ModelOption[] = [];
    for (const m of json.data ?? []) {
      const modality = m.architecture?.modality ?? "text->text";
      if (!modality.endsWith("->text")) continue; // skip embedding / image models
      if (m.status && m.status !== "active") continue;
      const id = `nebius/${m.id}`;
      const base = known.get(id);
      // Nebius's own display name and feature flags win; the built-in list fills gaps.
      const features = m.supported_features ? new Set(m.supported_features.map((f) => f.toLowerCase())) : null;
      const name = m.name ? labelFromId(m.name) : undefined;
      // Prices come per token; show them per million, without float noise (0.09999… → 0.1).
      const perM = (v?: string) => (v === undefined ? null : Math.round(Number(v) * 1e6 * 10_000) / 10_000);
      options.push({
        id,
        label: name ?? base?.label ?? labelFromId(id),
        provider: "nebius",
        providerLabel: providerInfo("nebius").label,
        context: m.context_length ?? base?.context ?? 0,
        tools: features ? features.has("tools") : (base?.tools ?? false),
        reasoning: features ? features.has("reasoning") : (base?.reasoning ?? false),
        vision: base?.vision ?? modality.includes("image"),
        inputPerM: perM(m.pricing?.prompt) ?? base?.inputPerM ?? null,
        outputPerM: perM(m.pricing?.completion) ?? base?.outputPerM ?? null,
        live: true,
        available: false,
      });
    }
    return options.length ? options : null;
  } catch {
    // Nebius unreachable: the built-in Nebius rows stay in the catalog, so the picker still works.
    return null;
  }
}

/**
 * The full catalog, each model marked `available` when its provider has a key.
 * Nebius models come from its live catalog when a key is set.
 * @param fresh - skip the 10-minute cache of the live Nebius list
 * @returns tool-capable models first, then by id
 */
export async function listModels(fresh = false): Promise<ModelOption[]> {
  const cached = g.__opencrewbotModels;
  if (!fresh && cached && Date.now() - cached.at < LIVE_TTL_MS) return cached.options;
  const nebiusLive = await fetchNebiusLive();
  const rows = nebiusLive ? [...staticOptions.filter((o) => o.provider !== "nebius"), ...nebiusLive] : staticOptions;
  const options = rows
    .map((o) => ({ ...o, available: Boolean(providerApiKey(o.provider)) }))
    .sort((a, b) => Number(b.tools) - Number(a.tools) || a.id.localeCompare(b.id));
  if (nebiusLive) g.__opencrewbotModels = { at: Date.now(), options };
  return options;
}

export async function findModel(id: string): Promise<ModelOption | undefined> {
  return (await listModels()).find((m) => m.id === id) ?? staticOptions.find((m) => m.id === id);
}

export function costUsd(model: ModelOption | undefined, input: number, output: number): number | null {
  if (!model || model.inputPerM === null || model.outputPerM === null) return null;
  return (input * model.inputPerM + output * model.outputPerM) / 1e6;
}
