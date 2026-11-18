"use client";

import clsx from "clsx";
import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { ActionGroup, Bot, BotInput } from "@/lib/shared/types";
import { useApp } from "./OpenCrewBotApp";
import { FallbackEditor, ModelPicker } from "./ModelPicker";
import { useSkills } from "@/lib/client/use-skills";
import { mockModeText } from "./SettingsPanel";
import { Button, Drawer, Field, Mascot, Segmented, Toggle, inputClass } from "./ui";

export const BOT_COLORS = ["#3b82f6", "#f59e0b", "#ec4899", "#22c55e", "#8b5cf6", "#14b8a6", "#ef4444", "#eab308", "#f4f4f4"];

function blankBot(defaultModel: string): BotInput {
  return {
    name: "",
    title: "",
    description: "",
    instructions: "",
    emoji: "",
    color: BOT_COLORS[Math.floor(Math.random() * BOT_COLORS.length)],
    model: defaultModel,
    tools: { webSearch: true, memory: true, codeMode: false, browser: false, askUser: true, files: true },
    approval: "ask",
    preapprovedActions: [],
    autoActionsPerDay: 20,
    skills: [],
    outputFormat: "",
    pinned: false,
  };
}

/** The kinds of action a controlled-access bot can be allowed to run without asking. */
const ACTION_GROUP_OPTIONS: { value: ActionGroup; label: string; hint: string }[] = [
  { value: "apps", label: "Connected apps and MCP servers", hint: "Sending messages, creating issues or pages, and similar." },
  { value: "browser", label: "Browser actions", hint: "Opening pages, clicking and typing in the cloud browser." },
];

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap justify-center gap-2" role="radiogroup" aria-label="Color">
      {BOT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={`Color ${c}`}
          onClick={() => onChange(c)}
          className={clsx(
            "flex h-7 w-7 items-center justify-center rounded-full transition-transform hover:scale-110",
            value === c && "ring-2 ring-white ring-offset-2 ring-offset-side",
          )}
          style={{ background: c }}
        >
          {value === c && <Check size={14} className={c === "#f4f4f4" ? "text-black" : "text-white"} />}
        </button>
      ))}
    </div>
  );
}

