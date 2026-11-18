// Demo 7 through the whole app (not just a bare Mastra session): an agent on "Ask first" tries to
// post to Slack with act_in_app. The request waits in the Approval Centre with the exact inputs;
// rejected, the action never runs (no simulated post is written, the audit log says "not run");
// approved, it runs exactly once. Mock mode, so "running" writes a SIMULATED report instead of posting.
import { beforeAll, describe, expect, it } from "vitest";
import { boot, createBot, decideApproval, sendMessage } from "@/lib/server/service";
import { listApprovalsByStatus, listAudit, listMessages } from "@/lib/server/db";
import { listFiles } from "@/lib/server/files";
import type { ApprovalRecord, Bot, ChatMessage } from "@/lib/shared/types";

let sasha: Bot;

beforeAll(async () => {
  await boot();
  sasha = await createBot({
    name: "Sasha Test",
    title: "Growth",
    description: "",
    instructions: "",
    emoji: "",
    color: "#22c55e",
    model: "google/gemini-2.5-flash",
    tools: { webSearch: false, memory: false, codeMode: false, browser: false, askUser: false, files: false, planning: false, teamwork: false },
    approval: "ask",
    pinned: false,
    connections: ["composio:slack"],
  });
});

const wait = async <T>(check: () => Promise<T | undefined>, what: string): Promise<T> => {
  for (let i = 0; i < 200; i++) {
    const found = await check();
    if (found) return found;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
};

const pendingFor = (conversationId: string) =>
  wait(async () => (await listApprovalsByStatus(["pending"])).find((a) => a.conversationId === conversationId), "the approval request");

const simulatedPosts = () => listFiles().filter((f) => f.path.includes("simulated-slack-send-message")).length;

const lastReply = (conversationId: string) =>
  wait(async () => {
    const m = (await listMessages(conversationId)).filter((x) => x.role === "bot").at(-1);
    return m && m.status !== "streaming" ? m : undefined;
  }, "the reply to finish");

describe("Demo 7 end to end: an app action waits for approval, and a rejected one never runs", () => {
  it("rejected: nothing is posted, the chat and the audit log say it didn't run", async () => {
    const conversationId = `dm:${sasha.id}`;
    const before = simulatedPosts();
    await sendMessage(conversationId, 'Please post "Spring counselling is open" to #general on Slack.');
    const request: ApprovalRecord = await pendingFor(conversationId);
    expect(request.label).toContain("Slack: send message");
    expect(request.argsPreview).toContain("#general");
    expect(request.argsPreview).toContain("Spring counselling is open");

    await decideApproval(request.id, false);
    const reply: ChatMessage = await lastReply(conversationId);
    const step = reply.parts.find((p) => p.kind === "tool" && p.name === "act_in_app");
    expect(step && step.kind === "tool" ? step.status : undefined).toBe("denied");
    expect(simulatedPosts()).toBe(before);
    const audit = (await listAudit(50)).filter((e) => e.conversationId === conversationId);
    expect(audit.map((e) => e.event)).toEqual(expect.arrayContaining(["approval.requested", "approval.rejected", "tool.not_run"]));
    expect(audit.some((e) => e.event === "tool.ran_approved" || e.event === "tool.ran_auto")).toBe(false);
  }, 60_000);

  it("approved: it runs exactly once (in mock mode, as a SIMULATED post written to Files)", async () => {
    const conversationId = `dm:${sasha.id}`;
    const before = simulatedPosts();
    await sendMessage(conversationId, 'Please post "Webinar on Friday" to #general on Slack.');
    const request = await pendingFor(conversationId);
    await decideApproval(request.id, true);
    const reply = await lastReply(conversationId);
    const step = reply.parts.find((p) => p.kind === "tool" && p.name === "act_in_app");
    expect(step && step.kind === "tool" ? step.simulated : undefined).toBe(true);
    expect(simulatedPosts()).toBe(before + 1);
    const audit = (await listAudit(50)).filter((e) => e.conversationId === conversationId);
    expect(audit.some((e) => e.event === "tool.ran_approved")).toBe(true);
  }, 60_000);
});
