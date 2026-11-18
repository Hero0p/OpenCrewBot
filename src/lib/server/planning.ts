// The Chief of Staff's planning: three tools (create_plan, update_plan, plan_status)
// and the prompt sections that make them work (the team roster and the plan in this
// conversation). Bots with the "planning" tool switch get them.
//
// The planner writes its plan as the create_plan tool's input, so the tool's schema
// checks the shape. This file then checks the content in code: every task's owner
// must be a real teammate (not the planner), any skill named must be one that
// teammate has, and the dependencies must form no cycle (engine.validatePlan).
// Problems come back to the model as plain-words errors, so it fixes the plan and
// calls again. A valid plan goes straight to the execution engine.
import type { ToolsInput } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { Bot, ConversationId, Run, Task } from "@/lib/shared/types";
import { listBots, listRuns, listTasks } from "./db";
import { PlanError, activeRunIn, parallelWaves, runDetail, startRun, updateRun, type PlannedTask } from "./engine";
import { activeProjectSlug } from "./memory-layers";
import { conversationIdOf } from "./request-context";
import { listSkills } from "./skills";

// ── the plan's schema (what the planner model fills in) ─────────────────

const planTaskSchema = z.object({
  key: z
    .string()
    .regex(/^[a-z0-9-]{2,30}$/)
    .describe('A short id, lowercase with dashes, e.g. "competitor-research".'),
  title: z.string().min(3).max(100).describe("What this task is, in a few words."),
  agent: z.string().min(1).describe('The teammate who does it, by @handle, e.g. "iris".'),
  brief: z.string().min(20).describe("What to do, with all the context needed: the teammate sees only this brief and the results of the tasks it depends on."),
  expectedOutput: z.string().min(3).describe("What to hand back, e.g. a sourced comparison table."),
  skill: z.string().optional().describe("The skill this task needs, if any (the teammate must have it), e.g. competitor-analysis."),
  // Optional because models often leave it out for independent tasks (seen live with Gemini 2.5 Flash):
  // a missing list means "no dependencies" rather than a failed tool call and a retry.
  dependsOn: z.array(z.string()).optional().describe("Keys of the tasks whose results this one needs. Leave empty if none: such tasks run at the same time."),
});

type PlanTaskInput = z.infer<typeof planTaskSchema>;

const DEFAULT_FINAL_OUTPUT = "One Markdown report: executive summary, a section per part of the request, open issues, next steps and sources.";

// ── checking a plan's content ───────────────────────────────────────────

/**
 * Turn the planner's tasks into engine tasks, checking owners and skills.
 * @throws Error listing every problem, in words the planner can act on
 */
export async function resolvePlanTasks(planner: Pick<Bot, "id">, tasks: PlanTaskInput[]): Promise<PlannedTask[]> {
  const bots = await listBots();
  const byHandle = new Map(bots.map((b) => [b.handle, b]));
  const knownSkills = new Set(listSkills().map((s) => s.id));
  const problems: string[] = [];
  const team = bots.filter((b) => b.id !== planner.id).map((b) => `@${b.handle}`).join(", ");

  const resolved = tasks.map((task) => {
    const handle = task.agent.replace(/^@/, "").toLowerCase();
    const owner = byHandle.get(handle);
    if (!owner) problems.push(`Task "${task.key}": there's no teammate @${handle}. Your team: ${team}.`);
    else if (owner.id === planner.id) problems.push(`Task "${task.key}": assign it to a teammate. You write the final deliverable yourself; it's added to every plan automatically.`);
    if (task.skill) {
      if (!knownSkills.has(task.skill)) problems.push(`Task "${task.key}": there's no skill "${task.skill}".`);
      else if (owner && !owner.skills.includes(task.skill)) {
        const capable = bots.filter((b) => b.id !== planner.id && b.skills.includes(task.skill!)).map((b) => `@${b.handle}`);
        problems.push(`Task "${task.key}": @${handle} doesn't have the "${task.skill}" skill.${capable.length ? ` Teammates who do: ${capable.join(", ")}.` : " No teammate has it; drop the skill or explain the gap to the person."}`);
      }
    }
    return {
      key: task.key,
      title: task.title,
      brief: task.brief,
      expectedOutput: task.expectedOutput,
      skill: task.skill,
      agentId: owner?.id ?? "",
      dependsOn: task.dependsOn ?? [],
    };
  });
  if (problems.length) throw new Error(`The plan needs fixing before it can start:\n- ${problems.join("\n- ")}`);
  return resolved;
}

