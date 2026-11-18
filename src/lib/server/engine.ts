// The execution engine: carries out a run (a team plan) task by task.
//
// A run is a small task graph. Each task has an owner (an agent) and may depend on
// other tasks. The engine:
//   - starts every task whose dependencies have ended, up to MAX_PARALLEL at once
//     (so independent tasks run at the same time);
//   - gives each task its dependencies' results as input;
//   - retries a failed task with a delay (backoff), then hands it to another agent with
//     the same skill, and only then marks it failed;
//   - stops a task that runs longer than TASK_TIMEOUT_MS;
//   - lets you cancel a task or the whole run;
//   - after a server restart, puts interrupted tasks back in the queue (recoverRuns);
//   - ends with the run's final task: the planner consolidates everything into one
//     deliverable, which is posted where the run was started and saved to run history.
//
// Every change is saved to the database before anything else happens, so the
// database is always the truth and a restart loses nothing but in-flight work.
//
// How a task actually runs (an agent turn) is injected with setTaskRunner(): the
// app wires the real runner at boot (task-runner.ts); tests plug in a fake one.
import { randomUUID } from "node:crypto";
import type { ChatMessage, ConversationId, Run, RunDetail, SharedFinding, Task } from "@/lib/shared/types";
import { canRetry } from "@/lib/shared/runs";
import * as store from "./db";
import { publish } from "./bus";
import { isMock } from "./config";

/** How many tasks may run at the same time, across all runs. Free-tier rate limits are the reason it's small. */
export const MAX_PARALLEL = Math.max(1, Number(process.env.OPENCREWBOT_MAX_PARALLEL_TASKS) || 3);
/** How long one attempt of a task may take (waiting for your approval counts too). */
export const TASK_TIMEOUT_MS = Math.max(1, Number(process.env.OPENCREWBOT_TASK_TIMEOUT_MINUTES) || 15) * 60_000;
/** First try plus one retry, per agent. */
export const MAX_ATTEMPTS = 2;
/** Timings the engine uses. Tests shorten them with setEngineTimings(). */
const timings = {
  taskTimeoutMs: TASK_TIMEOUT_MS,
  /** Wait before retry number n (1-based); the last value repeats. */
  retryDelaysMs: [5_000, 20_000],
};

/** For tests: shorten the timeout and retry delays. */
export function setEngineTimings(next: Partial<typeof timings>): void {
  Object.assign(timings, next);
}
/** The most of one dependency's output a task gets in its brief. */
const MAX_INPUT_CHARS = 8_000;

// ── errors ──────────────────────────────────────────────────────────────

export type PlanErrorCode = "PLAN_EMPTY" | "PLAN_TOO_BIG" | "PLAN_DUPLICATE_KEY" | "PLAN_UNKNOWN_DEPENDENCY" | "PLAN_CYCLE" | "PLAN_RUN_NOT_ACTIVE";

/** A plan the engine can't run. The message says what to fix, so a planner can correct and resubmit it. */
export class PlanError extends Error {
  readonly code: PlanErrorCode;
  constructor(code: PlanErrorCode, message: string) {
    super(message);
    this.name = "PlanError";
    this.code = code;
  }
}

// ── the task runner (injected) ──────────────────────────────────────────

export type TaskOutcome = { ok: true; output: string } | { ok: false; error: string };

export interface TaskRunner {
  /** Run one attempt of a task: the agent works on `prompt`; resolve when it's done. */
  run(task: Task, prompt: string): Promise<TaskOutcome>;
  /** Stop a task that's running (cancel or timeout). The pending run() then resolves. */
  stop(task: Task): Promise<void>;
  /** Post a message into a conversation (progress notices and the final deliverable). */
  post(message: ChatMessage): Promise<void>;
  /** Write the run's history file (memory layer "history"). */
  writeHistory(run: Run, tasks: Task[]): Promise<void>;
}

interface EngineState {
  runner: TaskRunner | null;
  /** Tasks with an attempt in progress in this process. */
  running: Set<string>;
  /** runId → the tail of that run's advance() chain, so advances never overlap. */
  locks: Map<string, Promise<void>>;
}

