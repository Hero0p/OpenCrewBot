// Facts about the conversation a turn happens in: a readable label (for memory
// provenance) and the room it belongs to (for room memory). Conversation ids are:
//   dm:<botId>     a direct chat with one bot
//   room:<roomId>  a group room
//   task:<taskId>  one task of a team run (the run itself was started in a chat or a room)
//   collab:<id>    a teammate answering another agent's ask_teammate request
//   workflow:<id>  one run of a scheduled workflow
import type { ConversationId, Room } from "@/lib/shared/types";
import { getBot, getRoom, getRun, getTask, getWorkflow, getWorkflowRun } from "./db";
import { exchangeOf } from "./collaboration";

export interface ConversationContext {
  /** e.g. "chat with Iris", "room Market Intelligence", "task Profile competitors". */
  label: string;
  /** The room whose shared memory applies: the room itself, or the room a task's run started in. */
  room?: Pick<Room, "id" | "name">;
}

/** @returns the context, or a generic one when the id is unknown or missing */
export async function conversationContext(conversationId: ConversationId | undefined): Promise<ConversationContext> {
  if (!conversationId) return { label: "a conversation" };
  const [kind, id] = conversationId.split(":");
  if (kind === "dm") {
    const bot = await getBot(id);
    return { label: bot ? `chat with ${bot.name}` : "a direct chat" };
  }
  if (kind === "room") {
    const room = await getRoom(id);
    return room ? { label: `room ${room.name}`, room: { id: room.id, name: room.name } } : { label: "a room" };
  }
  if (kind === "task") {
    const task = await getTask(id);
    const run = task ? await getRun(task.runId) : null;
    // A task inherits the room of the conversation its run was started in (never another task).
    const parent = run && !run.conversationId.startsWith("task:") ? await conversationContext(run.conversationId) : undefined;
    return { label: task ? `task "${task.title}"` : "a task", room: parent?.room };
  }
  if (kind === "collab") {
    // A teammate's answer belongs to wherever the request came from (a room's memory applies there too).
    const exchange = exchangeOf(id);
    const asker = exchange ? await getBot(exchange.fromId) : null;
    const parent = exchange && !exchange.visibleIn.startsWith("collab:") ? await conversationContext(exchange.visibleIn) : undefined;
    return { label: asker ? `request from ${asker.name}` : "a teammate's request", room: parent?.room };
  }
  if (kind === "workflow") {
    const run = await getWorkflowRun(id);
    const workflow = run ? await getWorkflow(run.workflowId) : null;
    return { label: workflow ? `workflow "${workflow.name}"` : "a scheduled workflow" };
  }
  return { label: "a conversation" };
}
