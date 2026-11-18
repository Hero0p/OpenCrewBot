// The execution engine, with a fake task runner so every behaviour can be shown exactly:
// parallel starts, dependencies, retries, reassignment, timeouts, cancellation, plan changes, restart recovery.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  PlanError,
  cancelRun,
  cancelTask,
  parallelWaves,
  readyTasks,
  recoverRuns,
  retryTask,
  setEngineTimings,
  setTaskRunner,
  startRun,
  updateRun,
  validatePlan,
  type PlannedTask,
  type TaskOutcome,
} from "@/lib/server/engine";
import { getRun, getTask, listTasks, saveTask } from "@/lib/server/db";
import { canRetry } from "@/lib/shared/runs";
import { createBot } from "@/lib/server/service";
import type { Bot, ChatMessage, Run, Task } from "@/lib/shared/types";

// ── a fake runner whose behaviour each test chooses ─────────────────────

interface Call {
  key: string;
  agentId: string;
  prompt: string;
  startedAt: number;
  endedAt?: number;
}

let calls: Call[] = [];
let posts: ChatMessage[] = [];
let stopped: string[] = [];
let histories: string[] = [];
/** How the fake agent handles one attempt; default: succeed after 30 ms. */
let behaviour: (task: Task, attemptIndex: number) => Promise<TaskOutcome> = () => delay(30).then(() => ({ ok: true, output: "done" }));
const stopHandlers = new Map<string, () => void>();

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  calls = [];
  posts = [];
  stopped = [];
  histories = [];
  behaviour = (task) => delay(30).then(() => ({ ok: true, output: `result of ${task.key}` }));
  setEngineTimings({ retryDelaysMs: [20], taskTimeoutMs: 2_000 });
  setTaskRunner({
    async run(task, prompt) {
      const call: Call = { key: task.key, agentId: task.agentId, prompt, startedAt: Date.now() };
      calls.push(call);
      const attemptIndex = calls.filter((c) => c.key === task.key).length - 1;
      const stoppedEarly = new Promise<TaskOutcome>((resolve) => stopHandlers.set(task.id, () => resolve({ ok: false, error: "stopped" })));
      const outcome = await Promise.race([behaviour(task, attemptIndex), stoppedEarly]);
      call.endedAt = Date.now();
      return outcome;
    },
    async stop(task) {
      stopped.push(task.key);
      stopHandlers.get(task.id)?.();
    },
    async post(message) {
      posts.push(message);
    },
    async writeHistory(run) {
      histories.push(run.id);
    },
  });
});

/** Wait until a run has ended (or fail after a few seconds). */
async function finished(runId: string, ms = 8_000): Promise<Run> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const run = await getRun(runId);
    if (run && run.status !== "running") return run;
    await delay(20);
  }
  throw new Error("run didn't finish in time");
}

let planner: Bot;
let researcherA: Bot;
let researcherB: Bot;
let writer: Bot;

async function agent(name: string, skills: string[]): Promise<Bot> {
  return createBot({
    name,
    title: "",
    description: "",
    instructions: "",
    emoji: "",
    color: "#fff",
    model: "google/gemini-2.5-flash",
    tools: { webSearch: false, memory: false, codeMode: false, browser: false, askUser: false, files: false, planning: false, teamwork: false },
    approval: "ask",
    pinned: false,
    skills,
  });
}

beforeAll(async () => {
  planner = await agent("Planner", ["report-consolidation"]);
  researcherA = await agent("ResearcherA", ["market-research"]);
  researcherB = await agent("ResearcherB", ["market-research"]);
  writer = await agent("Writer", ["email-drafting"]);
});

const task = (key: string, agentId: string, dependsOn: string[] = [], skill?: string): PlannedTask => ({
  key,
  title: `Task ${key}`,
  brief: `Do ${key}`,
  expectedOutput: "a result",
  agentId,
  dependsOn,
  skill,
});

const newRun = (tasks: PlannedTask[]) =>
  startRun({ title: "Test plan", goal: "Test the engine", conversationId: "dm:test", plannerBotId: planner.id, project: null, tasks, finalOutput: "one report" });

