// Turns a bot's chosen connections into tools: Composio apps share one
// session, and each MCP server gets its own client.
import type { ToolsInput } from "@mastra/core/agent";
import type { Bot } from "@/lib/shared/types";
import { appActionTools, appActionsCapability } from "./app-actions";
import { getSetting, setSetting } from "./db";
import { publish } from "./bus";
import { listServers, mcpTools } from "./mcp-servers";
import { isMock, keys } from "./config";

const VERSION_KEY = "connections.version";

/** Changes whenever an app is connected or a server is added, so bots pick it up. */
export async function connectionsVersion(): Promise<number> {
  return (await getSetting<number>(VERSION_KEY)) ?? 0;
}

export async function connectionsChanged(): Promise<void> {
  await setSetting(VERSION_KEY, (await connectionsVersion()) + 1);
  publish({ type: "connections-changed" });
}

/** MCP server names by id, for labelling tool steps in chat. */
const g = globalThis as unknown as { __opencrewbotMcpNames?: Map<string, string> };
export const mcpServerNames = (g.__opencrewbotMcpNames ??= new Map());

export interface ConnectorToolset {
  tools: ToolsInput;
  capabilities: string[];
  close: () => Promise<void>;
}

const appName = (slug: string) => slug.charAt(0).toUpperCase() + slug.slice(1);

export async function buildConnectorTools(bot: Bot, clientId: string): Promise<ConnectorToolset> {
  const composioSlugs = bot.connections.filter((c) => c.startsWith("composio:")).map((c) => c.slice("composio:".length));
  const mcpIds = bot.connections.filter((c) => c.startsWith("mcp:")).map((c) => c.slice("mcp:".length));
  const tools: ToolsInput = {};
  const capabilities: string[] = [];
  let close = async () => {};

  // In mock mode the app tools simulate changes (nothing is sent), so they're given even without a key.
  if (composioSlugs.length && (keys.composio() || isMock())) {
    Object.assign(tools, appActionTools(composioSlugs));
    capabilities.push(appActionsCapability(composioSlugs));
  } else if (composioSlugs.length) {
    capabilities.push(`Apps are switched on for you (${composioSlugs.map(appName).join(", ")}), but no COMPOSIO_API_KEY is set, so you can't use them right now. Say so if asked.`);
  }

  if (mcpIds.length) {
    const servers = await listServers();
    for (const s of servers) mcpServerNames.set(s.id, s.name);
    const result = await mcpTools(mcpIds, clientId);
    Object.assign(tools, result.tools);
    close = result.close;
    const names = servers.filter((s) => mcpIds.includes(s.id)).map((s) => s.name);
    if (Object.keys(result.tools).length) {
      capabilities.push(`Use tools from ${names.join(", ")} (the mcp_* tools). Actions that change things ask the person first unless you have full access.`);
    }
    for (const e of result.errors) capabilities.push(`Couldn't connect to ${e}. Say so if asked.`);
  }

  return { tools, capabilities, close };
}
