import { connection } from "next/server";
import type { RunSummary } from "@/lib/shared/types";
import { handle } from "@/lib/server/http";
import { listRuns, listTasks } from "@/lib/server/db";

/** Every run, newest first, with task counts (the Task Dashboard's list and execution history). */
export async function GET() {
  await connection();
  return handle(async () => {
    const runs = await listRuns(100);
    const summaries: RunSummary[] = [];
    for (const run of runs) {
      const tasks = await listTasks(run.id);
      const count = (status: string) => tasks.filter((t) => t.status === status).length;
      summaries.push({ run, tasks: { total: tasks.length, completed: count("completed"), running: count("running"), failed: count("failed"), cancelled: count("cancelled") } });
    }
    return { runs: summaries };
  });
}
