import { handle } from "@/lib/server/http";
import { getSkill } from "@/lib/server/skills";
import { InputError } from "@/lib/server/service";

/** One skill with its full procedure, for reading it in the Skills & Tools screen. */
export async function GET(_request: Request, ctx: RouteContext<"/api/skills/[id]">) {
  const { id } = await ctx.params;
  return handle(async () => {
    const skill = getSkill(id);
    if (!skill) throw new InputError(`There is no valid skill "${id}".`);
    return { skill };
  });
}
