import { connection } from "next/server";
import type { ComposioApp, ConnectionsState } from "@/lib/shared/types";
import { handle } from "@/lib/server/http";
import { isMock, keys } from "@/lib/server/config";
import { describeComposioError, listApps } from "@/lib/server/composio";
import { listServers } from "@/lib/server/mcp-servers";
import { mcpServerNames } from "@/lib/server/connectors";
import { appStatuses, serverStatuses } from "@/lib/server/integrations";
import { listBots } from "@/lib/server/db";

export async function GET() {
  await connection();
  return handle(async (): Promise<ConnectionsState> => {
    const [mcpServers, bots] = await Promise.all([listServers(), listBots()]);
    for (const s of mcpServers) mcpServerNames.set(s.id, s.name);
    const keySet = Boolean(keys.composio());
    let apps: ComposioApp[] = [];
    let error: string | undefined;
    if (keySet) {
      try {
        apps = await listApps();
      } catch (e) {
        // Shown in the panel and as the apps' state; the message says how to fix it (e.g. a rejected key).
        error = describeComposioError(e);
      }
    }
    return {
      composio: { enabled: keySet, apps, error },
      mcpServers,
      statuses: [...appStatuses({ keySet, apps, error }, bots), ...serverStatuses(mcpServers, bots)],
      mock: isMock(),
    };
  });
}
