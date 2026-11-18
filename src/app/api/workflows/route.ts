import { connection } from "next/server";
import type { WorkflowInput } from "@/lib/shared/types";
import { body, handle } from "@/lib/server/http";
import { engineCall } from "@/lib/server/engine-http";
import { createWorkflow, workflowsWithRuns } from "@/lib/server/scheduler";

/** Every workflow with its last 10 runs. */
export async function GET() {
  await connection();
  return handle(async () => ({ workflows: await workflowsWithRuns() }));
}

/** Create a workflow: `{ name, instruction, botId, schedule (cron), enabled }`. */
export async function POST(request: Request) {
  return handle(async () => ({ workflow: await engineCall(async () => createWorkflow(await body<WorkflowInput>(request))) }));
}