/** Create or edit a bot. In edit mode the save bar appears only once something changes. */
export function BotForm({ bot, onDone }: { bot?: Bot; onDone?: (bot: Bot) => void }) {
  const { state, open, toast } = useApp();
  const defaultModel = state.status?.defaultModel ?? "google/gemini-2.5-flash";
  const [initial, setInitial] = useState<BotInput>(() => (bot ? { ...bot } : blankBot(defaultModel)));
  const [form, setForm] = useState<BotInput>(initial);
  const [saving, setSaving] = useState(false);
  const keys = state.status?.keys;
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const set = <K extends keyof BotInput>(k: K, v: BotInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const preapproved = form.preapprovedActions ?? [];
  const chosenSkills = form.skills ?? [];
  const skillsLibrary = useSkills();
  const setTool = (k: keyof BotInput["tools"], v: boolean) => setForm((f) => ({ ...f, tools: { ...f.tools, [k]: v } }));

  const save = async () => {
    setSaving(true);
    try {
      if (bot) {
        const { bot: saved } = await api.updateBot(bot.id, form);
        setInitial({ ...saved });
        setForm({ ...saved });
        toast("Saved. Changes apply from the next reply.");
        onDone?.(saved);
      } else {
        const { bot: created } = await api.createBot(form);
        open(`dm:${created.id}`);
        onDone?.(created);
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!bot || !window.confirm(`Delete ${bot.name}? Its chat and MEMORY.md are deleted too.`)) return;
    try {
      await api.deleteBot(bot.id);
      open(null);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't delete.");
    }
  };

  return (
    <div className="flex flex-col">
      <div className="space-y-5">
        {!bot && (
          <div className="flex flex-col items-center gap-4 pt-1">
            <Mascot color={form.color} size={72} />
            <ColorPicker value={form.color} onChange={(c) => set("color", c)} />
          </div>
        )}
        {bot && (
          <Field label="Color">
            <ColorPicker value={form.color} onChange={(c) => set("color", c)} />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <input className={inputClass} value={form.name} maxLength={40} onChange={(e) => set("name", e.target.value)} placeholder="Scout" />
          </Field>
          <Field label="Role">
            <input className={inputClass} value={form.title} maxLength={40} onChange={(e) => set("title", e.target.value)} placeholder="Research" />
          </Field>
        </div>
        {bot && (
          <Field label="Handle" hint="For @mentions in rooms.">
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-[14px] text-faint">@</span>
              <input
                className={clsx(inputClass, "pl-7")}
                value={form.handle ?? bot.handle}
                onChange={(e) => set("handle", e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
              />
            </div>
          </Field>
        )}
        <Field label="What it's for" hint="One line. Rooms use it to decide who answers.">
          <input
            className={inputClass}
            value={form.description}
            maxLength={200}
            onChange={(e) => set("description", e.target.value)}
            placeholder="Finds things out on the web and comes back with sourced answers."
          />
        </Field>
        <Field label="Instructions" hint="How it should work and talk. Part of its system prompt.">
          <textarea
            className={clsx(inputClass, "min-h-28 resize-y leading-relaxed")}
            value={form.instructions}
            onChange={(e) => set("instructions", e.target.value)}
            placeholder="Research before answering anything time-sensitive. Cite the URLs you used."
          />
        </Field>

        {/* Not a <label>: the picker holds buttons and its own search field. */}
        <div>
          <span className="mb-1.5 block text-[12.5px] font-medium text-mute">Model</span>
          <ModelPicker value={form.model} onChange={(id) => set("model", id)} />
          <FallbackEditor model={form.model} value={form.fallbackModels} onChange={(v) => set("fallbackModels", v)} />
          {state.status?.mockReason && <span className="mt-1.5 block text-[12px] leading-snug text-faint">{mockModeText(state.status.mockReason)}</span>}
        </div>

        <div>
          <span className="mb-1.5 block text-[12.5px] font-medium text-mute">Tools</span>
          <div className="divide-y divide-line rounded-2xl bg-raised px-4">
            <Toggle
              label="Web search"
              hint={keys?.tavily ? "Tavily search, page reading and site crawls." : "Tavily. Needs TAVILY_API_KEY."}
              checked={form.tools.webSearch}
              onChange={(v) => setTool("webSearch", v)}
            />
            <Toggle label="Memory" hint="Reads and updates its own MEMORY.md." checked={form.tools.memory} onChange={(v) => setTool("memory", v)} />
            <Toggle
              label="Code mode"
              hint="Writes one TypeScript function that calls several tools at once, in a sandbox."
              checked={form.tools.codeMode}
              onChange={(v) => setTool("codeMode", v)}
            />
            <Toggle
              label="Browser"
              hint={keys?.browserbase ? "A Browserbase cloud browser you can watch live." : "Browserbase. Needs BROWSERBASE_API_KEY."}
              checked={form.tools.browser}
              onChange={(v) => setTool("browser", v)}
            />
            <Toggle label="Ask me questions" hint="Can pause and ask you with a card in chat." checked={form.tools.askUser} onChange={(v) => setTool("askUser", v)} />
            <Toggle
              label="Files and charts"
              hint="Reads spreadsheets (CSV), makes charts and saves reports in the shared Files folder."
              checked={form.tools.files ?? false}
              onChange={(v) => setTool("files", v)}
            />
          </div>
        </div>

        <div>
          <span className="mb-1.5 block text-[12.5px] font-medium text-mute">Skills</span>
          <div className="divide-y divide-line rounded-2xl bg-raised px-4">
            {skillsLibrary.data?.skills.map((s) => (
              <Toggle
                key={s.id}
                label={s.name}
                hint={s.description}
                checked={chosenSkills.includes(s.id)}
                onChange={(on) => set("skills", on ? [...chosenSkills, s.id] : chosenSkills.filter((id) => id !== s.id))}
              />
            ))}
            {skillsLibrary.loading && <p className="py-3 text-[13px] text-mute">Loading skills…</p>}
            {skillsLibrary.error && <p className="py-3 text-[13px] text-danger">{skillsLibrary.error}</p>}
          </div>
          <span className="mt-1.5 block text-[12px] leading-snug text-faint">The bot sees each skill&apos;s description and loads the full procedure only when a task matches.</span>
        </div>

        <Field label="Output format" hint="What its answers should look like. Part of its system prompt.">
          <textarea
            className={clsx(inputClass, "min-h-20 resize-y leading-relaxed")}
            value={form.outputFormat ?? ""}
            maxLength={1000}
            onChange={(e) => set("outputFormat", e.target.value)}
            placeholder="A comparison table, an evidence list and strategic opportunities."
          />
        </Field>

        <Field label="Permission level" hint="Searching, reading pages and its own memory never ask. Rejected actions never run.">
          <Segmented
            value={form.approval}
            onChange={(v) => set("approval", v)}
            options={[
              { value: "ask", label: "Ask first", hint: "Every action in apps or the browser waits for your OK." },
              { value: "controlled", label: "Controlled", hint: "Chosen kinds of action run on their own, up to a daily limit." },
              { value: "full", label: "Full access", hint: "Acts without asking." },
            ]}
          />
        </Field>

        {form.approval === "controlled" && (
          <div>
            <span className="mb-1.5 block text-[12.5px] font-medium text-mute">Runs without asking</span>
            <div className="divide-y divide-line rounded-2xl bg-raised px-4">
              {ACTION_GROUP_OPTIONS.map((g) => (
                <Toggle
                  key={g.value}
                  label={g.label}
                  hint={g.hint}
                  checked={preapproved.includes(g.value)}
                  onChange={(on) => set("preapprovedActions", on ? [...preapproved, g.value] : preapproved.filter((x) => x !== g.value))}
                />
              ))}
              <label className="flex items-center justify-between gap-3 py-2.5 text-[14px]">
                <span>
                  Daily limit
                  <span className="mt-0.5 block text-[12.5px] text-mute">After this many actions in 24 hours, it asks again.</span>
                </span>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  className={clsx(inputClass, "w-24 text-right")}
                  value={form.autoActionsPerDay ?? 20}
                  onChange={(e) => set("autoActionsPerDay", Math.max(0, Math.min(1000, Math.round(Number(e.target.value) || 0))))}
                />
              </label>
            </div>
          </div>
        )}

        {bot && (
          <div className="pt-2">
            <Button variant="danger" size="sm" onClick={remove}>
              Delete bot
            </Button>
          </div>
        )}
      </div>

      {(dirty || !bot) && (
        <div className="sticky bottom-0 -mx-5 mt-5 flex items-center justify-end gap-2 border-t border-line bg-side px-5 py-3">
          {bot && (
            <Button variant="ghost" onClick={() => setForm(initial)}>
              Discard
            </Button>
          )}
          <Button variant="primary" onClick={save} disabled={saving || !form.name.trim() || (bot && !dirty)}>
            {saving ? "Saving…" : bot ? "Save changes" : "Create bot"}
          </Button>
        </div>
      )}
    </div>
  );
}

export function NewBotDrawer({ onClose }: { onClose: () => void }) {
  return (
    <Drawer title="New bot" onClose={onClose}>
      <BotForm onDone={onClose} />
    </Drawer>
  );
}

/** The bot's MEMORY.md, editable, refreshed live when the bot writes to it. */
export function MemoryEditor({ bot }: { bot: Bot }) {
  const { state, toast } = useApp();
  const [content, setContent] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const [meta, setMeta] = useState<{ path: string; limit: { lines: number; bytes: number } } | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = content !== null && content !== saved;
  const version = state.memoryVersion[bot.id] ?? 0;

  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  // Load, and reload when the bot writes to its memory unless you have unsaved edits.
  useEffect(() => {
    if (dirtyRef.current) return;
    let cancelled = false;
    api
      .getMemory(bot.id)
      .then((data) => {
        if (cancelled) return;
        setSaved(data.content);
        setContent(data.content);
        setMeta({ path: data.path, limit: data.limit });
      })
      .catch((error) => toast(error instanceof Error ? error.message : "Couldn't load memory."));
    return () => {
      cancelled = true;
    };
  }, [bot.id, version, toast]);

  const save = async () => {
    if (content === null) return;
    setSaving(true);
    try {
      const data = await api.saveMemory(bot.id, content);
      setSaved(data.content);
      setContent(data.content);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't save memory.");
    } finally {
      setSaving(false);
    }
  };

  const lines = content ? content.trimEnd().split("\n").length : 0;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-center text-[13px] leading-relaxed text-mute">
        {bot.name} reads this at the start of every turn and keeps it up to date. It&apos;s plain Markdown, so edit away.
      </p>
      {!bot.tools.memory && (
        <p className="rounded-xl bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn">Memory is off for this bot, so this file isn&apos;t loaded.</p>
      )}
      <textarea
        value={content ?? ""}
        onChange={(e) => setContent(e.target.value)}
        disabled={content === null}
        spellCheck={false}
        aria-label="MEMORY.md"
        className={clsx(inputClass, "h-[50vh] min-h-[240px] resize-y rounded-2xl p-4 font-mono text-[12.5px] leading-relaxed")}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[12px] text-faint" title={meta?.path}>
          MEMORY.md · {lines} {lines === 1 ? "line" : "lines"}
          {meta && lines > meta.limit.lines ? ` · first ${meta.limit.lines} load` : ""}
        </span>
        <span className="flex shrink-0 gap-2">
          {dirty && (
            <Button size="sm" variant="ghost" onClick={() => setContent(saved)}>
              Revert
            </Button>
          )}
          <Button size="sm" variant="primary" disabled={!dirty || saving} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </span>
      </div>
    </div>
  );
}