/** A short description of who does what, wave by wave, for the planner's reply. */
async function describeWaves(tasks: Task[]): Promise<string[]> {
  const bots = new Map((await listBots()).map((b) => [b.id, b.name]));
  const byKey = new Map(tasks.map((t) => [t.key, t]));
  return parallelWaves(tasks).map((wave, i) => `Step ${i + 1}${wave.length > 1 ? " (in parallel)" : ""}: ${wave.map((k) => `${byKey.get(k)?.title} → ${bots.get(byKey.get(k)?.agentId ?? "") ?? "?"}`).join("; ")}`);
}

function conversationFrom(context: { requestContext: { get(key: string): unknown } }): ConversationId {
  const conversationId = conversationIdOf(context.requestContext);
  if (!conversationId) throw new Error("Couldn't tell which conversation this is, so no plan was started.");
  if (conversationId.startsWith("task:")) throw new Error("You're working inside a task, so you can't start a plan from here. Do the task yourself.");
  return conversationId;
}

/** Engine errors (PlanError) reach the model as plain errors with the same message. */
async function asToolError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof PlanError) throw new Error(error.message);
    throw error;
  }
}

// ── the tools ───────────────────────────────────────────────────────────

/** create_plan, update_plan and plan_status for one planning bot. */
export function planningTools(planner: Bot): ToolsInput {
  return {
    create_plan: createTool({
      id: "create_plan",
      description:
        "Start a team plan: break the request into tasks for teammates. Tasks without dependencies run at the same time; each task gets the results of the tasks it depends on. You write the final deliverable yourself as the last step (added automatically). One plan at a time per conversation.",
      inputSchema: z.object({
        title: z.string().min(3).max(100).describe("A short name for the plan."),
        goal: z.string().min(10).describe("The person's request, restated clearly with any assumptions."),
        tasks: z.array(planTaskSchema).min(1).max(7),
      }),
      execute: async ({ title, goal, tasks }, context) =>
        asToolError(async () => {
          const conversationId = conversationFrom(context);
          const active = await activeRunIn(conversationId);
          if (active) throw new Error(`A plan is already running here ("${active.title}"). Use update_plan to change it, or plan_status to check it.`);
          const planned = await resolvePlanTasks(planner, tasks);
          const detail = await startRun({
            title,
            goal,
            conversationId,
            plannerBotId: planner.id,
            project: await activeProjectSlug(),
            tasks: planned,
            finalOutput: planner.outputFormat || DEFAULT_FINAL_OUTPUT,
          });
          return {
            started: true,
            runId: detail.run.id,
            steps: await describeWaves(detail.tasks),
            next: "The team is working now. Tell the person the plan in a few lines (who does what, what runs in parallel) and stop. Progress and the final deliverable will appear in this conversation.",
          };
        }),
    }),
    update_plan: createTool({
      id: "update_plan",
      description:
        "Change the plan running in this conversation, e.g. after the person sends a new instruction: cancel tasks that no longer fit and add new ones (they may depend on existing tasks). The final deliverable waits for the new tasks.",
      inputSchema: z.object({
        cancel: z.array(z.string()).describe("Keys of tasks to cancel. Empty if none."),
        add: z.array(planTaskSchema).max(5).describe("New tasks. Empty if none."),
        note: z.string().min(3).describe("Why the plan changed, in a few words."),
      }),
      execute: async ({ cancel, add, note }, context) =>
        asToolError(async () => {
          const conversationId = conversationFrom(context);
          const active = await activeRunIn(conversationId);
          if (!active) throw new Error("No plan is running in this conversation. Use create_plan to start one.");
          const detail = await updateRun(active.id, { cancelKeys: cancel, add: await resolvePlanTasks(planner, add), note });
          return { updated: true, tasks: detail.tasks.map((t) => `${t.key}: ${t.status}`) };
        }),
    }),
    plan_status: createTool({
      id: "plan_status",
      description: "Check the latest plan in this conversation: each task's status, attempts, errors and (short) results.",
      // At least one property: Gemini rejects tools whose parameters are an empty object.
      inputSchema: z.object({ includeResults: z.boolean().describe("Include the first part of each finished task's result.") }),
      execute: async ({ includeResults }, context) => {
        const run = await latestRunIn(conversationFrom(context));
        if (!run) return { plan: null, note: "No plan has been started in this conversation." };
        const detail = await runDetail(run.id);
        return {
          plan: { title: run.title, status: run.status, events: run.events.slice(-8).map((e) => e.text) },
          tasks: detail.tasks.map((t) => ({
            key: t.key,
            title: t.title,
            status: detail.waitingForApproval.includes(t.id) ? "waiting for the person's approval" : t.status,
            attempt: t.attempt,
            error: t.error,
            result: includeResults && t.output ? t.output.slice(0, 1500) : undefined,
          })),
        };
      },
    }),
  };
}

