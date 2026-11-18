"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { ConnectionOption, ConnectionsState } from "@/lib/shared/types";

/** Connected apps and MCP servers, refetched whenever the server says they changed. */
export function useConnections(version: number) {
  const [data, setData] = useState<ConnectionsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .connections()
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load connections."));
    return () => {
      cancelled = true;
    };
  }, [version, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  /** What a bot can be given: connected apps (in mock mode also the core apps, simulated), then MCP servers. */
  const options: ConnectionOption[] = data
    ? [
        ...data.statuses
          .filter((s) => s.via === "Composio" && (s.state === "live" || data.mock))
          .map((s) => ({
            id: s.id,
            name: s.state === "live" ? s.name : `${s.name} (simulated)`,
            kind: "composio" as const,
            logo: data.composio.apps.find((a) => `composio:${a.slug}` === s.id)?.logo,
          })),
        ...data.mcpServers.map((s) => ({ id: `mcp:${s.id}`, name: s.name, kind: "mcp" as const })),
      ]
    : [];

  return { data, error, options, reload, loading: !data && !error };
}
