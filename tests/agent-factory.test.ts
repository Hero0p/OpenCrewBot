// Module B: the Agent Factory turns a description into a complete, checked agent that's usable at once,
// from the New bot form and from the Chief of Staff (create_agent, create_room).
import { beforeAll, describe, expect, it } from "vitest";
import { checkDraft, draftAgent, ruleDraft, uniqueName, writeStartingMemory } from "@/lib/server/agent-factory";
import { planningTools, resolvePlanTasks } from "@/lib/server/planning";
import { boot, createBot, createRoom } from "@/lib/server/service";
import { getRoom, listBots, listRooms } from "@/lib/server/db";
import { readMemory } from "@/lib/server/memory-files";
import type { Bot } from "@/lib/shared/types";
import type { ToolsInput } from "@mastra/core/agent";

let morgan: Bot;

beforeAll(async () => {
  await boot();
  morgan = (await listBots()).find((b) => b.handle === "morgan")!;
});

/** A tool's execute function. ToolsInput also allows provider tools without one, so check before calling. */
function executeOf<T>(tool: ToolsInput[string]): (input: unknown, context: unknown) => Promise<T> {
  if (!("execute" in tool) || typeof tool.execute !== "function") throw new Error("this tool can't be executed directly");
  // Safe: tools made with createTool always take (input, context); the union type just doesn't say which.
  return tool.execute as (input: unknown, context: unknown) => Promise<T>;
}

/** What Mastra hands a tool: the conversation it runs in, through the request context. */
const inConversation = (scope: string) => ({ requestContext: { get: (k: string) => (k === "controller" ? { scope } : undefined) } });

describe("checking a draft", () => {
  it("keeps only real skills, always turns memory on, and never gives a browser or planning", () => {
    const raw = { ...ruleDraft("A pricing analyst called Priya who compares study-abroad counselling fees in India."), skills: ["financial-modelling", "made-up-skill"] };
    const draft = checkDraft({ ...raw, webSearch: true }, false);
    expect(draft.input.name).toBe("Priya");
    expect(draft.input.skills).toEqual(["financial-modelling"]);
    expect(draft.notes.join(" ")).toContain("made-up-skill");
    expect(draft.input.tools).toMatchObject({ memory: true, browser: false, planning: false, webSearch: true });
    expect(draft.input.approval).toBe("ask");
    expect(draft.input.model).toMatch(/\//);
  });

  it("drafts in mock mode with keyword rules, and says so", async () => {
    const draft = await draftAgent("A competitor research analyst who tracks study-abroad platforms and reports changes weekly.");
    expect(draft.simulated).toBe(true);
    expect(draft.notes[0]).toContain("mock model");
    expect(draft.input.skills).toContain("competitor-analysis");
    await expect(draftAgent("too short")).rejects.toThrow(/sentence or two/);
  });
});

describe("creating an agent", () => {
  it("writes the starting memory with where it came from", async () => {
    const draft = await draftAgent("A content strategist named Asha who plans Instagram posts for Class 11 students.");
    const bot = await createBot(draft.input);
    writeStartingMemory(bot.id, ["Audience: Class 11 students and their parents."], "you");
    const memory = readMemory(bot.id);
    expect(memory).toContain("Audience: Class 11 students");
    expect(memory).toContain("by: you");
    expect(memory).toContain("in: Agent Factory");
  });

  it("lets the Chief of Staff create an agent in a room, and assign it right away", async () => {
    const room = await createRoom({ name: "Pricing desk", topic: "", emoji: "", memberIds: [morgan.id], leadId: morgan.id, responder: "lead", mode: "sequential", pinned: false });
    const tools = planningTools(morgan);
    const execute = executeOf<{ handle: string; joinedRoom: string | null }>(tools.create_agent);
    const result = await execute(
      { description: "A pricing analyst who compares study-abroad counselling fees in India and outputs a sourced table.", why: "Nobody on the team covers pricing research." },
      inConversation(`room:${room.id}`),
    );
    expect(result.joinedRoom).toBe("Pricing desk");
    const created = (await listBots()).find((b) => b.handle === result.handle)!;
    expect(created.approval).toBe("ask");
    expect((await getRoom(room.id))?.memberIds).toContain(created.id);
    expect(readMemory(created.id)).toContain(`by: ${morgan.name}`);
    // Usable immediately: the planner can give it a task.
    const [task] = await resolvePlanTasks(morgan, [{ key: "fees", title: "Compare fees", agent: result.handle, brief: "Compare counselling fees across the top five platforms.", expectedOutput: "A table", dependsOn: [] }]);
    expect(task.agentId).toBe(created.id);
  });

  it("never gives two agents the same name (seen live: two agents both called Riya)", async () => {
    expect(uniqueName("Riya", "Bakery Pricing Specialist", ["Riya", "Morgan"])).toBe("Riya (Bakery)");
    expect(uniqueName("Priya", "Pricing Analyst", ["Riya"])).toBe("Priya");
    await createBot((await draftAgent("A data storyteller named Meera who turns sales numbers into slides.")).input);
    const second = await draftAgent("A data storyteller named Meera who writes monthly summaries.");
    expect(second.input.name).not.toBe("Meera");
    expect(second.notes.join(" ")).toContain("already on the team");
  });

  it("gives an agent the Chief of Staff creates the Chief of Staff's own (working) model", async () => {
    const execute = executeOf<{ handle: string; model: string }>(planningTools(morgan).create_agent);
    const result = await execute({ description: "A logistics planner who schedules bakery deliveries across Pune and outputs a weekly route plan.", why: "Nobody plans deliveries." }, inConversation(`dm:${morgan.id}`));
    expect(result.model).toBe(morgan.model);
  });

  it("lets the Chief of Staff create a room with teammates, and refuses unknown handles", async () => {
    const tools = planningTools(morgan);
    const execute = executeOf<{ room: string }>(tools.create_room);
    const result = await execute({ name: "Launch room", topic: "January launch", members: ["@leo", "maya"] }, inConversation(`dm:${morgan.id}`));
    expect(result.room).toBe("Launch room");
    const room = (await listRooms()).find((r) => r.name === "Launch room")!;
    expect(room.leadId).toBe(morgan.id);
    await expect(execute({ name: "Bad room", topic: "", members: ["nobody"] }, inConversation(`dm:${morgan.id}`))).rejects.toThrow(/No teammate @nobody/);
  });
});
