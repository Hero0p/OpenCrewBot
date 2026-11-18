"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import type { SkillsState } from "@/lib/shared/types";

/** The skills library and tool catalog. Skills are files on the server, so this loads them once per mount. */
export function useSkills() {
  const [data, setData] = useState<SkillsState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .skills()
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load skills."));
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, error, loading: !data && !error };
}
