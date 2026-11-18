import { connection } from "next/server";
import { handle } from "@/lib/server/http";
import { runDetail } from "@/lib/server/engine";
import { engineCall } from "@/lib/server/engine-http";

/** One run with its tasks and which of them wait for your approval. */
export async function GET(_request: Request, ctx: RouteContext<"/api/runs/[id]">) {
  await connection();
  const { id } = await ctx.params;
  return handle(() => engineCall(() => runDetail(id)));
}
