import { connection } from "next/server";
import { handle } from "@/lib/server/http";
import { db } from "@/lib/server/db";
import { describeError } from "@/lib/server/errors";
import { HOSTED_DB } from "@/lib/server/config";

/** One check: how long it took, the HTTP status (any status means the service was reached), or why it failed. */
async function check(name: string, run: () => Promise<number | "ok">) {
  const started = Date.now();
  try {
    const result = await run();
    return { name, ok: true, result, ms: Date.now() - started };
  } catch (error) {
    return { name, ok: false, error: describeError(error), ms: Date.now() - started };
  }
}

/** GET a URL with a 10-second limit; resolves with the status code (reachable), rejects with the network error. */
async function reach(url: string, headers: Record<string, string> = {}): Promise<number> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000), cache: "no-store" });
  return res.status;
}

/**
 * Deployment diagnostics (signed-in only: the proxy guards it like every other API route).
 * Can this server reach its database and each provider? Gemini and Groq are called with their keys,
 * so 200 means the key works; 400/401/403 means the key is wrong, 429 means quota. Never returns key values.
 */
export async function GET() {
  await connection();
  return handle(async () => {
    const env = process.env;
    const checks = await Promise.all([
      check("database (Turso when hosted)", async () => {
        await (await db()).execute("SELECT 1");
        return "ok";
      }),
      check("Gemini (generativelanguage.googleapis.com)", () => reach("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", env.GEMINI_API_KEY ? { "x-goog-api-key": env.GEMINI_API_KEY } : {})),
      check("Groq (api.groq.com)", () => reach("https://api.groq.com/openai/v1/models", env.GROQ_API_KEY ? { authorization: `Bearer ${env.GROQ_API_KEY}` } : {})),
      check("OpenRouter (openrouter.ai)", () => reach("https://openrouter.ai/api/v1/models")),
      check("Tavily (api.tavily.com)", () => reach("https://api.tavily.com/")),
      check("Composio (backend.composio.dev)", () => reach("https://backend.composio.dev/")),
    ]);
    return {
      node: process.version,
      storage: HOSTED_DB ? "hosted" : "local",
      keysSet: {
        GEMINI_API_KEY: Boolean(env.GEMINI_API_KEY),
        GROQ_API_KEY: Boolean(env.GROQ_API_KEY),
        OPENROUTER_API_KEY: Boolean(env.OPENROUTER_API_KEY),
        TAVILY_API_KEY: Boolean(env.TAVILY_API_KEY),
        COMPOSIO_API_KEY: Boolean(env.COMPOSIO_API_KEY),
      },
      checks,
    };
  });
}