// ── plan checks ─────────────────────────────────────────────────────────

describe("plan checks", () => {
  const code = (fn: () => void) => {
    try {
      fn();
    } catch (error) {
      return (error as PlanError).code;
    }
    return "no error";
  };

  it("rejects empty plans, duplicate keys, unknown dependencies and cycles", () => {
    expect(code(() => validatePlan([]))).toBe("PLAN_EMPTY");
    expect(code(() => validatePlan([task("a", "x"), task("a", "x")]))).toBe("PLAN_DUPLICATE_KEY");
    expect(code(() => validatePlan([task("final", "x")]))).toBe("PLAN_DUPLICATE_KEY");
    expect(code(() => validatePlan([task("a", "x", ["zzz"])]))).toBe("PLAN_UNKNOWN_DEPENDENCY");
    expect(code(() => validatePlan([task("a", "x", ["b"]), task("b", "x", ["a"])]))).toBe("PLAN_CYCLE");
    expect(code(() => validatePlan(Array.from({ length: 9 }, (_, i) => task(`t${i}`, "x"))))).toBe("PLAN_TOO_BIG");
  });

  it("groups tasks into waves that can run at the same time", () => {
    expect(parallelWaves([task("a", "x"), task("b", "x"), task("c", "x", ["a", "b"]), task("d", "x", ["c"])])).toEqual([["a", "b"], ["c"], ["d"]]);
  });

  it("treats a failed dependency as ended, so the dependent still runs", () => {
    const base = { runId: "r", title: "", brief: "", expectedOutput: "", isFinal: false, attempt: 0, maxAttempts: 2, createdAt: "", triedAgentIds: [], agentId: "x" };
    const tasks: Task[] = [
      { ...base, id: "1", key: "a", dependsOn: [], status: "failed" },
      { ...base, id: "2", key: "b", dependsOn: ["a"], status: "pending" },
    ];
    expect(readyTasks(tasks).map((t) => t.key)).toEqual(["b"]);
  });
});

// ── running ─────────────────────────────────────────────────────────────

