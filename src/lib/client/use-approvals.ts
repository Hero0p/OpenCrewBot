"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import type { ApprovalsState } from "@/lib/shared/types";

/**
 * Approval requests, decisions and the audit log, refetched whenever the server
 * says something changed (the `approvals-changed` event bumps `version`).
 * @param version - `state.approvalsVersion` from the app store
 */
export function useApprovals(version: number) {
  const [data, setData] = useState<ApprovalsState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .approvals()
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load approvals."));
    return () => {
      cancelled = true;
    };
  }, [version]);

  return { data, error, loading: !data && !error };
}
