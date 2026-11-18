// The Chief of Staff's planning (Step 9): checking a plan's owners and skills, what the planner sees,
// and the whole pipeline end to end in mock mode: one message → plan → tasks in the engine → final deliverable.
import { beforeAll, describe, expect, it } from "vitest";
import { boot, sendMessage } from "@/lib/server/service";
import { listBots, listMessages, listRooms, listRuns, listTasks } from "@/lib/server/db";
import { mockPlan, planningSections, resolvePlanTasks } from "@/lib/server/planning";
import { changedAPlan } from "@/lib/server/rooms";
import type { Bot, ChatMessage } from "@/lib/shared/types";

let team: Bot[];
let morgan: Bot;

beforeAll(async () => {
  // No provider keys in tests, so bots run on the mock model; boot() seeds the workforce and wires the engine.
  await boot();
  team = await listBots();
  morgan = team.find((b) => b.handle === "morgan")!;
});

const task = (agent: string, extra: Partial<{ key: string; skill: string; dependsOn: string[] }> = {}) => ({
  key: extra.key ?? "t1",
  title: "A task",
  agent,
  brief: "Do something useful with enough context to work alone.",
  expectedOutput: "a result",
  skill: extra.skill,
  dependsOn: extra.dependsOn ?? [],
});

describe("checking a plan", () => {
  it("gives Morgan the planning tools after seeding", () => {
    expect(morgan.tools.planning).toBe(true);
    expect(morgan.instructions).toContain("create_plan");
  });

  it("resolves @handles to agents", async () => {
    const [resolved] = await resolvePlanTasks(morgan, [task("@vega", { skill: "competitor-analysis" })]);
    expect(resolved.agentId).toBe(team.find((b) => b.handle === "vega")!.id);
  });

  it("treats a task without dependsOn as independent (models often leave it out)", async () => {
    const withoutDeps = { ...task("vega"), dependsOn: undefined };
    const [resolved] = await resolvePlanTasks(morgan, [withoutDeps]);
    expect(resolved.dependsOn).toEqual([]);
  });

  it("explains unknown teammates, self-assignment and missing skills, all at once", async () => {
    const attempt = resolvePlanTasks(morgan, [task("nobody", { key: "a" }), task("morgan", { key: "b" }), task("leo", { key: "c", skill: "competitor-analysis" })]);
    await expect(attempt).rejects.toThrow(/no teammate @nobody/);
    await expect(attempt).rejects.toThrow(/You write the final deliverable yourself/);
    await expect(attempt).rejects.toThrow(/@leo doesn't have the "competitor-analysis" skill. Teammates who do: @vega/);
  });
});

describe("what the planner sees", () => {
  it("lists the team with skills, and the planning rules, for planning bots only", async () => {
    const sections = (await planningSections(morgan, `dm:${morgan.id}`)).join("\n");
    expect(sections).toContain("## How you run team work");
    expect(sections).toContain("@vega: Vega, Competitive Intelligence Analyst");
    expect(sections).toContain("Skills: competitor-analysis, market-research");
    const iris = team.find((b) => b.handle === "iris")!;
    expect(await planningSections(iris, `dm:${iris.id}`)).toEqual([]);
  });

  it("the mock plan uses a researcher and a checker", () => {
    const plan = mockPlan("Research MeetUniversity competitors", team, morgan);
    expect(plan.tasks.map((t) => t.key)).toEqual(["research", "verify"]);
    expect(plan.tasks[1].dependsOn).toEqual(["research"]);
  });
});

describe("end to end (mock mode): one message to the Chief of Staff becomes a finished team run", () => {
  it("plans, runs the tasks through the engine, and posts the final deliverable back", async () => {
    const conversationId = `dm:${morgan.id}`;
    await sendMessage(conversationId, "Research the competitors of MeetUniversity and give me a short report.");

    // Wait for the run the planner started from this chat to finish.
    const deadline = Date.now() + 45_000;
    let run = (await listRuns()).find((r) => r.conversationId === conversationId);
    while (Date.now() < deadline && (!run || run.status === "running")) {
      await new Promise((r) => setTimeout(r, 200));
      run = (await listRuns()).find((r) => r.conversationId === conversationId);
    }
    expect(run?.status).toBe("completed");

    const tasks = await listTasks(run!.id);
    expect(tasks.map((t) => t.key)).toEqual(["research", "verify", "final"]);
    expect(tasks.every((t) => t.status === "completed")).toBe(true);
    // Mock results are labelled as simulated, never presented as real work.
    expect(tasks[0].output).toContain("SIMULATED");
    // The verify task received the research result as input (its transcript starts with the brief).
    const verifyBrief = (await listMessages(`task:${tasks[1].id}`)).find((m) => m.role === "user");
    expect(JSON.stringify(verifyBrief?.parts)).toContain("SIMULATED result");

    // Back in the chat: progress notices and the final deliverable from Morgan.
    const chat = await listMessages(conversationId);
    expect(chat.some((m) => m.role === "notice" && JSON.stringify(m.parts).includes("finished"))).toBe(true);
    const final = chat.find((m) => m.role === "bot" && JSON.stringify(m.parts).includes("Plan finished"));
    expect(final?.botId).toBe(morgan.id);
  }, 60_000);
});

describe("plans started in a room", () => {
  it("a message to @morgan that names teammates goes to Morgan alone; the teammates work as tasks, not as room replies", async () => {
    const room = (await listRooms()).find((r) => r.name === "Marketing Campaign")!;
    const leo = team.find((b) => b.handle === "leo")!;
    const conversationId = `room:${room.id}`;
    await sendMessage(conversationId, "@morgan plan this with @leo: three LinkedIn post ideas for Indian parents.");

    const deadline = Date.now() + 45_000;
    let run = (await listRuns()).find((r) => r.conversationId === conversationId);
    while (Date.now() < deadline && (!run || run.status === "running")) {
      await new Promise((r) => setTimeout(r, 200));
      run = (await listRuns()).find((r) => r.conversationId === conversationId);
    }
    expect(run?.status).toBe("completed");
    const repliers = new Set((await listMessages(conversationId)).filter((m) => m.role === "bot").map((m) => m.botId));
    expect(repliers.has(morgan.id)).toBe(true);
    expect(repliers.has(leo.id)).toBe(false);
  }, 60_000);

  it("a reply that started a plan hands nothing off: its @mentions describe tasks the engine already assigned", () => {
    const reply = (parts: ChatMessage["parts"]): ChatMessage => ({ id: "m", conversationId: "room:r", role: "bot", createdAt: "", status: "done", parts });
    const planCall = { kind: "tool" as const, toolCallId: "c", name: "create_plan", label: "Plan", status: "done" as const };
    expect(changedAPlan(reply([planCall, { kind: "text", text: "@leo drafts the posts." }]))).toBe(true);
    expect(changedAPlan(reply([{ kind: "text", text: "@leo, can you draft the posts?" }]))).toBe(false);
  });
});
