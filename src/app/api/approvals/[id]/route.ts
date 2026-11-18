import { body, handle } from "@/lib/server/http";
import { decideApproval } from "@/lib/server/service";

/** Approve or reject one waiting action: `{ approve: true | false }`. */
export async function POST(request: Request, ctx: RouteContext<"/api/approvals/[id]">) {
  const { id } = await ctx.params;
  return handle(async () => {
    const { approve } = await body<{ approve: boolean }>(request);
    return { approval: await decideApproval(id, approve === true) };
  });
}
