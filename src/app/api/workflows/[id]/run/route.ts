import { handle } from "@/lib/server/http";
import { engineCall } from "@/lib/server/engine-http";
import { runWorkflowNow } from "@/lib/server/scheduler";

/** Run now: starts a run in the background and returns it. */
export async function POST(_request: Request, ctx: RouteContext<"/api/workflows/[id]/run">) {
  const { id } = await ctx.params;
  return handle(async () => ({ run: await engineCall(() => runWorkflowNow(id)) }));
}
