import { handle } from "@/lib/server/http";
import { cancelTask } from "@/lib/server/engine";
import { engineCall } from "@/lib/server/engine-http";

/** Cancel one task; tasks that depend on it still run and are told it's missing. */
export async function POST(_request: Request, ctx: RouteContext<"/api/tasks/[id]/cancel">) {
  const { id } = await ctx.params;
  return handle(() => engineCall(() => cancelTask(id)));
}
