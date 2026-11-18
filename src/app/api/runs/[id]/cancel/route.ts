import { handle } from "@/lib/server/http";
import { cancelRun } from "@/lib/server/engine";
import { engineCall } from "@/lib/server/engine-http";

/** Cancel a whole run: every task that hasn't ended stops. */
export async function POST(_request: Request, ctx: RouteContext<"/api/runs/[id]/cancel">) {
  const { id } = await ctx.params;
  return handle(() => engineCall(() => cancelRun(id)));
}
