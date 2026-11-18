// The scheduler (Module I): workflows are instructions sent to an agent on a schedule
// ("every Monday at 09:00, check MeetUniversity's competitors and report what changed").
//
// - A loop checks every TICK_MS which workflows are due (startScheduler, at boot).
// - Each run is a normal turn of the workflow's agent in its own conversation
//   ("workflow:<runId>"), so it has the agent's tools, skills, memory and permission level,
//   and its approvals show up in the Approval Centre. If the agent turns the instruction
//   into a team plan (the Chief of Staff usually does), the run waits for the plan and
//   its result is the plan's final deliverable.
// - The previous run's result is given to the agent, so it can report what changed.
// - Every result is saved as a report in the Files folder; history is kept per workflow.
// - Missed while the app was off: a workflow that was due runs once at the next start
//   ("catch-up"), not once per missed slot.
// - A failed run is reported in the agent's chat and shown red in Workflows.
// - Pause / resume, Run now and delete come from the Workflows screen (and the API).
import { randomUUID } from "node:crypto";
import { Cron } from "croner";
import type { Bot, ChatMessage, ConversationId, Workflow, WorkflowInput, WorkflowRun } from "@/lib/shared/types";
import { describeSchedule } from "@/lib/shared/schedules";
import { getBot, getWorkflow, listRuns, listWorkflowRuns, listWorkflows, saveMessage, saveWorkflow, saveWorkflowRun, deleteWorkflowRow } from "./db";
import { publish } from "./bus";
import { isMock } from "./config";
import { changedAPlan, messageText } from "./rooms";
import { saveReport } from "./files";

/** How often the loop looks for due workflows. */
export const TICK_MS = 30_000;
/** The shortest gap allowed between two runs: more often would burn free model quota in minutes. */
export const MIN_INTERVAL_MINUTES = 5;
/** How long a run waits for the team plan it started before giving up. */
const PLAN_TIMEOUT_MS = 2 * 60 * 60_000;
/** The most of the previous result the agent gets for comparison. */
const MAX_PREVIOUS_CHARS = 4_000;

export type WorkflowErrorCode = "WORKFLOW_INVALID" | "WORKFLOW_NOT_FOUND" | "WORKFLOW_ALREADY_RUNNING";

/** A workflow request that can't be done. The message says what to change. */
export class WorkflowError extends Error {
  readonly code: WorkflowErrorCode;
  constructor(code: WorkflowErrorCode, message: string) {
    super(message);
    this.name = "WorkflowError";
    this.code = code;
  }
}

/** How one turn of the workflow's agent runs. Injected at boot (service.ts) so tests can replace it. */
export type WorkflowTurnRunner = (bot: Bot, conversationId: ConversationId, prompt: string) => Promise<ChatMessage | null>;

interface SchedulerState {
  runTurn: WorkflowTurnRunner | null;
  timer: ReturnType<typeof setInterval> | null;
  /** Workflows with a run in progress in this process (a workflow never runs twice at once). */
  inFlight: Set<string>;
  /** True while a tick is checking, so two ticks never start the same run. */
  ticking: boolean;
}

const g = globalThis as unknown as { __opencrewbotScheduler?: SchedulerState };
const state: SchedulerState = (g.__opencrewbotScheduler ??= { runTurn: null, timer: null, inFlight: new Set(), ticking: false });

export function setWorkflowTurnRunner(runner: WorkflowTurnRunner): void {
  state.runTurn = runner;
}

function changed(): void {
  publish({ type: "workflows-changed" });
}

// ── schedules ───────────────────────────────────────────────────────────

/**
 * @param cron - a 5-part cron expression
 * @param from - the moment to start looking from
 * @returns the next time it fires after `from`
 * @throws WorkflowError WORKFLOW_INVALID when the expression can't be read or never fires
 */
