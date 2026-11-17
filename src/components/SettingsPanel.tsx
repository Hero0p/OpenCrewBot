"use client";

import clsx from "clsx";
import { ArrowUpRight } from "lucide-react";
import type { MockReason } from "@/lib/shared/types";
import { useApp } from "./OpenCrewBotApp";
import { Drawer } from "./ui";

function KeyRow({ name, envVar, ok, what, href }: { name: string; envVar: string; ok: boolean; what: string; href: string }) {
  return (
    <li className="px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[14.5px] font-medium">{name}</span>
        <span className={clsx("flex items-center gap-1.5 text-[12.5px]", ok ? "text-ok" : "text-faint")}>
          <span className={clsx("h-2 w-2 rounded-full", ok ? "bg-ok" : "bg-[#3a3a3a]")} />
          {ok ? "Connected" : "Not set"}
        </span>
      </div>
      <p className="mt-1 text-[13px] leading-snug text-mute">{what}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <code className="rounded-md bg-raised-2 px-1.5 py-0.5 font-mono text-[12px] text-mute">{envVar}</code>
        <a className="inline-flex items-center gap-0.5 text-[12.5px] text-mute hover:text-ink" href={href} target="_blank" rel="noopener noreferrer">
          Get a key <ArrowUpRight size={13} />
        </a>
      </div>
    </li>
  );
}

/** One line explaining why bots are on the scripted mock model. */
export function mockModeText(reason: MockReason): string {
  return reason === "forced"
    ? "Mock mode is on because OPENCREWBOT_MOCK_MODE=true: replies come from a scripted model, not an AI."
    : "Mock mode: no model provider key is set, so replies come from a scripted model, not an AI.";
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { state } = useApp();
  const status = state.status;
  return (
    <Drawer title="Settings" onClose={onClose}>
      <p className="text-[13px] leading-relaxed text-mute">
        Keys live on the server in <code className="rounded-md bg-raised-2 px-1 font-mono text-[12px]">.env</code>, never in the browser. Add them, then
        restart <code className="rounded-md bg-raised-2 px-1 font-mono text-[12px]">pnpm dev</code>.
      </p>
      {status?.mockReason && <p className="mt-3 rounded-2xl bg-raised px-4 py-3 text-[13px] text-warn">{mockModeText(status.mockReason)}</p>}
      <section className="mt-5">
        <h3 className="text-[12.5px] font-medium text-mute">Model providers</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-mute">
          Each bot picks one model. If it fails, the bot falls back to another provider that has a key.
        </p>
        <ul className="mt-3 divide-y divide-line rounded-2xl bg-raised">
          {status?.providers.map((p) => (
            <KeyRow
              key={p.id}
              name={p.label}
              envVar={p.keyEnvVars[0]}
              ok={p.configured}
              what={`Recommended model: ${p.recommendedModel}`}
              href={p.signupUrl}
            />
          ))}
        </ul>
      </section>
      <section className="mt-7">
        <h3 className="text-[12.5px] font-medium text-mute">Tool services</h3>
        <ul className="mt-3 divide-y divide-line rounded-2xl bg-raised">
          <KeyRow name="Tavily" envVar="TAVILY_API_KEY" ok={Boolean(status?.keys.tavily)} what="Web search, page reading and site crawls." href="https://app.tavily.com" />
          <KeyRow
            name="Browserbase"
            envVar="BROWSERBASE_API_KEY"
            ok={Boolean(status?.keys.browserbase)}
            what="Cloud browsers for bots with the Browser tool. Watch them live and take over."
            href="https://www.browserbase.com"
          />
          <KeyRow
            name="Composio"
            envVar="COMPOSIO_API_KEY"
            ok={Boolean(status?.keys.composio)}
            what="Connected apps: Slack, GitHub, Gmail, Notion and 1,000+ more, with sign-in handled by Composio."
            href="https://platform.composio.dev"
          />
          <KeyRow
            name="Jev (TypeSafe)"
            envVar="TYPESAFE_API_KEY"
            ok={Boolean(status?.keys.jev)}
            what="Picks who answers in Auto rooms. Without it, the room's lead answers."
            href="https://typesafe.ai"
          />
        </ul>
      </section>
      <section className="mt-7">
        <h3 className="text-[12.5px] font-medium text-mute">Data</h3>
        <p className="mt-1 text-[13px] text-mute">
          Bots, chats and each bot&apos;s <code className="rounded-md bg-raised-2 px-1 font-mono text-[12px]">MEMORY.md</code> are stored locally in:
        </p>
        <p className="mt-2 rounded-2xl bg-raised px-4 py-3 font-mono text-[12px] break-all text-mute">{status?.dataDir}</p>
      </section>
    </Drawer>
  );
}
