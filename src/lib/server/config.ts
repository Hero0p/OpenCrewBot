import { existsSync, mkdirSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import type { AppStatus, MockReason } from "@/lib/shared/types";
import { defaultModel, providerStatuses } from "./providers";

// The data folder is chosen at runtime, so keep the bundler from tracing it.
export const DATA_DIR = resolve(/*turbopackIgnore: true*/ process.env.OPENCREWBOT_DATA_DIR || "./data");
export const WORKSPACES_DIR = resolve(DATA_DIR, "workspaces");
mkdirSync(WORKSPACES_DIR, { recursive: true });

// The app was called CrewRoom before; carry an existing database over once.
const APP_DB_PATH = resolve(DATA_DIR, "opencrewbot.db");
const LEGACY_DB_PATH = resolve(DATA_DIR, "crewroom.db");
if (!existsSync(APP_DB_PATH) && existsSync(LEGACY_DB_PATH)) renameSync(LEGACY_DB_PATH, APP_DB_PATH);

/** Where a libSQL database is: a local file, or a hosted database (Turso) with its token. */
export interface DatabaseTarget {
  url: string;
  authToken?: string;
}

/**
 * Where the app's two databases live (Step 17: deployment).
 * - Locally (the default): two files in the data folder, as always.
 * - Hosted: set OPENCREWBOT_DB_URL (e.g. libsql://opencrewbot-you.turso.io) and OPENCREWBOT_DB_AUTH_TOKEN.
 *   The app's tables and Mastra's (all named "mastra_…") then share that one database, so a free host whose
 *   disk is wiped on every restart (Render) keeps everything.
 * @throws Error naming the missing variable when a hosted URL comes without its token
 */
export function resolveDatabases(env: Record<string, string | undefined> = process.env): { app: DatabaseTarget; mastra: DatabaseTarget; hosted: boolean } {
  const url = env.OPENCREWBOT_DB_URL?.trim();
  if (!url) {
    return { app: { url: `file:${APP_DB_PATH}` }, mastra: { url: `file:${resolve(DATA_DIR, "mastra.db")}` }, hosted: false };
  }
  const hosted = /^(libsql|https|wss):\/\//.test(url);
  const authToken = env.OPENCREWBOT_DB_AUTH_TOKEN?.trim() || undefined;
  if (hosted && !authToken) {
    throw new Error("OPENCREWBOT_DB_URL points at a hosted database, but OPENCREWBOT_DB_AUTH_TOKEN isn't set. Create a token for the database (Turso: Generate token) and set it.");
  }
  const target = { url, authToken };
  return { app: target, mastra: target, hosted };
}

const DATABASES = resolveDatabases();
export const APP_DB = DATABASES.app;
export const MASTRA_DB = DATABASES.mastra;
/** True when the databases are hosted (Turso), i.e. the local disk may not survive a restart. */
export const HOSTED_DB = DATABASES.hosted;
export const APP_DB_URL = APP_DB.url;

/** The single local owner every bot thread belongs to. */
export const OWNER_ID = "owner";

/** Keys for the tool services. Model provider keys are handled in providers.ts. */
export const keys = {
  tavily: () => Boolean(process.env.TAVILY_API_KEY),
  jev: () => Boolean(process.env.TYPESAFE_API_KEY),
  browserbase: () => Boolean(process.env.BROWSERBASE_API_KEY),
  composio: () => Boolean(process.env.COMPOSIO_API_KEY),
};

/**
 * Why bots should use the scripted mock model, if they should.
 * `OPENCREWBOT_MOCK_MODE=true` forces it even when provider keys are set, for demos and tests.
 * @returns the reason, or null when bots use real models
 */
export function mockReason(): MockReason | null {
  if (process.env.OPENCREWBOT_MOCK_MODE === "true") return "forced";
  if (!providerStatuses().some((p) => p.configured)) return "no-provider-key";
  return null;
}

/** True when bots run on the scripted mock model instead of a real one. */
export const isMock = () => mockReason() !== null;

export function appStatus(): AppStatus {
  return {
    mock: isMock(),
    mockReason: mockReason(),
    providers: providerStatuses(),
    defaultModel: defaultModel(),
    keys: { tavily: keys.tavily(), jev: keys.jev(), browserbase: keys.browserbase(), composio: keys.composio() },
    dataDir: DATA_DIR,
    storage: HOSTED_DB ? "hosted" : "local",
    signIn: Boolean(process.env.OPENCREWBOT_PASSWORD?.trim()),
  };
}
