"use client";

// The home screen when no chat is open: what the app does in three steps, whether its output
// is LIVE or SIMULATED right now, ready-made goals for MeetUniversity, and the screens a
// business user needs. Written for someone who has never heard of "agents".
import { Brain, CalendarClock, ListChecks, Plug, ShieldCheck, UserPlus } from "lucide-react";
import type { ReactNode } from "react";
import { api } from "@/lib/client/api";
import { useApp } from "./OpenCrewBotApp";
import type { Panel } from "./OpenCrewBotApp";

/** Goals that exercise the whole team. Each one is sent to the Chief of Staff as a normal message. */
const EXAMPLE_GOALS = [
  {
    title: "Competitive landscape",
    text: "Research the competitive landscape for MeetUniversity (meetuniversity.com): competitors, their products, public pricing, target customers and positioning, and the market opportunities for us. Get the facts checked and give me one consolidated report with a comparison table.",
  },
  {
    title: "Campaign for Class 11 students",
    text: "Create a campaign for MeetUniversity's Aspirations product targeting Class 11 students: research the audience and their concerns, develop campaign concepts, prepare a 30-day content calendar and draft sample posts.",
  },
  {
    title: "Weekly competitor monitor",
    text: "Set up a weekly workflow that checks MeetUniversity's main competitors every Monday at 09:00 and reports what changed since the previous week.",
  },
];

function Shortcut({ icon, title, text, panel }: { icon: ReactNode; title: string; text: string; panel: Panel }) {
  const { setPanel } = useApp();
  return (
    <button type="button" onClick={() => setPanel(panel)} className="flex items-start gap-3 rounded-2xl bg-raised px-4 py-3 text-left ring-1 ring-line transition-colors hover:bg-hover">
      <span className="mt-0.5 text-mute">{icon}</span>
      <span>
        <span className="block text-[14px] font-medium">{title}</span>
        <span className="block text-[12.5px] text-mute">{text}</span>
      </span>
    </button>
  );
}

export function StartHere() {
  const { state, open, toast } = useApp();
  const chief = state.bots.find((b) => b.tools.planning);
  const mock = state.status?.mock ?? true;
  const live = state.status?.providers.filter((p) => p.configured).map((p) => p.label) ?? [];

  const ask = async (text: string) => {
    if (!chief) return toast("No Chief of Staff yet: turn on Plan team work for one bot first.");
    try {
      await api.send(`dm:${chief.id}`, text);
      open(`dm:${chief.id}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't send that.");
    }
  };

  return (
    // my-auto centres it vertically when it fits, and lets it scroll from the top when it doesn't.
    <div className="my-auto w-full max-w-2xl text-left">
      <p className="text-[22px] font-semibold">Your AI team</p>
      <p className="mt-1 text-[14px] text-mute">Give it a business goal. It plans the work, splits it between specialists, checks the facts and hands you one result.</p>

      <p className={mock ? "mt-3 rounded-xl bg-warn-soft px-3.5 py-2 text-[13px] text-warn" : "mt-3 rounded-xl bg-ok/10 px-3.5 py-2 text-[13px] text-ok"}>
        {mock
          ? "SIMULATED: no model key is set (or mock mode is on), so answers are scripted and labelled SIMULATED. Add a key in .env for real work."
          : `LIVE: answers come from real models (${live.join(", ")}). App changes ask you first.`}
      </p>

      <ol className="mt-5 grid gap-2 text-[13px] sm:grid-cols-3">
        <li className="rounded-2xl bg-raised px-4 py-3">
          <span className="font-medium">1. Ask</span>
          <span className="block text-mute">Tell {chief?.name ?? "the Chief of Staff"} what you need, in plain words.</span>
        </li>
        <li className="rounded-2xl bg-raised px-4 py-3">
          <span className="font-medium">2. The team works</span>
          <span className="block text-mute">Specialists work at the same time; you can watch each task.</span>
        </li>
        <li className="rounded-2xl bg-raised px-4 py-3">
          <span className="font-medium">3. You decide</span>
          <span className="block text-mute">Anything sent outside waits for your OK. You get one report.</span>
        </li>
      </ol>

      {chief && (
        <section className="mt-6">
          <h3 className="mb-2 text-[12.5px] font-medium text-mute">Try a goal (sent to {chief.name})</h3>
          <ul className="space-y-2">
            {EXAMPLE_GOALS.map((g) => (
              <li key={g.title}>
                <button type="button" onClick={() => ask(g.text)} className="w-full rounded-2xl bg-raised px-4 py-3 text-left ring-1 ring-line transition-colors hover:bg-hover">
                  <span className="block text-[14px] font-medium">{g.title}</span>
                  <span className="line-clamp-2 block text-[12.5px] text-mute">{g.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6 grid gap-2 sm:grid-cols-2">
        <Shortcut icon={<ListChecks size={17} />} title="Tasks and runs" text="Watch the team's work, step by step, and read past results." panel={{ kind: "runs" }} />
        <Shortcut icon={<ShieldCheck size={17} />} title="Approval Centre" text="Approve or reject what agents want to do outside the app." panel={{ kind: "approvals" }} />
        <Shortcut icon={<UserPlus size={17} />} title="Create an agent" text="Describe the specialist you need; the form fills itself in." panel={{ kind: "new-bot" }} />
        <Shortcut icon={<CalendarClock size={17} />} title="Workflows" text="Work that repeats: weekly checks, monthly reports." panel={{ kind: "workflows" }} />
        <Shortcut icon={<Brain size={17} />} title="Memory" text="What the team remembers about you and the project. Edit it any time." panel={{ kind: "memory" }} />
        <Shortcut icon={<Plug size={17} />} title="Connections" text="GitHub, Notion, Slack and more, with what's really working." panel={{ kind: "connections" }} />
      </section>
    </div>
  );
}