/** The most recent run started in a conversation, running or not. */
async function latestRunIn(conversationId: ConversationId): Promise<Run | null> {
  return (await listRuns(100)).find((r) => r.conversationId === conversationId) ?? null;
}

// ── prompt sections for a planning bot ──────────────────────────────────

const PLANNING_RULES = [
  "## How you run team work",
  "- A quick question you can answer from what you know: answer it yourself. Anything that needs research, analysis, writing or several specialists: call create_plan.",
  "- A good plan has 2-6 tasks. Pick each owner by role and skills from the team list below. Write each brief so it stands alone: the teammate sees only the brief and the results of the tasks it depends on.",
  "- Use dependsOn only where a task truly needs another's result; everything else runs at the same time. When facts or numbers matter, add a verification task for the QA teammate before the end.",
  "- After create_plan, tell the person the plan in a few lines and stop. The team works in the background; progress notices and the final deliverable (which you write as the last step) appear in this conversation.",
  "- If the person changes or adds something while a plan is running, call update_plan (cancel what no longer fits, add what's new). Don't start a second plan.",
  "- If no teammate fits a task, say so plainly and suggest what kind of agent would; don't pretend.",
].join("\n");

/** The team roster: everyone the planner can assign, with role, skills and main tools. */
async function teamSection(planner: Bot): Promise<string> {
  const teammates = (await listBots()).filter((b) => b.id !== planner.id);
  const lines = teammates.map((b) => {
    const tools = [b.tools.webSearch && "web search", b.tools.browser && "browser", b.tools.codeMode && "code", b.tools.files && "files/charts", b.connections.length && "connected apps"].filter(Boolean);
    return `- @${b.handle}: ${b.name}${b.title ? `, ${b.title}` : ""}. ${b.description} Skills: ${b.skills.join(", ") || "none"}. Tools: ${tools.join(", ") || "chat only"}.`;
  });
  return `## Your team (assign tasks by @handle)\n${lines.join("\n") || "(nobody yet: say so and suggest creating agents)"}`;
}

/** The plan in this conversation: running (full status) or the most recent finished one (for follow-ups). */
async function planSection(conversationId: ConversationId | undefined): Promise<string | null> {
  if (!conversationId || conversationId.startsWith("task:")) return null;
  const run = await latestRunIn(conversationId);
  if (!run) return null;
  const tasks = await listTasks(run.id);
  const bots = new Map((await listBots()).map((b) => [b.id, b.name]));
  if (run.status === "running") {
    const lines = tasks.map((t) => `- ${t.key} (${bots.get(t.agentId) ?? "?"}): ${t.status}${t.attempt > 1 ? `, attempt ${t.attempt}` : ""}${t.error && t.status !== "completed" ? `, error: ${t.error}` : ""}`);
    return `## The plan running in this conversation: "${run.title}"\nGoal: ${run.goal}\n${lines.join("\n")}\nIf the person's new message changes the work, use update_plan.`;
  }
  return `## The last plan in this conversation: "${run.title}" (${run.status})\nGoal: ${run.goal}\nResult (start): ${(run.result ?? run.error ?? "").slice(0, 1500)}`;
}

/** Extra prompt sections for a planning bot; empty for everyone else. */
export async function planningSections(bot: Bot, conversationId: ConversationId | undefined): Promise<string[]> {
  if (!bot.tools.planning) return [];
  const sections = [PLANNING_RULES, await teamSection(bot)];
  const plan = await planSection(conversationId);
  if (plan) sections.push(plan);
  return sections;
}

// ── mock mode ───────────────────────────────────────────────────────────

/**
 * The plan the scripted mock model proposes (mock mode only), so the whole pipeline runs without keys:
 * a research task for a teammate with market-research, then a check by a teammate with fact-check.
 */
export function mockPlan(goal: string, team: Bot[], planner: Bot): { title: string; goal: string; tasks: PlanTaskInput[] } {
  const others = team.filter((b) => b.id !== planner.id);
  const researcher = others.find((b) => b.skills.includes("market-research")) ?? others[0];
  const checker = others.find((b) => b.skills.includes("fact-check") && b.id !== researcher?.id) ?? others.find((b) => b.id !== researcher?.id);
  const tasks: PlanTaskInput[] = [];
  if (researcher) tasks.push({ key: "research", title: "Research the request", agent: researcher.handle, brief: `Research this and report the key facts with sources: ${goal}`, expectedOutput: "Key findings with sources", dependsOn: [] });
  if (checker) tasks.push({ key: "verify", title: "Check the research", agent: checker.handle, brief: "Check the research findings for unsupported claims and list what holds up.", expectedOutput: "Verdict per claim", dependsOn: researcher ? ["research"] : [] });
  return { title: `Plan: ${goal.slice(0, 60)}`, goal, tasks };
}
