// Evidence for the assignment's demonstrations: a team run, or the approval history and audit
// log, written as one Markdown file into the evidence folder (OPENCREWBOT_EVIDENCE_DIR,
// default ./evidence). Everything comes from what the app recorded; nothing is written by hand.
// Each file says whether its outputs are LIVE (real models) or SIMULATED (mock model).
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ChatMessage, Run, Task } from "@/lib/shared/types";
import { getRun, listApprovalsByStatus, listAudit, listBots, listMessages, listTasks } from "./db";
import { slugify } from "./files";
import { redactSecrets } from "./memory-files";

/** Where evidence files go. A deployment choice, so it's configuration. */
export const EVIDENCE_DIR = resolve(/*turbopackIgnore: true*/ process.env.OPENCREWBOT_EVIDENCE_DIR || "./evidence");

const time = (iso?: string) => (iso ? iso.slice(0, 19).replace("T", " ") : "");
const seconds = (from?: string, to?: string) => (from && to ? `${Math.round((Date.parse(to) - Date.parse(from)) / 1000)} s` : "");
const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");

/**
 * Evidence is meant to be published, so anything account-identifying is removed first: keys and tokens
 * (the app's usual redaction) and provider organisation ids, which Groq quotes in its rate-limit errors
 * (seen in a live run: "in organization `org_…`").
 */
export function scrubForPublishing(markdown: string): string {
  return redactSecrets(markdown).replace(/\borg_[A-Za-z0-9]{6,}/g, "org_[removed]");
}

function write(name: string, markdown: string): string {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = `${new Date().toISOString().slice(0, 10)}-${name}.md`;
  writeFileSync(join(EVIDENCE_DIR, file), scrubForPublishing(markdown));
  return file;
}

/** The models that actually answered in a task's transcript (fallbacks included). */
function modelsUsed(messages: ChatMessage[]): string[] {
  return [...new Set(messages.filter((m) => m.role === "bot" && m.model).map((m) => (m.fallbackFrom ? `${m.model} (fallback for ${m.fallbackFrom})` : m.model!)))];
}

