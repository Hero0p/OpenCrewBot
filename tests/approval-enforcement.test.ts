// Proves that the permission rules are ENFORCED, not just decided: a real Mastra
// AgentController session (the same machinery runtime.ts uses) runs a scripted
// model that always tries to call a "send_message" tool. The tool's code records
// every time it actually runs, so a rejected or parked action that never runs
// leaves that record empty.
import { Agent } from "@mastra/core/agent";
import { AgentController, type AgentControllerEvent, type ToolCategory } from "@mastra/core/agent-controller";
import { MastraLanguageModelV2Mock } from "@mastra/core/test-utils/llm-mock";
import { createTool } from "@mastra/core/tools";
import { LibSQLStore } from "@mastra/libsql";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { applyPermissionRules, permissionRules } from "@/lib/server/permissions";
import type { ApprovalMode, ActionGroup } from "@/lib/shared/types";

type Prompt = { role: string }[];

/** A model that calls `toolName` once, then answers "done" after it sees the tool's result (or its rejection). */
function scriptedModel(toolName: string) {
  const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
  const stream = (parts: Record<string, unknown>[]) =>
    new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    });
  return new MastraLanguageModelV2Mock({
    provider: "test",
    modelId: "scripted",
    doStream: (async ({ prompt }: { prompt: Prompt }) => {
      const sawToolResult = prompt.at(-1)?.role === "tool";
      const parts = sawToolResult
        ? [
            { type: "text-start", id: "t" },
            { type: "text-delta", id: "t", delta: "done" },
            { type: "text-end", id: "t" },
            { type: "finish", finishReason: "stop", usage },
          ]
        : [
            { type: "tool-call", toolCallId: `call-${Math.random()}`, toolName, input: JSON.stringify({ text: "hello team" }) },
            { type: "finish", finishReason: "tool-calls", usage },
          ];
      return { stream: stream([{ type: "stream-start", warnings: [] }, ...parts]) };
    }) as never,
  });
}

interface Scenario {
  approval: ApprovalMode;
  preapprovedActions?: ActionGroup[];
  autoActionsPerDay?: number;
  autoActionsToday?: number;
  /** Which Mastra category the tool belongs to (as toolCategory() in tools.ts would say). */
  category: ToolCategory;
  /** How the person answers if the action asks for approval. */
  answer?: "approve" | "decline";
}

/** Run one turn in which the model tries the tool once; report whether it asked and whether the tool's code ran. */
async function runScenario(scenario: Scenario) {
  const ranWith: string[] = [];
  const sendMessage = createTool({
    id: "send_message",
    description: "Send a message to the team channel.",
    inputSchema: z.object({ text: z.string() }),
    execute: async ({ text }) => {
      ranWith.push(text);
      return { sent: true };
    },
  });

  const agent = new Agent({ id: "test-bot", name: "Test bot", instructions: "Test.", model: scriptedModel("send_message"), tools: { send_message: sendMessage } });
  const controller = new AgentController({
    id: `test-controller-${Math.random()}`,
    agent,
    storage: new LibSQLStore({ id: "test", url: "file::memory:" }),
    modes: [{ id: "chat", name: "Chat", metadata: { default: true } }],
    toolCategoryResolver: (name) => (name === "send_message" ? scenario.category : null),
  });
  await controller.init();
  const session = await controller.createSession({ resourceId: "owner", scope: "test", threadId: `thread-${Math.random()}` });

  const bot = { approval: scenario.approval, preapprovedActions: scenario.preapprovedActions ?? [], autoActionsPerDay: scenario.autoActionsPerDay ?? 20 };
  await applyPermissionRules(session.permissions, permissionRules(bot, scenario.autoActionsToday ?? 0));

  const events: AgentControllerEvent[] = [];
  let askedForApproval = false;
  const finished = new Promise<void>((resolve) => {
    session.subscribe((event) => {
      events.push(event);
      if (event.type === "tool_approval_required") {
        askedForApproval = true;
        if (scenario.answer) session.respondToToolApproval({ toolCallId: event.toolCallId, decision: scenario.answer });
        else resolve(); // nobody answers: the call stays parked
      }
      if (event.type === "agent_end" && event.reason !== "suspended") resolve();
    });
  });
  // sendMessage() only settles when the run ends, and a call parked on approval keeps the run open.
  const sending = session.sendMessage({ content: "Tell the team hello." });
  await finished;
  if (askedForApproval && !scenario.answer) {
    // Nobody answered: stop the run the way the Stop button does.
    session.abort();
  }
  await sending;
  const toolEnd = events.find((e) => e.type === "tool_end");
  await controller.destroy();
  return { askedForApproval, ranWith, toolEnd };
}

describe("approval enforcement (real Mastra session)", () => {
  it("Ask first: an app action asks, and a REJECTED action never runs", async () => {
    const result = await runScenario({ approval: "ask", category: "mcp", answer: "decline" });
    expect(result.askedForApproval).toBe(true);
    expect(result.ranWith).toEqual([]);
    expect(result.toolEnd).toMatchObject({ type: "tool_end", denied: true });
  });

  it("Ask first: an APPROVED action runs exactly once, with the arguments that were shown", async () => {
    const result = await runScenario({ approval: "ask", category: "mcp", answer: "approve" });
    expect(result.askedForApproval).toBe(true);
    expect(result.ranWith).toEqual(["hello team"]);
  });

  it("Ask first: an action nobody answers stays parked and does not run", async () => {
    const result = await runScenario({ approval: "ask", category: "mcp" });
    expect(result.askedForApproval).toBe(true);
    expect(result.ranWith).toEqual([]);
  });

  it("Controlled access: a pre-approved kind of action runs without asking", async () => {
    const result = await runScenario({ approval: "controlled", preapprovedActions: ["apps"], category: "mcp" });
    expect(result.askedForApproval).toBe(false);
    expect(result.ranWith).toEqual(["hello team"]);
  });

  it("Controlled access: a kind of action that isn't pre-approved still asks", async () => {
    const result = await runScenario({ approval: "controlled", preapprovedActions: ["apps"], category: "execute", answer: "decline" });
    expect(result.askedForApproval).toBe(true);
    expect(result.ranWith).toEqual([]);
  });

  it("Controlled access: once the daily limit is used up, pre-approved actions ask again", async () => {
    const result = await runScenario({ approval: "controlled", preapprovedActions: ["apps"], autoActionsPerDay: 3, autoActionsToday: 3, category: "mcp", answer: "decline" });
    expect(result.askedForApproval).toBe(true);
    expect(result.ranWith).toEqual([]);
  });

  it("Full access: actions run without asking", async () => {
    const result = await runScenario({ approval: "full", category: "mcp" });
    expect(result.askedForApproval).toBe(false);
    expect(result.ranWith).toEqual(["hello team"]);
  });

  it("Full access: a tool nobody classified still asks", async () => {
    const result = await runScenario({ approval: "full", category: "other", answer: "decline" });
    expect(result.askedForApproval).toBe(true);
    expect(result.ranWith).toEqual([]);
  });
});
