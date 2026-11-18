import { body, handle } from "@/lib/server/http";
import { InputError } from "@/lib/server/service";
import { draftAgent } from "@/lib/server/agent-factory";

/** Agent Factory: `{ description }` → a checked draft to review in the New bot form (nothing is saved yet). */
export async function POST(request: Request) {
  return handle(async () => {
    const { description } = await body<{ description: string }>(request);
    try {
      return { draft: await draftAgent(String(description ?? "")) };
    } catch (error) {
      // A short description or a failed model call: show the reason in the form.
      throw new InputError(error instanceof Error ? error.message : "Couldn't draft that agent.");
    }
  });
}