export function nextRunAfter(cron: string, from: Date): Date {
  let next: Date | null;
  try {
    next = new Cron(cron, { paused: true }).nextRun(from);
  } catch {
    throw new WorkflowError("WORKFLOW_INVALID", `"${cron}" isn't a schedule I can read. Use 5 parts: minute hour day month weekday, e.g. "0 9 * * 1" for Mondays at 09:00.`);
  }
  if (!next) throw new WorkflowError("WORKFLOW_INVALID", `"${cron}" never runs again.`);
  return next;
}

/** @throws WorkflowError when the schedule is unreadable or runs more often than every MIN_INTERVAL_MINUTES */
export function checkSchedule(cron: string, from = new Date()): void {
  if (cron.trim().split(/\s+/).length !== 5) {
    throw new WorkflowError("WORKFLOW_INVALID", `Use a 5-part schedule (minute hour day month weekday), e.g. "0 9 * * 1". "${cron}" has ${cron.trim().split(/\s+/).length}.`);
  }
  const first = nextRunAfter(cron, from);
  const second = nextRunAfter(cron, first);
  if (second.getTime() - first.getTime() < MIN_INTERVAL_MINUTES * 60_000) {
    throw new WorkflowError("WORKFLOW_INVALID", `That runs more often than every ${MIN_INTERVAL_MINUTES} minutes, which would use up free model quota fast. Use e.g. "*/5 * * * *" or slower.`);
  }
}

// ── create, change, delete ──────────────────────────────────────────────

async function checkInput(input: Partial<WorkflowInput>): Promise<void> {
  if (input.name !== undefined && (input.name.trim().length < 2 || input.name.length > 80)) throw new WorkflowError("WORKFLOW_INVALID", "Give the workflow a name of 2-80 characters.");
  if (input.instruction !== undefined && (input.instruction.trim().length < 10 || input.instruction.length > 4000)) {
    throw new WorkflowError("WORKFLOW_INVALID", "Write the instruction in 10-4,000 characters: what the agent should do each time.");
  }
  if (input.botId !== undefined && !(await getBot(input.botId))) throw new WorkflowError("WORKFLOW_INVALID", "Pick an agent that exists to run it.");
  if (input.schedule !== undefined) checkSchedule(input.schedule);
}

/** @throws WorkflowError WORKFLOW_INVALID with what to fix */
export async function createWorkflow(input: WorkflowInput): Promise<Workflow> {
  await checkInput(input);
  const workflow: Workflow = {
    id: randomUUID().slice(0, 8),
    name: input.name.trim(),
    instruction: input.instruction.trim(),
    botId: input.botId,
    schedule: input.schedule.trim(),
    enabled: input.enabled,
    createdAt: new Date().toISOString(),
    nextRunAt: input.enabled ? nextRunAfter(input.schedule.trim(), new Date()).toISOString() : undefined,
  };
  await saveWorkflow(workflow);
  changed();
  return workflow;
}

/** Change a workflow; `enabled: false` pauses it, `enabled: true` resumes it from now. */
export async function updateWorkflow(id: string, patch: Partial<WorkflowInput>): Promise<Workflow> {
  const workflow = await getWorkflow(id);
  if (!workflow) throw new WorkflowError("WORKFLOW_NOT_FOUND", "That workflow doesn't exist.");
  await checkInput(patch);
  const next: Workflow = { ...workflow, ...patch, id: workflow.id, createdAt: workflow.createdAt };
  // Resuming or changing the schedule restarts the count from now; pausing clears it.
  next.nextRunAt = next.enabled ? nextRunAfter(next.schedule, new Date()).toISOString() : undefined;
  await saveWorkflow(next);
  changed();
  return next;
}

export async function deleteWorkflow(id: string): Promise<void> {
  await deleteWorkflowRow(id);
  changed();
}

// ── running ─────────────────────────────────────────────────────────────

const TRIGGER_WORDS: Record<WorkflowRun["trigger"], string> = {
  schedule: "scheduled",
  "catch-up": "catch-up (it was due while the app was off)",
  manual: "manual (Run now)",
};

