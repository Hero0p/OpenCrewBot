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

export const APP_DB_URL = `file:${APP_DB_PATH}`;
export const MASTRA_DB_URL = `file:${resolve(DATA_DIR, "mastra.db")}`;

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
  };
}
