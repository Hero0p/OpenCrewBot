"use client";

// The Task Dashboard: every team run (the execution history), and for one run its
// plan, a timeline showing which tasks ran at the same time, each task's status,
// attempts, dependencies and output, and controls to cancel or retry.
import clsx from "clsx";
import { ArrowLeft, ChevronRight, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/lib/client/api";
import { timeLabel } from "@/lib/client/format";
import { canRetry } from "@/lib/shared/runs";
import type { ChatMessage, RunDetail, RunStatus, RunSummary, Task, TaskStatus } from "@/lib/shared/types";
import { useApp } from "./OpenCrewBotApp";
import { BotAvatar, Button, Drawer, inputClass } from "./ui";

const RUN_STATUS: Record<RunStatus, { text: string; className: string }> = {
  running: { text: "Running", className: "bg-accent-soft text-[#8db4ff]" },
  completed: { text: "Completed", className: "bg-ok/15 text-ok" },
  failed: { text: "Failed", className: "bg-danger-soft text-danger" },
  cancelled: { text: "Cancelled", className: "bg-raised-2 text-mute" },
};

const TASK_STATUS: Record<TaskStatus, { text: string; className: string; bar: string }> = {
  pending: { text: "Waiting", className: "bg-raised-2 text-mute", bar: "bg-[#3a3a3a]" },
  running: { text: "Running", className: "bg-accent-soft text-[#8db4ff]", bar: "bg-accent" },
  completed: { text: "Done", className: "bg-ok/15 text-ok", bar: "bg-ok" },
  failed: { text: "Failed", className: "bg-danger-soft text-danger", bar: "bg-danger" },
  cancelled: { text: "Cancelled", className: "bg-raised-2 text-mute", bar: "bg-[#555]" },
};

function Badge({ text, className }: { text: string; className: string }) {
  return <span className={clsx("shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium", className)}>{text}</span>;
}

/** The current time, ticking every second, so running tasks show live durations. (Rendering must not call Date.now() itself.) */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** "2m 05s" from start to end (or to now, while still running). */
function duration(now: number, fromIso?: string, toIso?: string): string {
  if (!fromIso) return "";
  const ms = (toIso ? Date.parse(toIso) : now) - Date.parse(fromIso);
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** Bars on one time axis: overlapping bars are tasks that ran at the same time. */
function Timeline({ tasks, now }: { tasks: Task[]; now: number }) {
  const started = tasks.filter((t) => t.startedAt);
  if (started.length === 0) return null;
  const begin = Math.min(...started.map((t) => Date.parse(t.startedAt!)));
  const end = Math.max(...started.map((t) => (t.completedAt ? Date.parse(t.completedAt) : now)), begin + 1000);
  const span = end - begin;
  return (
    <section className="mb-4">
      <h4 className="mb-1.5 text-[12.5px] font-medium text-mute">Timeline (overlapping bars ran in parallel)</h4>
      <div className="space-y-1 rounded-2xl bg-raised px-4 py-3">
        {started.map((t) => {
          const left = ((Date.parse(t.startedAt!) - begin) / span) * 100;
          const right = (((t.completedAt ? Date.parse(t.completedAt) : now) - begin) / span) * 100;
          return (
            <div key={t.id} className="flex items-center gap-2">
              <span className="w-28 shrink-0 truncate text-[11.5px] text-mute">{t.key}</span>
              <div className="relative h-3 flex-1 rounded bg-raised-2">
                <div className={clsx("absolute inset-y-0 rounded", TASK_STATUS[t.status].bar)} style={{ left: `${left}%`, width: `${Math.max(1.5, right - left)}%` }} />
              </div>
              <span className="w-14 shrink-0 text-right text-[11px] text-faint tabular-nums">{duration(now, t.startedAt, t.completedAt)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TaskRow({ task, detail, now }: { task: Task; detail: RunDetail; now: number }) {
  const { state, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [transcript, setTranscript] = useState<ChatMessage[] | null>(null);
  const bot = state.bots.find((b) => b.id === task.agentId);
  const waiting = detail.waitingForApproval.includes(task.id);
  const runActive = detail.run.status === "running";

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast(done);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't do that.");
    }
  };
  const loadTranscript = async () => {
    try {
      setTranscript((await api.messages(`task:${task.id}`)).messages);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't load the transcript.");
    }
  };

  return (
    <li className="px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          {bot && <BotAvatar bot={bot} size={22} />}
          <span className="min-w-0">
            <span className="block truncate text-[13.5px] font-medium">{task.isFinal ? "Final deliverable" : task.title}</span>
            <span className="block truncate text-[11.5px] text-faint">
              {bot?.name ?? "deleted agent"} · {task.key}
              {task.dependsOn.length ? ` · after ${task.dependsOn.join(", ")}` : " · no dependencies"}
              {task.attempt > 0 ? ` · attempt ${task.attempt}/${task.maxAttempts}` : ""}
              {task.startedAt ? ` · ${duration(now, task.startedAt, task.completedAt)}` : ""}
            </span>
          </span>
        </span>
        {waiting ? <Badge text="Needs your approval" className="bg-warn-soft text-warn" /> : <Badge {...TASK_STATUS[task.status]} />}
      </div>
      {task.error && task.status !== "completed" && <p className="mt-1 text-[12px] text-danger">{task.error}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[12.5px]">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 font-medium text-[#8db4ff] hover:underline">
          <ChevronRight size={13} className={clsx("transition-transform", open && "rotate-90")} /> {task.output ? "Output" : "Brief"}
        </button>
        <button type="button" onClick={loadTranscript} className="text-mute hover:text-ink hover:underline">
          Transcript
        </button>
        {runActive && !task.isFinal && (task.status === "pending" || task.status === "running") && (
          <button type="button" onClick={() => act(() => api.cancelTask(task.id), "Task cancelled.")} className="text-mute hover:text-danger">
            Cancel
          </button>
        )}
        {canRetry(detail.run, task) && (
          <button type="button" onClick={() => act(() => api.retryTask(task.id), "Task will run again.")} className="text-mute hover:text-ink">
            Retry
          </button>
        )}
        {waiting && (
          <span className="flex items-center gap-1 text-warn">
            <ShieldAlert size={13} /> Decide in the Approval Centre
          </span>
        )}
      </div>
      {open && (
        <div className="prose-chat mt-2 max-h-80 overflow-y-auto rounded-xl bg-raised-2 px-3.5 py-3 text-[13px]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{task.output ?? `**Brief:** ${task.brief}\n\n**Deliver:** ${task.expectedOutput}`}</ReactMarkdown>
        </div>
      )}
      {transcript && (
        <div className="mt-2 max-h-80 space-y-2 overflow-y-auto rounded-xl bg-raised-2 px-3.5 py-3 text-[12.5px]">
          {transcript.length === 0 && <p className="text-mute">No transcript yet.</p>}
          {transcript.map((m) => (
            <div key={m.id}>
              <p className="text-[11px] font-medium text-faint">
                {m.role === "user" ? "Brief from the engine" : (state.bots.find((b) => b.id === m.botId)?.name ?? "Agent")} · {timeLabel(m.createdAt)}
                {m.model ? ` · ${m.model}` : ""}
              </p>
              {m.parts.map((p, i) =>
                p.kind === "text" ? (
                  <p key={i} className="whitespace-pre-wrap">
                    {p.text.slice(0, 2000)}
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

function RunView({ runId, onBack }: { runId: string; onBack: () => void }) {
  const { state, toast } = useApp();
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const now = useNow();

  useEffect(() => {
    let cancelled = false;
    api
      .run(runId)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && toast(e instanceof Error ? e.message : "Couldn't load the run."));
    return () => {
      cancelled = true;
    };
  }, [runId, state.runsVersion, state.approvalsVersion, toast]);

  if (!detail) return <p className="py-6 text-center text-[13px] text-mute">Loading…</p>;
  const { run, tasks } = detail;
  const planner = state.bots.find((b) => b.id === run.plannerBotId);

  return (
    <div>
      <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1 text-[13px] text-mute hover:text-ink">
        <ArrowLeft size={14} /> All runs
      </button>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold">{run.title}</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-mute">{run.goal}</p>
          <p className="mt-1 text-[12px] text-faint">
            Planned by {planner?.name ?? "the Chief of Staff"} · started {timeLabel(run.createdAt)} · {duration(now, run.createdAt, run.completedAt)}
            {run.project ? ` · project ${run.project}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Badge {...RUN_STATUS[run.status]} />
          {run.status === "running" && (
            <Button size="sm" variant="danger" onClick={() => api.cancelRun(run.id).then(() => toast("Run cancelled."), (e) => toast(e instanceof Error ? e.message : "Couldn't cancel."))}>
              Cancel run
            </Button>
          )}
        </div>
      </div>
      <Timeline tasks={tasks} now={now} />
      <h4 className="mb-1.5 text-[12.5px] font-medium text-mute">Tasks</h4>
      <ul className="mb-4 divide-y divide-line rounded-2xl bg-raised">
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} detail={detail} now={now} />
        ))}
      </ul>
      {run.result && (
        <section className="mb-4">
          <h4 className="mb-1.5 text-[12.5px] font-medium text-mute">Final deliverable</h4>
          <div className="prose-chat max-h-96 overflow-y-auto rounded-2xl bg-raised px-4 py-3 text-[13.5px]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{run.result}</ReactMarkdown>
          </div>
        </section>
      )}
      <h4 className="mb-1.5 text-[12.5px] font-medium text-mute">What happened</h4>
      <ul className="space-y-1 rounded-2xl bg-raised px-4 py-3 text-[12.5px]">
        {run.events.map((e, i) => (
          <li key={i} className="grid grid-cols-[64px_1fr] gap-2">
            <span className="text-faint tabular-nums">{new Date(e.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>
            <span>{e.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Give the team a goal: it goes to the Chief of Staff's chat, which plans it. */
function NewGoal({ onSent }: { onSent: () => void }) {
  const { state, open, toast } = useApp();
  const [goal, setGoal] = useState("");
  const planner = state.bots.find((b) => b.tools.planning);
  if (!planner) return <p className="mb-4 text-[12.5px] text-mute">No bot can plan team work yet. Turn on &quot;Plan team work&quot; for one in its Edit details.</p>;

  const send = async () => {
    try {
      await api.send(`dm:${planner.id}`, goal);
      setGoal("");
      open(`dm:${planner.id}`);
      onSent();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't send.");
    }
  };

  return (
    <div className="mb-5 rounded-2xl bg-raised p-4">
      <p className="mb-2 text-[13px] font-medium">Give the team a goal</p>
      <textarea
        className={clsx(inputClass, "min-h-20 resize-y leading-relaxed")}
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        placeholder="Research MeetUniversity's competitors and give me a comparison with pricing and opportunities."
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[12px] text-faint">{planner.name} plans it, the team works in parallel, and the result comes back in the chat.</span>
        <Button size="sm" variant="primary" disabled={!goal.trim()} onClick={send}>
          Send to {planner.name}
        </Button>
      </div>
    </div>
  );
}

export function RunsPanel({ onClose }: { onClose: () => void }) {
  const { state, toast } = useApp();
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .runs()
      .then((d) => !cancelled && setRuns(d.runs))
      .catch((e) => !cancelled && toast(e instanceof Error ? e.message : "Couldn't load runs."));
    return () => {
      cancelled = true;
    };
  }, [state.runsVersion, toast]);

  return (
    <Drawer title="Tasks and runs" onClose={onClose} wide>
      {openRun ? (
        <RunView runId={openRun} onBack={() => setOpenRun(null)} />
      ) : (
        <>
          <NewGoal onSent={onClose} />
          <h3 className="mb-1.5 text-[12.5px] font-medium text-mute">Execution history</h3>
          <ul className="divide-y divide-line rounded-2xl bg-raised">
            {runs?.map(({ run, tasks }) => (
              <li key={run.id}>
                <button type="button" onClick={() => setOpenRun(run.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium">{run.title}</span>
                    <span className="block text-[12px] text-faint">
                      {timeLabel(run.createdAt)} · {tasks.completed}/{tasks.total} tasks done
                      {tasks.running ? ` · ${tasks.running} running` : ""}
                      {tasks.failed ? ` · ${tasks.failed} failed` : ""}
                    </span>
                  </span>
                  <Badge {...RUN_STATUS[run.status]} />
                </button>
              </li>
            ))}
            {runs?.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-mute">No runs yet. Give the team a goal above.</li>}
            {!runs && <li className="px-4 py-6 text-center text-[13px] text-mute">Loading…</li>}
          </ul>
        </>
      )}
    </Drawer>
  );
}
