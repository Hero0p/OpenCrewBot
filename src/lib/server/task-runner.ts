// How a task really runs: one turn of the assigned agent, in the task's own
// conversation ("task:<id>"). Its transcript (the brief, the tool steps, the
// answer) is the task's full log, and any approval it needs shows up in the
// Approval Centre like any other. Wired into the engine at boot (service.ts).
import { randomUUID } from "node:crypto";
import type { ChatMessage, Run, Task } from "@/lib/shared/types";
import { bumpGeneration, getBot, listBots, saveMessage } from "./db";
import { publish } from "./bus";
import { taskConversationId, type TaskRunner } from "./engine";
import { forgetConversation, runTurn, stopConversation } from "./runtime";
import { messageText } from "./rooms";
import { memoryFilePath, provenanceComment, provenanceTime } from "./memory-layers";
import { writeTextFile } from "./memory-files";
import { inlineReportLinks } from "./files";

async function post(message: ChatMessage): Promise<void> {
  await saveMessage(message);
  publish({ type: "message", message });
}

/** The run's history file: what was asked, who did what, how it ended (memory layer "history"). */
async function writeHistory(run: Run, tasks: Task[]): Promise<void> {
  const names = new Map((await listBots()).map((b) => [b.id, b.name]));
  const stamp = provenanceComment({ by: "engine", when: provenanceTime(), why: "record of a team run", in: `plan "${run.title}"` });
  const lines = [
    `# ${run.title}`,
    "",
    `- Goal: ${run.goal.replace(/\n+/g, " ")} ${stamp}`,
    `- Status: ${run.status}, started ${run.createdAt}${run.completedAt ? `, ended ${run.completedAt}` : ""} ${stamp}`,
    "",
    "## Tasks",
    ...tasks.map((t) => `- ${t.title} (${names.get(t.agentId) ?? "a deleted agent"}): ${t.status}${t.attempt > 1 ? ` after ${t.attempt} attempts` : ""}${t.error && t.status !== "completed" ? ` (${t.error})` : ""} ${stamp}`),
    "",
    "## Result",
    run.result ? run.result.slice(0, 4000) : "(no final deliverable)",
    "",
  ];
  writeTextFile(memoryFilePath({ scope: "history", id: run.id }), lines.join("\n"));
  publish({ type: "memory-files-changed", key: `history:${run.id}` });
}

export const agentTaskRunner: TaskRunner = {
  async run(task, prompt) {
    const bot = await getBot(task.agentId);
    if (!bot) return { ok: false, error: "the assigned agent was deleted" };
    const conversationId = taskConversationId(task.id);
    // A fresh model-side thread for every attempt, so a retry doesn't inherit a broken one.
    await bumpGeneration(conversationId);
    forgetConversation(conversationId);
    // The brief, saved as the opening message, so the task's transcript reads like a chat.
    await post({ id: randomUUID(), conversationId, role: "user", createdAt: new Date().toISOString(), status: "done", parts: [{ kind: "text", text: prompt }] });
    const reply = await runTurn({ bot, conversationId, content: prompt });
    if (!reply) return { ok: false, error: "stopped before it started" };
    // The final write-up must carry the deliverable itself, not only a link to a saved report.
    if (reply.status === "done") return { ok: true, output: task.isFinal ? inlineReportLinks(messageText(reply)) : messageText(reply) };
    return { ok: false, error: reply.error ?? `the turn ended as "${reply.status}"` };
  },
  async stop(task) {
    await stopConversation(taskConversationId(task.id));
  },
  post,
  writeHistory,
};
