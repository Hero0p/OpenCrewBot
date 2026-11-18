"use client";

// Scheduled workflows (Module I): create one, pause or resume it, run it now, and read its
// history: each run's status, trigger, duration, result, report file and transcript.
import clsx from "clsx";
import { ChevronRight, Play, Pause, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, type WorkflowWithRuns } from "@/lib/client/api";
import { timeLabel } from "@/lib/client/format";
import { SCHEDULE_PRESETS, describeSchedule } from "@/lib/shared/schedules";
import type { ChatMessage, WorkflowRun } from "@/lib/shared/types";
import { useApp } from "./OpenCrewBotApp";
import { SimulatedBadge } from "./Message";
import { Button, Drawer, Field, inputClass } from "./ui";

const RUN_STATUS: Record<WorkflowRun["status"], { text: string; className: string }> = {
  running: { text: "Running", className: "bg-accent-soft text-[#8db4ff]" },
  completed: { text: "Completed", className: "bg-ok/15 text-ok" },
  failed: { text: "Failed", className: "bg-danger-soft text-danger" },
};

const TRIGGER: Record<WorkflowRun["trigger"], string> = { schedule: "on schedule", "catch-up": "catch-up after the app was off", manual: "Run now" };

const MONITOR_EXAMPLE =
  "Check MeetUniversity's main competitors (Leverage Edu, Yocket, Edwise and any new ones) for changes in products, pricing and positioning. Compare with the previous run and report what changed, with sources.";