function taskSection(task: Task, agent: string, transcript: ChatMessage[]): string {
  const tools = transcript.flatMap((m) => m.parts.filter((p) => p.kind === "tool").map((p) => (p.kind === "tool" ? `${p.label}${p.detail ? `: ${p.detail}` : ""} (${p.status}${p.simulated ? ", SIMULATED" : ""})` : "")));
  const tokens = transcript.reduce((sum, m) => sum + (m.usage?.input ?? 0) + (m.usage?.output ?? 0), 0);
  return [
    `### ${task.title} (${agent})`,
    `- Key: \`${task.key}\` · status: **${task.status}** · attempts: ${task.attempt}/${task.maxAttempts} · depends on: ${task.dependsOn.join(", ") || "nothing"}`,
    `- Models: ${modelsUsed(transcript).join(", ") || "none recorded"} · tokens: ${tokens.toLocaleString("en-US")}`,
    tools.length ? `- Tool steps:\n${tools.map((t) => `  - ${t}`).join("\n")}` : "- Tool steps: none",
    task.error && task.status !== "completed" ? `- Error: ${task.error}` : "",
    "",
    "<details><summary>Brief</summary>\n",
    task.brief,
    "\n</details>\n",
    task.output ? `#### Output\n\n${task.output}` : "_No output._",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * Write one team run as evidence: plan, timeline, every task with its output and models, events, approvals, result.
 * @returns the file name inside the evidence folder
 * @throws Error when the run doesn't exist
 */
export async function exportRunEvidence(runId: string): Promise<string> {
  const run: Run | null = await getRun(runId);
  if (!run) throw new Error("That run doesn't exist.");
  const [tasks, bots, approvals] = await Promise.all([listTasks(run.id), listBots(), listApprovalsByStatus(["pending", "approved", "rejected", "expired"], 500)]);
  const names = new Map(bots.map((b) => [b.id, b.name]));
  const transcripts = new Map(await Promise.all(tasks.map(async (t) => [t.id, await listMessages(`task:${t.id}`)] as const)));
  const taskConversations = new Set(tasks.map((t) => `task:${t.id}`));
  const runApprovals = approvals.filter((a) => taskConversations.has(a.conversationId));

  const timeline = tasks.map((t) => `| ${cell(t.title)} | ${names.get(t.agentId) ?? "?"} | ${t.status} | ${t.attempt} | ${time(t.startedAt)} | ${time(t.completedAt)} | ${seconds(t.startedAt, t.completedAt)} |`);
  const markdown = [
    `# Evidence: ${run.title}`,
    "",
    `**${run.simulated ? "SIMULATED (mock model: scripted outputs, not real work)" : "LIVE (real models and tools)"}** · status: **${run.status}** · started ${time(run.createdAt)} · ended ${time(run.completedAt)} · planned by ${names.get(run.plannerBotId) ?? "?"}${run.project ? ` · project ${run.project}` : ""}`,
    "",
    `**Goal:** ${run.goal}`,
    "",
    "## Timeline (overlapping times ran in parallel)",
    "",
    "| Task | Agent | Status | Attempts | Started | Ended | Took |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...timeline,
    "",
    "## What happened",
    "",
    ...run.events.map((e) => `- ${time(e.at)} ${e.text}`),
    "",
    run.findings?.length ? `## Findings shared between agents\n\n${run.findings.map((f) => `- **${f.by}:** ${f.text}`).join("\n")}\n` : "",
    "## Approvals requested by the run's tasks",
    "",
    runApprovals.length ? runApprovals.map((a) => `- ${time(a.requestedAt)} **${a.label}**: ${a.status}${a.decidedBy ? ` (${a.decidedBy})` : ""}\n  \`${cell(a.argsPreview).slice(0, 400)}\``).join("\n") : "- None.",
    "",
    "## Tasks",
    "",
    ...tasks.map((t) => taskSection(t, names.get(t.agentId) ?? "a deleted agent", transcripts.get(t.id) ?? [])),
    "",
    "## Final deliverable",
    "",
    run.result ?? "_None._",
    "",
  ].join("\n");
  return write(`run-${slugify(run.title)}-${run.id.slice(0, 8)}`, markdown);
}

/**
 * Write the approval history and the audit log as evidence (Demo 7: a rejected action never ran).
 * @returns the file name inside the evidence folder
 */
export async function exportAuditEvidence(): Promise<string> {
  const [approvals, audit, bots] = await Promise.all([listApprovalsByStatus(["pending", "approved", "rejected", "expired"], 200), listAudit(500), listBots()]);
  const names = new Map(bots.map((b) => [b.id, b.name]));
  const markdown = [
    "# Evidence: approvals and audit log",
    "",
    `Exported ${time(new Date().toISOString())} UTC. The audit log is append-only: the app has no code that edits or deletes its rows.`,
    "",
    "## Approval requests",
    "",
    "| Requested | Agent | Action | Decision | Decided by | Exact inputs |",
    "| --- | --- | --- | --- | --- | --- |",
    ...approvals.map((a) => `| ${time(a.requestedAt)} | ${names.get(a.botId) ?? "?"} | ${cell(a.label)} | **${a.status}** | ${a.decidedBy ?? ""} | \`${cell(a.argsPreview).slice(0, 300)}\` |`),
    "",
    "## Audit log (newest first)",
    "",
    "| When | Event | Agent | Tool | Detail |",
    "| --- | --- | --- | --- | --- |",
    ...audit.map((e) => `| ${time(e.at)} | ${e.event} | ${names.get(e.botId) ?? "?"} | ${e.toolName ?? ""} | ${cell(e.detail ?? "")} |`),
    "",
    "A rejected request shows **rejected** above and `approval.rejected` in the log, followed by `tool.not_run` for its tool, never `tool.ran_approved` or `tool.ran_auto`: its code never ran.",
    "",
  ].join("\n");
  return write("approvals-and-audit", markdown);
}
