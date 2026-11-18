import type { WorkflowInput } from "@/lib/shared/types";
import { body, handle } from "@/lib/server/http";
import { engineCall } from "@/lib/server/engine-http";
import { deleteWorkflow, updateWorkflow } from "@/lib/server/scheduler";

/** Change a workflow; `{ enabled: false }` pauses it and `{ enabled: true }` resumes it. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/workflows/[id]">) {
  const { id } = await ctx.params;
  return handle(async () => ({ workflow: await engineCall(async () => updateWorkflow(id, await body<Partial<WorkflowInput>>(request))) }));
}

/** Delete a workflow and its run history (its reports stay in Files). */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/workflows/[id]">) {
  const { id } = await ctx.params;
  return handle(() => deleteWorkflow(id));
}