describe("running a plan", () => {
  it("runs independent tasks at the same time, waits for dependencies, and ends with the planner's consolidation", async () => {
    behaviour = (t) => delay(150).then(() => ({ ok: true, output: `result of ${t.key}` }));
    const { run } = await newRun([task("a", researcherA.id), task("b", researcherB.id), task("c", writer.id, ["a", "b"])]);
    const done = await finished(run.id);

    const at = (key: string) => calls.find((c) => c.key === key)!;
    // a and b overlapped in time (parallel), c started only after both ended.
    expect(at("a").startedAt).toBeLessThan(at("b").endedAt!);
    expect(at("b").startedAt).toBeLessThan(at("a").endedAt!);
    expect(at("c").startedAt).toBeGreaterThanOrEqual(Math.max(at("a").endedAt!, at("b").endedAt!));
    // c's brief contains a's and b's results; the final task ran last, by the planner.
    expect(at("c").prompt).toContain("result of a");
    expect(at("c").prompt).toContain("result of b");
    expect(at("final").agentId).toBe(planner.id);
    expect(done).toMatchObject({ status: "completed", result: "result of final" });
    // The deliverable was posted where the run started, and run history was written.
    expect(posts.some((m) => m.role === "bot" && m.conversationId === "dm:test" && JSON.stringify(m.parts).includes("result of final"))).toBe(true);
    expect(histories).toContain(run.id);
  });

  it("retries a failed attempt after a delay", async () => {
    behaviour = (t, attempt) => delay(10).then(() => (t.key === "a" && attempt === 0 ? { ok: false, error: "rate limited" } : { ok: true, output: "ok" }));
    const { run } = await newRun([task("a", researcherA.id)]);
    await finished(run.id);
    const a = (await listTasks(run.id)).find((t) => t.key === "a")!;
    expect(a).toMatchObject({ status: "completed", attempt: 2 });
    expect((await getRun(run.id))?.events.some((e) => e.text.includes("Retrying"))).toBe(true);
  });

  it("hands a task to another agent with the same skill after its retries fail", async () => {
    behaviour = (t) => delay(10).then(() => (t.key === "a" && t.agentId === researcherA.id ? { ok: false, error: "model error" } : { ok: true, output: "ok" }));
    const { run } = await newRun([task("a", researcherA.id, [], "market-research")]);
    await finished(run.id);
    const a = (await listTasks(run.id)).find((t) => t.key === "a")!;
    expect(a).toMatchObject({ status: "completed", agentId: researcherB.id, triedAgentIds: [researcherA.id] });
    expect(posts.some((m) => m.role === "notice" && JSON.stringify(m.parts).includes("reassigned"))).toBe(true);
  });

  it("marks a task failed when nobody else can do it, and the plan continues without it", async () => {
    behaviour = (t) => delay(10).then(() => (t.key === "a" ? { ok: false, error: "broken" } : { ok: true, output: `result of ${t.key}` }));
    const { run } = await newRun([task("a", writer.id, [], "email-drafting"), task("b", researcherA.id, ["a"])]);
    const done = await finished(run.id);
    const tasks = await listTasks(run.id);
    expect(tasks.find((t) => t.key === "a")?.status).toBe("failed");
    expect(tasks.find((t) => t.key === "b")?.status).toBe("completed");
    expect(calls.find((c) => c.key === "b")?.prompt).toContain("FAILED");
    expect(done.status).toBe("completed");
  });

  it("keeps the team's work when the final write-up fails, and a retry of the write-up reopens the plan", async () => {
    let finalWorks = false;
    behaviour = (t) => delay(10).then(() => (t.isFinal && !finalWorks ? { ok: false, error: "quota used up" } : { ok: true, output: `result of ${t.key}` }));
    const { run } = await newRun([task("a", researcherA.id)]);
    const failed = await finished(run.id);
    expect(failed.status).toBe("failed");
    expect(failed.result).toContain("didn't complete");
    expect(failed.result).toContain("result of a");
    expect(posts.at(-1)?.parts[0]).toMatchObject({ kind: "text", text: expect.stringContaining("result of a") });

    // A cancelled or non-final task of a failed plan can't be retried; the final one can.
    const tasks = await listTasks(run.id);
    const final = tasks.find((t) => t.isFinal)!;
    expect(canRetry(failed, tasks.find((t) => t.key === "a")!)).toBe(false);
    expect(canRetry(failed, final)).toBe(true);

    finalWorks = true;
    await retryTask(final.id);
    const done = await finished(run.id);
    expect(done.status).toBe("completed");
    expect(done.result).toBe("result of final");
  });

  it("stops a task that runs too long, and retries it", async () => {
    setEngineTimings({ taskTimeoutMs: 100, retryDelaysMs: [10] });
    behaviour = (t, attempt) => (attempt === 0 ? new Promise<TaskOutcome>(() => {}) : delay(10).then(() => ({ ok: true, output: "ok" }))); // first attempt hangs
    const { run } = await newRun([task("a", researcherA.id)]);
    await finished(run.id);
    expect(stopped).toContain("a");
    expect((await listTasks(run.id)).find((t) => t.key === "a")).toMatchObject({ status: "completed", attempt: 2 });
  });
});

// ── control ─────────────────────────────────────────────────────────────

