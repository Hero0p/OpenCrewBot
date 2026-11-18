import { handle } from "@/lib/server/http";
import { InputError } from "@/lib/server/service";
import { exportRunEvidence } from "@/lib/server/evidence";

/** Save this run as an evidence file (plan, timeline, outputs, approvals, result) in the evidence folder. */
export async function POST(_request: Request, ctx: RouteContext<"/api/runs/[id]/evidence">) {
  const { id } = await ctx.params;
  return handle(async () => {
    try {
      return { file: await exportRunEvidence(id) };
    } catch (error) {
      // The only expected failure is an unknown run id.
      throw new InputError(error instanceof Error ? error.message : "Couldn't save the evidence.");
    }
  });
}