/** What the agent receives on each run: the instruction, and the previous result to compare with. */
export function workflowPrompt(workflow: Workflow, run: WorkflowRun, previous: WorkflowRun | undefined): string {
  const comparison = previous?.result
    ? `## The previous run's result (${previous.startedAt.slice(0, 16).replace("T", " ")}), for comparison\nSay clearly what changed since then, and what didn't.\n\n${previous.result.slice(0, MAX_PREVIOUS_CHARS)}`
    : "This is the first run, so there's nothing to compare with yet.";
  return [
    `[Workflow "${workflow.name}": ${TRIGGER_WORDS[run.trigger]} run, ${run.startedAt.slice(0, 16).replace("T", " ")}, ${describeSchedule(workflow.schedule).toLowerCase()}]`,
    workflow.instruction,
    comparison,
    "Reply with the complete result: it's saved as this run's report. Nobody replies in this conversation, so state your assumptions.",
  ].join("\n\n");
}

async function post(conversationId: ConversationId, role: "user" | "notice", text: string): Promise<void> {
  const message: ChatMessage = { id: randomUUID(), conversationId, role, createdAt: new Date().toISOString(), status: "done", parts: [{ kind: "text", text }] };
  await saveMessage(message);
  publish({ type: "message", message });
}

/** Wait for the team plan the run's agent started in this conversation to end. */
async function waitForPlan(conversationId: ConversationId, startedAt: string) {
  const deadline = Date.now() + PLAN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const plan = (await listRuns(50)).find((r) => r.conversationId === conversationId && r.createdAt >= startedAt);
    if (plan && plan.status !== "running") return plan;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`the team plan didn't finish within ${PLAN_TIMEOUT_MS / 3_600_000} hours`);
}

/** The run itself: one agent turn, and the plan it may start. Always ends with the run saved as completed or failed. */
async function execute(workflow: Workflow, run: WorkflowRun): Promise<void> {
  try {
    const runTurn = state.runTurn;
    if (!runTurn) throw new Error("scheduler.ts: no turn runner is set; boot() wires it (setWorkflowTurnRunner).");
    const bot = await getBot(workflow.botId);
    if (!bot) throw new Error("the agent that runs this workflow was deleted");
    const previous = (await listWorkflowRuns(workflow.id, 10)).find((r) => r.id !== run.id && r.status === "completed");
    const prompt = workflowPrompt(workflow, run, previous);
    // The instruction opens the run's transcript, so it reads like a chat.
    await post(run.conversationId, "user", prompt);
    const reply = await runTurn(bot, run.conversationId, prompt);
    if (!reply || reply.status !== "done") throw new Error(reply?.error ?? "the agent's turn was stopped");
    let result = messageText(reply);
    if (changedAPlan(reply)) {
      const plan = await waitForPlan(run.conversationId, run.startedAt);
      run.planRunId = plan.id;
      if (plan.status !== "completed") throw new Error(`the team plan ${plan.status}: ${plan.error ?? "no reason given"}`);
      result = plan.result ?? result;
    }
    if (!result.trim()) throw new Error("the agent finished without a result");
    run.result = result;
    run.status = "completed";
    const label = run.simulated ? "SIMULATED (mock model)" : "live";
    run.reportPath = saveReport(`${workflow.name} ${run.startedAt.slice(0, 10)}`, `# ${workflow.name}\n\n_Workflow run ${run.startedAt.slice(0, 16).replace("T", " ")} · ${TRIGGER_WORDS[run.trigger]} · ${label}_\n\n${result}`).path;
  } catch (error) {
    run.status = "failed";
    run.error = error instanceof Error ? error.message : String(error);
    // Failure report: in the agent's chat (shows as unread) and red in Workflows.
    await post(`dm:${workflow.botId}`, "notice", `✗ Workflow "${workflow.name}" failed: ${run.error}. See Workflows for its history.`).catch(() => {});
  } finally {
    run.completedAt = new Date().toISOString();
    await saveWorkflowRun(run);
    const latest = await getWorkflow(workflow.id);
    if (latest) await saveWorkflow({ ...latest, lastRunAt: run.startedAt });
    state.inFlight.delete(workflow.id);
    changed();
  }
}