describe("controlling a plan", () => {
  it("cancels one running task; its dependents still run", async () => {
    behaviour = (t) => (t.key === "slow" ? new Promise<TaskOutcome>(() => {}) : delay(10).then(() => ({ ok: true, output: "ok" })));
    const { run, tasks } = await newRun([task("slow", researcherA.id), task("next", writer.id, ["slow"])]);
    await delay(80);
    await cancelTask(tasks.find((t) => t.key === "slow")!.id);
    const done = await finished(run.id);
    expect(stopped).toContain("slow");
    const after = await listTasks(run.id);
    expect(after.find((t) => t.key === "slow")?.status).toBe("cancelled");
    expect(after.find((t) => t.key === "next")?.status).toBe("completed");
    expect(done.status).toBe("completed");
  });

  it("cancels a whole run", async () => {
    behaviour = () => new Promise<TaskOutcome>(() => {});
    const { run } = await newRun([task("a", researcherA.id), task("b", researcherB.id)]);
    await delay(80);
    await cancelRun(run.id);
    expect((await getRun(run.id))?.status).toBe("cancelled");
    expect((await listTasks(run.id)).every((t) => t.status === "cancelled")).toBe(true);
  });

  it("changes a running plan: cancels a task and adds one, and the final task waits for the new one", async () => {
    behaviour = (t) => (t.key === "a" ? delay(300).then(() => ({ ok: true, output: "a" })) : delay(10).then(() => ({ ok: true, output: t.key })));
    const { run } = await newRun([task("a", researcherA.id), task("b", writer.id, ["a"])]);
    await delay(50);
    await updateRun(run.id, { cancelKeys: ["b"], add: [task("c", researcherB.id, ["a"])], note: "the person changed the brief" });
    await finished(run.id);
    const tasks = await listTasks(run.id);
    expect(tasks.find((t) => t.key === "b")?.status).toBe("cancelled");
    expect(tasks.find((t) => t.key === "c")?.status).toBe("completed");
    expect(tasks.find((t) => t.isFinal)?.dependsOn).toContain("c");
    expect(calls.find((c) => c.key === "final")?.prompt).toContain("### Task c");
  });

  it("lets a task added mid-run feed a task that hasn't started, and refuses feeding one that has", async () => {
    behaviour = (t) => (t.key === "a" ? delay(300).then(() => ({ ok: true, output: "a" })) : delay(10).then(() => ({ ok: true, output: `result of ${t.key}` })));
    const { run } = await newRun([task("a", researcherA.id), task("b", writer.id, ["a"])]);
    await delay(50);
    await expect(updateRun(run.id, { cancelKeys: [], add: [{ ...task("x", researcherB.id), feeds: ["a"] }], note: "too late for a" })).rejects.toThrow(/already started/);
    await updateRun(run.id, { cancelKeys: [], add: [{ ...task("c", researcherB.id), feeds: ["b"] }], note: "b should use c" });
    await finished(run.id);
    const tasks = await listTasks(run.id);
    expect(tasks.find((t) => t.key === "b")?.dependsOn).toEqual(["a", "c"]);
    expect(calls.find((c) => c.key === "b")?.prompt).toContain("result of c");
    expect(tasks.some((t) => t.key === "x")).toBe(false);
  });

  it("refuses plan changes that don't fit", async () => {
    behaviour = () => delay(200).then(() => ({ ok: true, output: "ok" }));
    const { run } = await newRun([task("a", researcherA.id)]);
    await expect(updateRun(run.id, { cancelKeys: [], add: [task("a", writer.id)], note: "dup" })).rejects.toThrow(PlanError);
    await finished(run.id);
  });
});

// ── recovery ────────────────────────────────────────────────────────────

describe("restart recovery", () => {
  it("puts a task that was cut off by a restart back in the queue, and the run finishes", async () => {
    behaviour = () => new Promise<TaskOutcome>(() => {}); // the "old process" never finishes
    const { run, tasks } = await newRun([task("a", researcherA.id)]);
    await delay(50);
    // Simulate the restart: the old in-flight attempt is gone; the database still says "running".
    const a = (await getTask(tasks.find((t) => t.key === "a")!.id))!;
    expect(a.status).toBe("running");
    const g = globalThis as { __opencrewbotEngine?: { running: Set<string> } };
    g.__opencrewbotEngine?.running.delete(a.id);
    await saveTask({ ...a, status: "running" });

    behaviour = () => delay(10).then(() => ({ ok: true, output: "after restart" }));
    expect(await recoverRuns()).toBeGreaterThanOrEqual(1);
    const done = await finished(run.id);
    expect(done.status).toBe("completed");
    expect(done.events.some((e) => e.text.includes("interrupted by a server restart"))).toBe(true);
    // The cut-off attempt doesn't count against the task: it finishes on attempt 1 again.
    expect((await getTask(a.id))?.attempt).toBe(1);
  });
});
