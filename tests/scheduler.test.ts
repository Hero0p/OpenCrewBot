// Module I: workflows on a schedule, with Run now, pause / resume, history, catch-up after
// the app was off, failure reports, and the previous result handed to the next run.
import { beforeAll, describe, expect, it } from "vitest";
import { MIN_INTERVAL_MINUTES, checkSchedule, createWorkflow, nextRunAfter, recoverWorkflowRuns, runWorkflowNow, setWorkflowTurnRunner, tick, updateWorkflow, workflowPrompt } from "@/lib/server/scheduler";
import { boot } from "@/lib/server/service";
import { getWorkflow, listBots, listMessages, listWorkflowRuns, saveWorkflow, saveWorkflowRun } from "@/lib/server/db";
import { runTurn } from "@/lib/server/runtime";
import { describeSchedule } from "@/lib/shared/schedules";
import type { Bot, WorkflowRun } from "@/lib/shared/types";

let morgan: Bot;
let iris: Bot;

beforeAll(async () => {
  await boot();
  const bots = await listBots();
  morgan = bots.find((b) => b.handle === "morgan")!;
  iris = bots.find((b) => b.handle === "iris")!;
});

/** Wait until the workflow's latest run has ended. */
async function lastRun(workflowId: string): Promise<WorkflowRun> {
  for (let i = 0; i < 450; i++) {
    const [run] = await listWorkflowRuns(workflowId, 1);
    if (run && run.status !== "running") return run;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("the workflow run didn't finish");
}

describe("schedules", () => {
  it("describes common schedules in plain words", () => {
    expect(describeSchedule("0 9 * * 1")).toBe("Every Monday at 09:00");
    expect(describeSchedule("*/5 * * * *")).toBe("Every 5 minutes");
    expect(describeSchedule("0 9 * * *")).toBe("Every day at 09:00");
    expect(describeSchedule("7 3 * 6 *")).toBe("Custom schedule: 7 3 * 6 *");
  });

  it("computes the next run, and refuses unreadable or too-frequent schedules", () => {
    expect(nextRunAfter("0 9 * * *", new Date("2026-11-18T08:00:00")).getHours()).toBe(9);
    expect(() => checkSchedule("every monday")).toThrow(/5-part/);
    expect(() => checkSchedule("* * * * *")).toThrow(new RegExp(`every ${MIN_INTERVAL_MINUTES} minutes`));
    expect(() => checkSchedule("*/5 * * * *")).not.toThrow();
  });
});

describe("running workflows (mock model)", () => {
  it("runs now, turns into a team plan, saves the result and a report", async () => {
    setWorkflowTurnRunner((bot, conversationId, content) => runTurn({ bot, conversationId, content }));
    const workflow = await createWorkflow({ name: "Competitor monitor", instruction: "Check MeetUniversity's competitors and report what changed.", botId: morgan.id, schedule: "0 9 * * 1", enabled: true });
    expect(workflow.nextRunAt).toBeDefined();
    await runWorkflowNow(workflow.id);
    const run = await lastRun(workflow.id);
    expect(run).toMatchObject({ status: "completed", trigger: "manual", simulated: true });
    expect(run.planRunId).toBeDefined();
    expect(run.result).toContain("SIMULATED");
    expect(run.reportPath).toMatch(/^reports\/competitor-monitor/);
    // The run's transcript opens with the instruction, and says it's the first run.
    const transcript = await listMessages(run.conversationId);
    expect(JSON.stringify(transcript[0].parts)).toContain("first run");
  }, 60_000);

  it("gives the next run the previous result to compare with", () => {
    const workflow = { id: "w", name: "Monitor", instruction: "Check competitors.", botId: "b", schedule: "0 9 * * 1", enabled: true, createdAt: "" };
    const run = { id: "r2", workflowId: "w", trigger: "schedule" as const, status: "running" as const, startedAt: "2026-11-25T09:00:00Z", conversationId: "workflow:r2", simulated: false };
    const previous = { ...run, id: "r1", status: "completed" as const, startedAt: "2026-11-18T09:00:00Z", result: "Yocket raised prices to ₹64,999." };
    const prompt = workflowPrompt(workflow, run, previous);
    expect(prompt).toContain("Yocket raised prices");
    expect(prompt).toContain("what changed");
  });

  it("runs a due workflow on the tick, and makes up a missed one once (catch-up)", async () => {
    setWorkflowTurnRunner(async (bot, conversationId) => ({ id: crypto.randomUUID(), conversationId, role: "bot", botId: bot.id, createdAt: new Date().toISOString(), status: "done", parts: [{ kind: "text", text: "Nothing changed this week." }] }));
    const workflow = await createWorkflow({ name: "Daily summary", instruction: "Summarise yesterday's work in five bullets.", botId: iris.id, schedule: "0 9 * * *", enabled: true });
    // Pretend it was due an hour ago (the app was off then).
    await saveWorkflow({ ...workflow, nextRunAt: new Date(Date.now() - 3_600_000).toISOString() });
    expect(await tick()).toBe(1);
    const run = await lastRun(workflow.id);
    expect(run).toMatchObject({ status: "completed", trigger: "catch-up", result: "Nothing changed this week." });
    // Its next time is counted from now, so it doesn't run again on the next tick.
    expect(await tick()).toBe(0);
    expect(new Date((await getWorkflow(workflow.id))!.nextRunAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it("pauses and resumes; a paused workflow never runs", async () => {
    const workflow = await createWorkflow({ name: "Paused one", instruction: "Do something useful every day.", botId: iris.id, schedule: "0 9 * * *", enabled: true });
    const paused = await updateWorkflow(workflow.id, { enabled: false });
    expect(paused.nextRunAt).toBeUndefined();
    await saveWorkflow({ ...paused, nextRunAt: new Date(Date.now() - 60_000).toISOString() });
    expect(await tick()).toBe(0);
    expect((await updateWorkflow(workflow.id, { enabled: true })).nextRunAt).toBeDefined();
  });

  it("reports a failed run in the agent's chat, and marks runs cut off by a restart", async () => {
    setWorkflowTurnRunner(async (bot, conversationId) => ({ id: crypto.randomUUID(), conversationId, role: "bot", botId: bot.id, createdAt: new Date().toISOString(), status: "error", parts: [], error: "Rate limit exceeded" }));
    const workflow = await createWorkflow({ name: "Will fail", instruction: "Try something that fails.", botId: iris.id, schedule: "0 9 * * *", enabled: true });
    await runWorkflowNow(workflow.id);
    const run = await lastRun(workflow.id);
    expect(run).toMatchObject({ status: "failed", error: "Rate limit exceeded" });
    const chat = await listMessages(`dm:${iris.id}`);
    expect(chat.some((m) => m.role === "notice" && JSON.stringify(m.parts).includes('Workflow \\"Will fail\\" failed'))).toBe(true);

    await saveWorkflowRun({ ...run, id: crypto.randomUUID(), status: "running", error: undefined });
    expect(await recoverWorkflowRuns()).toBe(1);
    expect((await listWorkflowRuns(workflow.id)).filter((r) => r.status === "running")).toHaveLength(0);
  });
});
