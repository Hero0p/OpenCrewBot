// Which integrations actually work right now (Module H: "clearly distinguish working
// integrations from mocked ones"). Each one gets a state the Connections panel shows as a badge:
//   live            connected (Composio) or tested OK in this session (MCP server)
//   not-connected   Composio is set up, but this app's account isn't connected yet
//   not-configured  no COMPOSIO_API_KEY
//   error           Composio rejected the key, or the server's last test failed
//   untested        an MCP server that hasn't been tested since the app started
// Mock mode is shown separately: there, app changes are SIMULATED (app-actions.ts) whatever the state.
import type { Bot, ComposioApp, IntegrationStatus, McpServer } from "@/lib/shared/types";

/** The apps the assignment names, always listed so their state is visible even before they're connected. */
export const CORE_APPS = [
  { slug: "github", name: "GitHub" },
  { slug: "notion", name: "Notion" },
  { slug: "slack", name: "Slack" },
  { slug: "gmail", name: "Gmail" },
];

const g = globalThis as unknown as { __opencrewbotServerTests?: Map<string, { ok: boolean; detail: string; at: string }> };
const serverTests = (g.__opencrewbotServerTests ??= new Map());

/** Remember an MCP server's latest test (Connections → Test, or Add and test). */
export function recordServerTest(id: string, result: { ok: true; tools: number } | { ok: false; error: string }): void {
  const at = new Date().toISOString();
  serverTests.set(id, result.ok ? { ok: true, detail: `Reachable: ${result.tools} tools`, at } : { ok: false, detail: `Last test failed: ${result.error}`, at });
}

/** Only what the badges need from a bot. */
type BotLink = Pick<Bot, "name" | "connections">;

const usedBy = (bots: BotLink[], connection: string) => bots.filter((b) => b.connections.includes(connection)).map((b) => b.name);

/**
 * @param composio - whether a key is set, the apps Composio returned, and its error if the call failed
 * @param bots - to list which bots have each integration switched on
 */
export function appStatuses(composio: { keySet: boolean; apps: ComposioApp[]; error?: string }, bots: BotLink[]): IntegrationStatus[] {
  const extra = composio.apps.filter((a) => a.connected && !CORE_APPS.some((c) => c.slug === a.slug)).map((a) => ({ slug: a.slug, name: a.name }));
  return [...CORE_APPS, ...extra].map(({ slug, name }) => {
    const app = composio.apps.find((a) => a.slug === slug);
    const base = { id: `composio:${slug}`, name, via: "Composio" as const, usedBy: usedBy(bots, `composio:${slug}`) };
    if (!composio.keySet) return { ...base, state: "not-configured" as const, detail: "Set COMPOSIO_API_KEY in .env and restart." };
    if (composio.error) return { ...base, state: "error" as const, detail: composio.error };
    if (app?.connected) return { ...base, state: "live" as const, detail: "Connected. Reads run on their own; changes ask first (by each bot's permission level)." };
    return { ...base, state: "not-connected" as const, detail: "Composio is set up: press Connect below and sign in to use it." };
  });
}

export function serverStatuses(servers: McpServer[], bots: BotLink[]): IntegrationStatus[] {
  return servers.map((s) => {
    const test = serverTests.get(s.id);
    const base = { id: `mcp:${s.id}`, name: s.name, via: "MCP" as const, usedBy: usedBy(bots, `mcp:${s.id}`) };
    if (!test) return { ...base, state: "untested" as const, detail: "Added. Press Test to check it's reachable." };
    return { ...base, state: test.ok ? ("live" as const) : ("error" as const), detail: test.detail };
  });
}