const g = globalThis as unknown as { __opencrewbotEngine?: EngineState };
const state: EngineState = (g.__opencrewbotEngine ??= { runner: null, running: new Set(), locks: new Map() });

/** Wire how tasks run. Called once at boot (service.ts) and by tests. */
export function setTaskRunner(runner: TaskRunner): void {
  state.runner = runner;
}

function runner(): TaskRunner {
  if (!state.runner) throw new Error("engine.ts: no task runner is set; boot() wires it (setTaskRunner).");
  return state.runner;
}

/** The conversation a task's agent works in. Its transcript is the task's full log. */
export function taskConversationId(taskId: string): ConversationId {
  return `task:${taskId}`;
}

// ── plan checks (pure) ──────────────────────────────────────────────────

/** A task as a planner proposes it, before the engine gives it ids and state. */
export interface PlannedTask {
  key: string;
  title: string;
  brief: string;
  expectedOutput: string;
  skill?: string;
  agentId: string;
  dependsOn: string[];
  /** Only when added to a running plan: keys of tasks that haven't started and should wait for this one's result. */
  feeds?: string[];
}

export const MAX_PLAN_TASKS = 8;

/**
 * Check a plan's shape: 1-8 tasks, unique keys, dependencies that exist, no cycles.
 * @param tasks - the new tasks
 * @param existingKeys - keys already in the run (when tasks are added to a running plan)
 * @throws PlanError naming the problem
 */
export function validatePlan(tasks: PlannedTask[], existingKeys: string[] = []): void {
  if (tasks.length === 0) throw new PlanError("PLAN_EMPTY", "A plan needs at least one task.");
  if (tasks.length + existingKeys.length > MAX_PLAN_TASKS) throw new PlanError("PLAN_TOO_BIG", `Keep a plan to ${MAX_PLAN_TASKS} tasks or fewer; merge small steps.`);
  const keys = new Set(existingKeys);
  for (const task of tasks) {
    if (keys.has(task.key) || task.key === "final") throw new PlanError("PLAN_DUPLICATE_KEY", `Task key "${task.key}" is used twice (or is the reserved key "final"); give each task its own key.`);
    keys.add(task.key);
  }
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (dep === task.key) throw new PlanError("PLAN_CYCLE", `Task "${task.key}" depends on itself.`);
      if (!keys.has(dep)) throw new PlanError("PLAN_UNKNOWN_DEPENDENCY", `Task "${task.key}" depends on "${dep}", which isn't in the plan.`);
    }
  }
  checkNoCycles(tasks);
}

/**
 * Depth-first search for a dependency loop.
 * @throws PlanError PLAN_CYCLE naming the loop, e.g. "a → b → a"
 */
function checkNoCycles(tasks: Pick<Task, "key" | "dependsOn">[]): void {
  const byKey = new Map(tasks.map((t) => [t.key, t]));
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (key: string, path: string[]) => {
    if (done.has(key)) return;
    if (visiting.has(key)) throw new PlanError("PLAN_CYCLE", `The plan has a cycle: ${[...path, key].join(" → ")}.`);
    visiting.add(key);
    for (const dep of byKey.get(key)?.dependsOn ?? []) visit(dep, [...path, key]);
    visiting.delete(key);
    done.add(key);
  };
  for (const task of tasks) visit(task.key, []);
}

/**
 * The plan in "waves": tasks in the same wave can run at the same time.
 * @returns task keys per wave, in order
 */
export function parallelWaves(tasks: Pick<Task, "key" | "dependsOn">[]): string[][] {
  const waves: string[][] = [];
  const placed = new Set<string>();
  let remaining = tasks.slice();
  while (remaining.length) {
    const wave = remaining.filter((t) => t.dependsOn.every((d) => placed.has(d))).map((t) => t.key);
    if (wave.length === 0) break; // a cycle; validatePlan prevents this
    waves.push(wave);
    for (const key of wave) placed.add(key);
    remaining = remaining.filter((t) => !placed.has(t.key));
  }
  return waves;
}