/**
 * Start one run in the background.
 * @returns the run record (status "running"); it updates as the run goes
 * @throws WorkflowError WORKFLOW_ALREADY_RUNNING when it's running right now
 */
export async function runWorkflow(workflow: Workflow, trigger: WorkflowRun["trigger"]): Promise<WorkflowRun> {
  if (state.inFlight.has(workflow.id)) throw new WorkflowError("WORKFLOW_ALREADY_RUNNING", `"${workflow.name}" is running right now; wait for it to finish.`);
  state.inFlight.add(workflow.id);
  const id = randomUUID();
  const run: WorkflowRun = { id, workflowId: workflow.id, trigger, status: "running", startedAt: new Date().toISOString(), conversationId: `workflow:${id}`, simulated: isMock() };
  await saveWorkflowRun(run);
  changed();
  void execute(workflow, run);
  return run;
}

/** Run now (from the Workflows screen). */
export async function runWorkflowNow(id: string): Promise<WorkflowRun> {
  const workflow = await getWorkflow(id);
  if (!workflow) throw new WorkflowError("WORKFLOW_NOT_FOUND", "That workflow doesn't exist.");
  return runWorkflow(workflow, "manual");
}

// ── the loop ────────────────────────────────────────────────────────────

/**
 * Start every workflow that's due. A due time more than two ticks ago means the app was off
 * (or asleep) then: it runs once now as "catch-up", and its next time is counted from now.
 * @param now - the current time (tests pass their own)
 * @returns how many runs it started
 */
export async function tick(now = new Date()): Promise<number> {
  if (state.ticking) return 0;
  state.ticking = true;
  let started = 0;
  try {
    for (const workflow of await listWorkflows()) {
      if (!workflow.enabled || !workflow.nextRunAt || state.inFlight.has(workflow.id)) continue;
      const due = new Date(workflow.nextRunAt);
      if (due > now) continue;
      const trigger = now.getTime() - due.getTime() > 2 * TICK_MS ? "catch-up" : "schedule";
      await saveWorkflow({ ...workflow, nextRunAt: nextRunAfter(workflow.schedule, now).toISOString() });
      await runWorkflow(workflow, trigger);
      started++;
    }
  } finally {
    state.ticking = false;
  }
  return started;
}

/** Start the loop once per process (service.ts boot). It doesn't keep the process alive on its own. */
export function startScheduler(): void {
  if (state.timer) return;
  state.timer = setInterval(() => void tick().catch((error) => console.error("[opencrewbot] scheduler tick failed:", error)), TICK_MS);
  state.timer.unref?.();
  void tick().catch((error) => console.error("[opencrewbot] scheduler tick failed:", error));
}

/** Workflows with their latest runs, for the Workflows screen. */
export async function workflowsWithRuns(): Promise<Array<Workflow & { runs: WorkflowRun[]; running: boolean }>> {
  const workflows = await listWorkflows();
  return Promise.all(workflows.map(async (w) => ({ ...w, runs: await listWorkflowRuns(w.id, 10), running: state.inFlight.has(w.id) })));
}

/**
 * After a restart: runs that were in progress can't continue (their agent turn is gone), so they're
 * marked failed and say why. The next scheduled run, or a catch-up run, takes over.
 * @returns how many were marked
 */
export async function recoverWorkflowRuns(): Promise<number> {
  const stuck = (await listWorkflowRuns(undefined, 500)).filter((r) => r.status === "running");
  for (const run of stuck) {
    await saveWorkflowRun({ ...run, status: "failed", error: "Interrupted by a server restart. The next scheduled run takes over.", completedAt: new Date().toISOString() });
  }
  if (stuck.length) changed();
  return stuck.length;
}
