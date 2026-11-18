import { handle } from "@/lib/server/http";
import { retryTask } from "@/lib/server/engine";
import { engineCall } from "@/lib/server/engine-http";

/** Run a failed or cancelled task again, while its run is still running. */
export async function POST(_request: Request, ctx: RouteContext<"/api/tasks/[id]/retry">) {
  const { id } = await ctx.params;
  return handle(() => engineCall(() => retryTask(id)));
}