const ENDED: Task["status"][] = ["completed", "failed", "cancelled"];
export const hasEnded = (task: Pick<Task, "status">) => ENDED.includes(task.status);

/**
 * Pending tasks that may start now: every dependency has ended and any retry delay has passed.
 * (A dependency that failed or was cancelled still counts as ended: the task runs and is told what's missing.)
 */
export function readyTasks(tasks: Task[], now = Date.now()): Task[] {
  const byKey = new Map(tasks.map((t) => [t.key, t]));
  return tasks.filter(
    (t) => t.status === "pending" && (!t.notBefore || Date.parse(t.notBefore) <= now) && t.dependsOn.every((d) => byKey.get(d) && hasEnded(byKey.get(d)!)),
  );
}

// ── helpers ─────────────────────────────────────────────────────────────

const nowIso = () => new Date().toISOString();

function addEvent(run: Run, text: string, taskKey?: string): void {
  run.events.push({ at: nowIso(), text, taskKey });
}

function changed(runId: string): void {
  publish({ type: "runs-changed", runId });
}

async function agentName(agentId: string): Promise<string> {
  return (await store.getBot(agentId))?.name ?? "A deleted agent";
}

/** Post a one-line progress notice where the run was started. */
async function notice(run: Run, text: string): Promise<void> {
  await runner().post({
    id: randomUUID(),
    conversationId: run.conversationId,
    role: "notice",
    createdAt: nowIso(),
    status: "done",
    parts: [{ kind: "text", text }],
  });
}

