import { conversationParam, body, handle } from "@/lib/server/http";
import { decideToolCall } from "@/lib/server/service";

/** The approval card in the chat. Goes through the same recorded decision as the Approval Centre. */
export async function POST(request: Request, ctx: RouteContext<"/api/conversations/[id]/approval">) {
  const id = conversationParam((await ctx.params).id);
  return handle(async () => {
    const { botId, toolCallId, approve } = await body<{ botId: string; toolCallId: string; approve: boolean }>(request);
    await decideToolCall(id, botId, toolCallId, approve === true);
  });
}