function minutes(fromIso: string, toIso?: string): string {
  if (!toIso) return "";
  const s = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

function NewWorkflow({ onCreated }: { onCreated: () => void }) {
  const { state, toast } = useApp();
  const planner = state.bots.find((b) => b.tools.planning) ?? state.bots[0];
  const [form, setForm] = useState({ name: "", instruction: "", botId: planner?.id ?? "", preset: SCHEDULE_PRESETS[3].cron, custom: "" });
  const [saving, setSaving] = useState(false);
  const schedule = form.preset === "custom" ? form.custom : form.preset;

  const save = async () => {
    setSaving(true);
    try {
      await api.createWorkflow({ name: form.name, instruction: form.instruction, botId: form.botId, schedule, enabled: true });
      toast(`Scheduled: ${describeSchedule(schedule).toLowerCase()}.`);
      setForm((f) => ({ ...f, name: "", instruction: "" }));
      onCreated();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't create the workflow.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-2xl bg-raised p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[14px] font-medium">New workflow</p>
        <Button size="sm" variant="ghost" onClick={() => setForm((f) => ({ ...f, name: "Competitor monitor", instruction: MONITOR_EXAMPLE }))}>
          Use the competitor-monitor example
        </Button>
      </div>
      <Field label="Name">
        <input className={inputClass} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Weekly competitor monitor" />
      </Field>
      <Field label="What to do each time" hint="Sent to the agent on every run, with the previous result so it can say what changed.">
        <textarea className={clsx(inputClass, "min-h-24")} value={form.instruction} onChange={(e) => setForm((f) => ({ ...f, instruction: e.target.value }))} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Who runs it" hint="The Chief of Staff can turn it into a team plan.">
          <select className={clsx(inputClass, "appearance-none")} value={form.botId} onChange={(e) => setForm((f) => ({ ...f, botId: e.target.value }))}>
            {state.bots.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.title ? `, ${b.title}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="When">
          <select className={clsx(inputClass, "appearance-none")} value={form.preset} onChange={(e) => setForm((f) => ({ ...f, preset: e.target.value }))}>
            {SCHEDULE_PRESETS.map((p) => (
              <option key={p.cron} value={p.cron}>
                {p.label}
              </option>
            ))}
            <option value="custom">Custom (cron)…</option>
          </select>
        </Field>
      </div>
      {form.preset === "custom" && (
        <Field label="Cron schedule" hint='5 parts: minute hour day month weekday, in server time. "0 9 * * 1-5" is weekdays at 09:00.'>
          <input className={clsx(inputClass, "font-mono")} value={form.custom} onChange={(e) => setForm((f) => ({ ...f, custom: e.target.value }))} placeholder="0 9 * * 1-5" />
        </Field>
      )}
      <div className="flex justify-end">
        <Button variant="primary" disabled={saving || !form.name.trim() || form.instruction.trim().length < 10 || !schedule.trim()} onClick={save}>
          {saving ? "Saving…" : "Schedule it"}
        </Button>
      </div>
    </div>
  );
}

function RunRow({ run }: { run: WorkflowRun }) {
  const { state } = useApp();
  const [open, setOpen] = useState(false);
  const [transcript, setTranscript] = useState<ChatMessage[] | null>(null);
  const reportUrl = run.reportPath ? `/api/files/${run.reportPath.split("/").map(encodeURIComponent).join("/")}` : null;
  return (
    <li className="px-4 py-2.5">
      <div className="flex items-center justify-between gap-2 text-[12.5px]">
        <span className="text-mute">
          {timeLabel(run.startedAt)} · {TRIGGER[run.trigger]}
          {run.completedAt ? ` · ${minutes(run.startedAt, run.completedAt)}` : ""}
        </span>
        <span className="flex items-center gap-1.5">
          {run.simulated && <SimulatedBadge title="Ran on the mock model: the result is scripted, not real work." />}
          <span className={clsx("rounded-full px-2 py-0.5 text-[11.5px] font-medium", RUN_STATUS[run.status].className)}>{RUN_STATUS[run.status].text}</span>
        </span>
      </div>
      {run.error && <p className="mt-1 text-[12px] text-danger">{run.error}</p>}
      <div className="mt-1 flex flex-wrap gap-3 text-[12px]">
        {run.result && (
          <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 font-medium text-[#8db4ff] hover:underline">
            <ChevronRight size={12} className={clsx("transition-transform", open && "rotate-90")} /> Result
          </button>
        )}
        {reportUrl && (
          <a href={reportUrl} target="_blank" rel="noopener noreferrer" className="text-mute hover:text-ink hover:underline">
            Report file
          </a>
        )}
        <button type="button" onClick={async () => setTranscript((await api.messages(run.conversationId)).messages)} className="text-mute hover:text-ink hover:underline">
          Transcript
        </button>
        {run.planRunId && <span className="text-faint">ran as a team plan (see Tasks and runs)</span>}
      </div>
      {open && run.result && (
        <div className="prose-chat mt-2 max-h-80 overflow-y-auto rounded-xl bg-raised-2 px-3.5 py-3 text-[13px]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{run.result}</ReactMarkdown>
        </div>
      )}
      {transcript && (
        <div className="mt-2 max-h-72 space-y-2 overflow-y-auto rounded-xl bg-raised-2 px-3.5 py-3 text-[12.5px]">
          {transcript.length === 0 && <p className="text-mute">No transcript yet.</p>}
          {transcript.map((m) => (
            <div key={m.id}>
              <p className="text-[11px] font-medium text-faint">
                {m.role === "user" ? "Instruction" : m.role === "notice" ? "Progress" : (state.bots.find((b) => b.id === m.botId)?.name ?? "Agent")} · {timeLabel(m.createdAt)}
              </p>
              {m.parts.map((p, i) =>
                p.kind === "text" ? (
                  <p key={i} className="whitespace-pre-wrap">
                    {p.text.slice(0, 1500)}
                  </p>
                ) : p.kind === "tool" ? (
                  <p key={i} className="text-mute">
                    [{p.label}
                    {p.detail ? `: ${p.detail}` : ""} · {p.status}]
                  </p>
                ) : null,
              )}
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

function WorkflowCard({ workflow, onChanged }: { workflow: WorkflowWithRuns; onChanged: () => void }) {
  const { state, toast } = useApp();
  const [showHistory, setShowHistory] = useState(workflow.runs.length > 0);
  const bot = state.bots.find((b) => b.id === workflow.botId);
  const last = workflow.runs[0];

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast(done);
      onChanged();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't do that.");
    }
  };

  return (
    <li className="rounded-2xl bg-raised">
      <div className="px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[14.5px] font-medium">{workflow.name}</p>
            <p className="text-[12.5px] text-mute">
              {describeSchedule(workflow.schedule)} · run by {bot?.name ?? "a deleted agent"}
            </p>
            <p className="text-[12px] text-faint">
              {workflow.enabled ? (workflow.nextRunAt ? `Next run ${timeLabel(workflow.nextRunAt)} (${new Date(workflow.nextRunAt).toLocaleString()})` : "") : "Paused"}
              {workflow.running ? " · running now" : ""}
            </p>
          </div>
          {last && <span className={clsx("shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-medium", RUN_STATUS[last.status].className)}>Last: {RUN_STATUS[last.status].text}</span>}
        </div>
        <p className="mt-2 line-clamp-2 text-[12.5px] text-mute">{workflow.instruction}</p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" disabled={workflow.running} onClick={() => act(() => api.runWorkflow(workflow.id), "Started. It shows below when it's done.")}>
            <Play size={13} /> Run now
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => act(() => api.updateWorkflow(workflow.id, { enabled: !workflow.enabled }), workflow.enabled ? "Paused." : "Resumed.")}
          >
            {workflow.enabled ? (
              <>
                <Pause size={13} /> Pause
              </>
            ) : (
              <>
                <Play size={13} /> Resume
              </>
            )}
          </Button>
          <button
            type="button"
            aria-label={`Delete ${workflow.name}`}
            onClick={() => window.confirm(`Delete "${workflow.name}" and its history? Its reports stay in Files.`) && act(() => api.deleteWorkflow(workflow.id), "Deleted.")}
            className="ml-auto rounded-full p-2 text-faint hover:bg-raised-2 hover:text-danger"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      {workflow.runs.length > 0 && (
        <div className="border-t border-line">
          <button type="button" onClick={() => setShowHistory((s) => !s)} className="flex w-full items-center gap-1 px-4 py-2 text-left text-[12.5px] font-medium text-mute hover:text-ink">
            <ChevronRight size={13} className={clsx("transition-transform", showHistory && "rotate-90")} /> Execution history ({workflow.runs.length})
          </button>
          {showHistory && (
            <ul className="divide-y divide-line pb-1">
              {workflow.runs.map((r) => (
                <RunRow key={r.id} run={r} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

export function WorkflowsPanel({ onClose }: { onClose: () => void }) {
  const { state, toast } = useApp();
  const [workflows, setWorkflows] = useState<WorkflowWithRuns[] | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = () => setNonce((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    api
      .workflows()
      .then(({ workflows }) => !cancelled && setWorkflows(workflows))
      .catch((error) => toast(error instanceof Error ? error.message : "Couldn't load workflows."));
    return () => {
      cancelled = true;
    };
  }, [state.workflowsVersion, nonce, toast]);

  return (
    <Drawer title="Workflows" onClose={onClose} wide>
      <p className="text-[13px] leading-relaxed text-mute">
        Things the team does on a schedule: weekly competitor checks, monthly reports, daily summaries. Each run is saved with its result and report, and gets the previous result so it can tell
        you what changed. Missed runs (the app was off) run once when it starts again.
      </p>
      <div className="mt-5">
        <NewWorkflow onCreated={reload} />
      </div>
      <section className="mt-6">
        <h3 className="mb-2 text-[12.5px] font-medium text-mute">Your workflows</h3>
        {workflows === null && <p className="rounded-2xl bg-raised px-4 py-6 text-center text-[13px] text-mute">Loading…</p>}
        {workflows?.length === 0 && <p className="rounded-2xl bg-raised px-4 py-6 text-center text-[13px] text-mute">None yet. Schedule one above.</p>}
        <ul className="space-y-3">
          {workflows?.map((w) => (
            <WorkflowCard key={w.id} workflow={w} onChanged={reload} />
          ))}
        </ul>
      </section>
    </Drawer>
  );
}