/** Run `fn` after any advance() already in progress for this run, so two never overlap. */
function withRunLock(runId: string, fn: () => Promise<void>): Promise<void> {
  const previous = state.locks.get(runId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(fn);
  state.locks.set(runId, next);
  // Clean up on success and on failure alike. (`finally` would create a second promise that
  // rejects unobserved when fn throws; the caller already receives the error through `next`.)
  const cleanup = () => {
    if (state.locks.get(runId) === next) state.locks.delete(runId);
  };
  next.then(cleanup, cleanup);
  return next;
}

// ── starting a run ──────────────────────────────────────────────────────

export interface NewRun {
  title: string;
  goal: string;
  conversationId: ConversationId;
  plannerBotId: string;
  project: string | null;
  tasks: PlannedTask[];
  /** What the final deliverable should look like (the planner's output format). */
  finalOutput: string;
}

/** The planner's own last task: merge everything into one deliverable. */
function finalTask(runId: string, plannerBotId: string, dependsOn: string[], expectedOutput: string): Task {
  return {
    id: randomUUID(),
    runId,
    key: "final",
    title: "Consolidate the final deliverable",
    brief:
      "Combine the results of every task into one deliverable that answers the goal. Load your report-consolidation skill and follow it: lead with an executive summary, show contradictions instead of hiding them, list anything missing or failed, keep every source, and save it with save_report (include the link).",
    expectedOutput,
    skill: "report-consolidation",
    agentId: plannerBotId,
    dependsOn,
    isFinal: true,
    status: "pending",
    attempt: 0,
    maxAttempts: MAX_ATTEMPTS,
    createdAt: nowIso(),
    triedAgentIds: [],
  };
}

function toTask(runId: string, planned: PlannedTask): Task {
  return {
    id: randomUUID(),
    runId,
    key: planned.key,
    title: planned.title,
    brief: planned.brief,
    expectedOutput: planned.expectedOutput,
    skill: planned.skill,
    agentId: planned.agentId,
    dependsOn: planned.dependsOn,
    isFinal: false,
    status: "pending",
    attempt: 0,
    maxAttempts: MAX_ATTEMPTS,
    createdAt: nowIso(),
    triedAgentIds: [],
  };
}

/**
 * Create a run from a checked plan and start it.
 * @returns the run with its tasks (the final consolidation task included)
 * @throws PlanError when the plan's shape is wrong
 */
export async function startRun(input: NewRun): Promise<RunDetail> {
  validatePlan(input.tasks);
  const run: Run = {
    id: randomUUID(),
    title: input.title.trim().slice(0, 120),
    goal: input.goal.trim(),
    conversationId: input.conversationId,
    plannerBotId: input.plannerBotId,
    project: input.project,
    status: "running",
    createdAt: nowIso(),
    events: [],
    findings: [],
    // The mock model's outputs are scripted, so the whole run is labelled SIMULATED.
    simulated: isMock(),
  };
  const tasks = input.tasks.map((t) => toTask(run.id, t));
  tasks.push(finalTask(run.id, input.plannerBotId, tasks.map((t) => t.key), input.finalOutput));
  addEvent(run, `Plan created with ${tasks.length - 1} tasks plus the final consolidation.`);
  await store.saveRun(run);
  for (const task of tasks) await store.saveTask(task);
  changed(run.id);
  void advance(run.id);
  return { run, tasks, waitingForApproval: [] };
}

// ── advancing ───────────────────────────────────────────────────────────

/**
 * Look at a run and do whatever is due: start ready tasks (up to the parallel limit)
 * or, when every task has ended, finish the run. Safe to call any time; calls for the
 * same run are serialized.
 */
export function advance(runId: string): Promise<void> {
  return withRunLock(runId, async () => {
    const run = await store.getRun(runId);
    if (!run || run.status !== "running") return;
    const tasks = await store.listTasks(runId);
    if (tasks.every(hasEnded)) {
      await finishRun(run, tasks);
      return;
    }
    const ready = readyTasks(tasks);
    for (const task of ready) {
      if (state.running.size >= MAX_PARALLEL) break;
      await startTask(run, task, tasks);
    }
    // A retry waiting for its backoff needs a wake-up call.
    const waiting = tasks.filter((t) => t.status === "pending" && t.notBefore && Date.parse(t.notBefore) > Date.now());
    for (const task of waiting) setTimeout(() => void advance(runId), Date.parse(task.notBefore!) - Date.now() + 50);
  });
}

async function startTask(run: Run, task: Task, allTasks: Task[]): Promise<void> {
  task.status = "running";
  task.attempt += 1;
  task.startedAt = nowIso();
  task.notBefore = undefined;
  await store.saveTask(task);
  const name = await agentName(task.agentId);
  addEvent(run, `${name} started "${task.title}"${task.attempt > 1 ? ` (attempt ${task.attempt})` : ""}.`, task.key);
  await store.saveRun(run);
  changed(run.id);
  state.running.add(task.id);
  void executeTask(run.id, task, taskPrompt(run, task, allTasks, await namesById(allTasks)));
}

async function namesById(tasks: Task[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const id of new Set(tasks.map((t) => t.agentId))) names.set(id, await agentName(id));
  return names;
}

/** Run one attempt, with a timeout, then record what happened and advance the run. */
async function executeTask(runId: string, task: Task, prompt: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<TaskOutcome>((resolve) => {
    timer = setTimeout(() => {
      void runner().stop(task);
      resolve({ ok: false, error: `timed out after ${Math.round(timings.taskTimeoutMs / 1000)} s` });
    }, timings.taskTimeoutMs);
  });
  let outcome: TaskOutcome;
  try {
    outcome = await Promise.race([runner().run(task, prompt), timeout]);
  } catch (error) {
    outcome = { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
    state.running.delete(task.id);
  }
  await withRunLock(runId, () => recordOutcome(runId, task.id, outcome));
  void advance(runId);
}

async function recordOutcome(runId: string, taskId: string, outcome: TaskOutcome): Promise<void> {
  const run = await store.getRun(runId);
  const task = await store.getTask(taskId);
  // Cancelled while it was running (or the run ended): the result no longer counts.
  if (!run || !task || task.status !== "running") return;
  const name = await agentName(task.agentId);
  if (outcome.ok) {
    task.status = "completed";
    task.output = outcome.output;
    task.error = undefined;
    task.completedAt = nowIso();
    addEvent(run, `${name} finished "${task.title}".`, task.key);
    await store.saveTask(task);
    await store.saveRun(run);
    if (!task.isFinal) await notice(run, `✓ ${name} finished "${task.title}".`);
  } else {
    await handleFailure(run, task, name, outcome.error);
  }
  changed(run.id);
}

/** Retry with backoff; then hand the task to another agent with the same skill; then give up. */
async function handleFailure(run: Run, task: Task, name: string, error: string): Promise<void> {
  task.error = error;
  if (task.attempt < task.maxAttempts) {
    const delay = timings.retryDelaysMs[Math.min(task.attempt - 1, timings.retryDelaysMs.length - 1)];
    task.status = "pending";
    task.notBefore = new Date(Date.now() + delay).toISOString();
    addEvent(run, `${name}'s attempt at "${task.title}" failed (${error}). Retrying in ${Math.round(delay / 1000)} s.`, task.key);
  } else {
    const substitute = task.isFinal ? null : await findSubstitute(task);
    if (substitute) {
      task.triedAgentIds.push(task.agentId);
      task.agentId = substitute.id;
      task.attempt = 0;
      task.status = "pending";
      addEvent(run, `"${task.title}" failed ${task.maxAttempts} times with ${name} (${error}). Reassigned to ${substitute.name}.`, task.key);
      await notice(run, `↻ "${task.title}" reassigned from ${name} to ${substitute.name}.`);
    } else {
      task.status = "failed";
      task.completedAt = nowIso();
      // The final task has nothing after it, so "continuing without it" would be wrong there.
      const after = task.isFinal ? "" : " Continuing without it.";
      addEvent(run, `"${task.title}" failed after ${task.attempt} attempts (${error}).${after}`, task.key);
      await notice(run, `✗ "${task.title}" failed: ${error}.${task.isFinal ? "" : " The rest of the plan continues without it."}`);
    }
  }
  await store.saveTask(task);
  await store.saveRun(run);
}

/** Another agent that has the task's skill and hasn't tried it yet (never the planner). */
async function findSubstitute(task: Task): Promise<{ id: string; name: string } | null> {
  if (!task.skill) return null;
  const run = await store.getRun(task.runId);
  const tried = new Set([...task.triedAgentIds, task.agentId, run?.plannerBotId]);
  const candidate = (await store.listBots()).find((b) => !tried.has(b.id) && b.skills.includes(task.skill!));
  return candidate ? { id: candidate.id, name: candidate.name } : null;
}

// ── the prompt a task's agent receives ──────────────────────────────────

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n\n[…cut to ${max} characters]` : text;
}

/** The task brief: the plan's goal, this task, and the results of the tasks it depends on. */
/** At most this many findings are kept per run (the newest), and each is cut to MAX_FINDING_CHARS in a brief. */
const MAX_FINDINGS = 12;
const MAX_FINDING_CHARS = 1_500;

/** What teammates shared with share_finding so far, for the brief of a task that starts now. */
function findingsSection(run: Run): string {
  const findings = run.findings ?? [];
  if (!findings.length) return "";
  const lines = findings.map((f) => `- **${f.by}:** ${truncate(f.text, MAX_FINDING_CHARS)}`);
  return `## Findings teammates shared so far\n${lines.join("\n")}`;
}

/**
 * Record something a teammate did during a run (asked for help, shared a finding), so it shows in
 * the run's "What happened" list and, for a finding, in the brief of every task that starts later.
 * Runs under the run's lock, so it can't overwrite a change the engine is making at the same moment.
 */
export function noteOnRun(runId: string, text: string, finding?: SharedFinding): Promise<void> {
  return withRunLock(runId, async () => {
    const run = await store.getRun(runId);
    if (!run) return;
    addEvent(run, text);
    if (finding) run.findings = [...(run.findings ?? []), finding].slice(-MAX_FINDINGS);
    await store.saveRun(run);
    changed(runId);
  });
}

export function taskPrompt(run: Run, task: Task, allTasks: Task[], names: Map<string, string>): string {
  const byKey = new Map(allTasks.map((t) => [t.key, t]));
  const inputs = task.dependsOn.map((key) => {
    const dep = byKey.get(key);
    if (!dep) return `### ${key}\n(missing)`;
    const who = names.get(dep.agentId) ?? "a teammate";
    if (dep.status === "completed") return `### ${dep.title} (by ${who})\n${truncate(dep.output ?? "", MAX_INPUT_CHARS)}`;
    return `### ${dep.title} (by ${who}): ${dep.status.toUpperCase()}${dep.error ? `: ${dep.error}` : ""}\nThis input is missing. Work without it and say clearly what's missing.`;
  });
  return [
    `[Task from the team plan "${run.title}"]`,
    `The whole plan's goal: ${run.goal}`,
    `Your task: ${task.title}`,
    `What to do: ${task.brief}`,
    `What to deliver: ${task.expectedOutput}`,
    task.skill ? `Your "${task.skill}" skill fits this task: load it first with load_skill.` : "",
    inputs.length ? `## Results from the tasks this one builds on\n\n${inputs.join("\n\n")}` : "",
    findingsSection(run),
    task.isFinal
      ? "## Your deliverable\nWrite the WHOLE deliverable in your reply: it's what the person reads in the chat. You may also save it as a report, but never reply with only a link."
      : "",
    "## How to work",
    "Nobody replies in this conversation, so don't @mention teammates or wait for answers here. If you have the teamwork tools, ask_teammate gets you an answer, a check or a piece of work from a teammate, and share_finding passes an intermediate result to everyone else on the plan. If something needs the person's decision, state your assumption clearly. Reply with the complete result: it goes straight into the plan.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ── finishing ───────────────────────────────────────────────────────────

/**
 * The team's finished work, unedited, for when the final write-up failed (seen live: every free model
 * in the planner's chain out of quota). The person still gets every result instead of nothing.
 * @returns undefined when no task finished
 */
async function unconsolidatedResult(tasks: Task[]): Promise<string | undefined> {
  const done = tasks.filter((t) => !t.isFinal && t.status === "completed" && t.output);
  if (!done.length) return undefined;
  const names = new Map((await store.listBots()).map((b) => [b.id, b.name]));
  const sections = done.map((t) => `### ${t.title} (${names.get(t.agentId) ?? "a deleted agent"})\n\n${truncate(t.output!, MAX_INPUT_CHARS)}`);
  return [`_The final write-up didn't complete, so here are the team's results as they came back, unedited. Retry the final task in Tasks and runs to get the consolidated version._`, ...sections].join("\n\n");
}

async function finishRun(run: Run, tasks: Task[]): Promise<void> {
  const final = tasks.find((t) => t.isFinal);
  const failed = tasks.filter((t) => t.status === "failed");
  run.status = final?.status === "completed" ? "completed" : "failed";
  run.result = run.status === "completed" ? final?.output : await unconsolidatedResult(tasks);
  run.error = run.status === "failed" ? (final?.error ?? "the final consolidation didn't complete") : undefined;
  run.completedAt = nowIso();
  addEvent(run, run.status === "completed" ? `Run completed${failed.length ? ` (${failed.length} task(s) failed along the way)` : ""}.` : `Run failed: ${run.error}.`);
  await store.saveRun(run);
  await runner().writeHistory(run, tasks);
  const heading = run.status === "completed" ? `**Plan finished: ${run.title}**` : `**Plan failed: ${run.title}** (${run.error})`;
  await runner().post({
    id: randomUUID(),
    conversationId: run.conversationId,
    role: "bot",
    botId: run.plannerBotId,
    createdAt: nowIso(),
    status: "done",
    parts: [{ kind: "text", text: `${heading}\n\n${run.result ?? "No final deliverable was produced."}` }],
  });
  changed(run.id);
}

// ── control: cancel, retry, change the plan ─────────────────────────────

async function cancelTaskRecord(run: Run, task: Task, why: string): Promise<void> {
  const wasRunning = task.status === "running";
  task.status = "cancelled";
  task.completedAt = nowIso();
  task.error = why;
  await store.saveTask(task);
  addEvent(run, `"${task.title}" cancelled (${why}).`, task.key);
  if (wasRunning) await runner().stop(task);
}

/** Cancel every task that hasn't ended and end the run as cancelled. */
export async function cancelRun(runId: string, why = "cancelled by you"): Promise<void> {
  await withRunLock(runId, async () => {
    const run = await store.getRun(runId);
    if (!run || run.status !== "running") throw new PlanError("PLAN_RUN_NOT_ACTIVE", "That run isn't running.");
    for (const task of await store.listTasks(runId)) {
      if (!hasEnded(task)) await cancelTaskRecord(run, task, why);
    }
    run.status = "cancelled";
    run.completedAt = nowIso();
    addEvent(run, `Run cancelled (${why}).`);
    await store.saveRun(run);
    await runner().writeHistory(run, await store.listTasks(runId));
    await notice(run, `■ Plan "${run.title}" was cancelled.`);
    changed(runId);
  });
}

/** Cancel one task. Tasks that depend on it still run, and are told it's missing. */
export async function cancelTask(taskId: string, why = "cancelled by you"): Promise<void> {
  const task = await store.getTask(taskId);
  if (!task) throw new PlanError("PLAN_RUN_NOT_ACTIVE", "That task doesn't exist.");
  await withRunLock(task.runId, async () => {
    const run = await store.getRun(task.runId);
    const latest = await store.getTask(taskId);
    if (!run || run.status !== "running" || !latest || hasEnded(latest)) throw new PlanError("PLAN_RUN_NOT_ACTIVE", "That task can't be cancelled: it has already ended.");
    if (latest.isFinal) throw new PlanError("PLAN_RUN_NOT_ACTIVE", "The final consolidation can't be cancelled on its own; cancel the run instead.");
    await cancelTaskRecord(run, latest, why);
    await store.saveRun(run);
    changed(run.id);
  });
  void advance(task.runId);
}

/**
 * Run a failed or cancelled task again (rules: canRetry in shared/runs.ts).
 * @throws PlanError PLAN_RUN_NOT_ACTIVE when the task can't be retried
 */
export async function retryTask(taskId: string): Promise<void> {
  const task = await store.getTask(taskId);
  if (!task) throw new PlanError("PLAN_RUN_NOT_ACTIVE", "That task doesn't exist.");
  await withRunLock(task.runId, async () => {
    const run = await store.getRun(task.runId);
    const latest = await store.getTask(taskId);
    if (!run || !latest || !canRetry(run, latest)) {
      throw new PlanError("PLAN_RUN_NOT_ACTIVE", "Only a failed or cancelled task of a running plan, or the failed final task of a failed plan, can be retried.");
    }
    if (run.status === "failed") {
      // Retrying the final write-up reopens the plan (e.g. once a model's quota is back).
      run.status = "running";
      run.completedAt = undefined;
      run.error = undefined;
      run.result = undefined;
      addEvent(run, "Run reopened to retry the final write-up.");
    }
    latest.status = "pending";
    latest.attempt = 0;
    latest.error = undefined;
    latest.completedAt = undefined;
    await store.saveTask(latest);
    addEvent(run, `"${latest.title}" will run again (retry requested).`, latest.key);
    await store.saveRun(run);
    changed(run.id);
  });
  void advance(task.runId);
}

/**
 * Change a running plan: cancel some tasks and add new ones. New tasks may depend on any task
 * in the run; the final consolidation waits for them too. This is how the planner adapts when the
 * person sends a new instruction mid-run.
 * @throws PlanError when the run isn't running or the change doesn't fit the plan
 */
export async function updateRun(runId: string, change: { cancelKeys: string[]; add: PlannedTask[]; note: string }): Promise<RunDetail> {
  await withRunLock(runId, async () => {
    const run = await store.getRun(runId);
    if (!run || run.status !== "running") throw new PlanError("PLAN_RUN_NOT_ACTIVE", "That run isn't running any more; start a new plan instead.");
    const tasks = await store.listTasks(runId);
    const final = tasks.find((t) => t.isFinal);
    if (final && final.status !== "pending") throw new PlanError("PLAN_RUN_NOT_ACTIVE", "The plan is already consolidating its final deliverable; start a new plan instead.");
    const byKey = new Map(tasks.map((t) => [t.key, t]));
    for (const key of change.cancelKeys) {
      const task = byKey.get(key);
      if (!task || task.isFinal) throw new PlanError("PLAN_UNKNOWN_DEPENDENCY", `There is no task "${key}" to cancel.`);
      if (!hasEnded(task)) await cancelTaskRecord(run, task, `plan changed: ${change.note}`);
    }
    if (change.add.length) {
      validatePlan(change.add, tasks.filter((t) => !t.isFinal).map((t) => t.key));
      const added = change.add.map((t) => toTask(runId, t));
      // "feeds": tasks that haven't started yet wait for the new task, so its result reaches their brief
      // (seen live: without this, a task added mid-run reached only the final write-up).
      const rewired = new Map<string, Task>();
      for (const planned of change.add) {
        for (const key of planned.feeds ?? []) {
          const target = rewired.get(key) ?? byKey.get(key);
          if (!target || target.isFinal) throw new PlanError("PLAN_UNKNOWN_DEPENDENCY", `New task "${planned.key}" feeds "${key}", which isn't a task in the plan.`);
          if (target.status !== "pending") {
            throw new PlanError("PLAN_RUN_NOT_ACTIVE", `"${key}" has already started, so it can't wait for "${planned.key}". Leave it out of feeds; the final deliverable still gets the result.`);
          }
          rewired.set(key, { ...target, dependsOn: [...new Set([...target.dependsOn, planned.key])] });
        }
      }
      checkNoCycles([...tasks.filter((t) => !t.isFinal).map((t) => rewired.get(t.key) ?? t), ...added]);
      for (const task of added) await store.saveTask(task);
      for (const task of rewired.values()) await store.saveTask(task);
      if (final) {
        final.dependsOn = [...final.dependsOn, ...added.map((t) => t.key)];
        await store.saveTask(final);
      }
    }
    const feeds = change.add.filter((t) => t.feeds?.length).map((t) => `${t.feeds!.join(", ")} now wait for ${t.key}`);
    addEvent(run, `Plan changed: ${change.note}${change.cancelKeys.length ? ` · cancelled ${change.cancelKeys.join(", ")}` : ""}${change.add.length ? ` · added ${change.add.map((t) => t.key).join(", ")}` : ""}${feeds.length ? ` · ${feeds.join("; ")}` : ""}.`);
    await store.saveRun(run);
    changed(runId);
  });
  void advance(runId);
  return runDetail(runId);
}

// ── reading ─────────────────────────────────────────────────────────────

export async function runDetail(runId: string): Promise<RunDetail> {
  const run = await store.getRun(runId);
  if (!run) throw new PlanError("PLAN_RUN_NOT_ACTIVE", "That run doesn't exist.");
  const tasks = await store.listTasks(runId);
  const pending = await store.listApprovalsByStatus(["pending"]);
  const waiting = new Set(pending.map((a) => a.conversationId));
  return { run, tasks, waitingForApproval: tasks.filter((t) => waiting.has(taskConversationId(t.id))).map((t) => t.id) };
}

/** The run still going in a conversation, if any (one at a time per conversation). */
export async function activeRunIn(conversationId: ConversationId): Promise<Run | null> {
  return (await store.listRunsByStatus("running")).find((r) => r.conversationId === conversationId) ?? null;
}

// ── recovery after a restart ────────────────────────────────────────────

/**
 * Called once at boot. Any task still marked "running" was cut off by the restart: put it back
 * in the queue (the attempt it lost counts), then let every running run continue.
 * @returns how many tasks were put back
 */
export async function recoverRuns(): Promise<number> {
  let recovered = 0;
  for (const run of await store.listRunsByStatus("running")) {
    for (const task of await store.listTasks(run.id)) {
      if (task.status !== "running" || state.running.has(task.id)) continue;
      task.status = "pending";
      task.startedAt = undefined;
      // The restart isn't the task's fault, so the cut-off attempt is given back (seen live: it used to count,
      // and a following quota error then used up the agent's last attempt).
      task.attempt = Math.max(0, task.attempt - 1);
      await store.saveTask(task);
      addEvent(run, `"${task.title}" was interrupted by a server restart and will run again.`, task.key);
      recovered++;
    }
    await store.saveRun(run);
    changed(run.id);
    void advance(run.id);
  }
  return recovered;
}
