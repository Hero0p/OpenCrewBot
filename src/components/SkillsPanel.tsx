"use client";

// Skills & Tools: the skills library (from skills/*/SKILL.md), the built-in tool
// catalog with each tool's permission behaviour, and the shared Files folder
// (upload spreadsheets, open reports and charts bots made).
import { ChevronRight, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/lib/client/api";
import { timeLabel } from "@/lib/client/format";
import { useSkills } from "@/lib/client/use-skills";
import type { FileEntry, SkillSummary, ToolInfo } from "@/lib/shared/types";
import { useApp } from "./OpenCrewBotApp";
import { Button, Drawer, Tabs } from "./ui";

type Tab = "skills" | "tools" | "files";

/** How a tool category behaves under the permission levels (see permissions.ts). */
const CATEGORY_TEXT: Record<ToolInfo["category"], string> = {
  read: "Never asks (lookup)",
  edit: "Never asks (inside OpenCrewBot)",
  execute: "Asks, unless the bot's level allows browser actions",
  mcp: "Asks, unless the bot's level allows app actions",
  other: "Always asks",
};

function SkillCard({ skill }: { skill: SkillSummary }) {
  const { state } = useApp();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState<string | null>(null);
  const usedBy = state.bots.filter((b) => b.skills.includes(skill.id)).map((b) => b.name);

  const toggle = async () => {
    setOpen((o) => !o);
    if (body === null) {
      try {
        setBody((await api.skill(skill.id)).skill.body);
      } catch (error) {
        setBody(`Couldn't load the procedure: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }
  };

  return (
    <li className="rounded-2xl bg-raised p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[14.5px] font-medium">{skill.name}</p>
          <p className="font-mono text-[11.5px] text-faint">skills/{skill.id}/SKILL.md</p>
        </div>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed">{skill.description}</p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-mute">
        <span className="font-medium text-ink">Use for:</span> {skill.whenToUse}
      </p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-mute">
        <span className="font-medium text-ink">Produces:</span> {skill.output}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {skill.tools.map((t) => (
          <span key={t} className="rounded-full bg-raised-2 px-2 py-0.5 font-mono text-[11.5px] text-mute">
            {t}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-faint">{usedBy.length ? `Used by ${usedBy.join(", ")}` : "No bot uses it yet."}</p>
      <button type="button" onClick={toggle} className="mt-2 flex items-center gap-1 text-[12.5px] font-medium text-[#8db4ff] hover:underline">
        <ChevronRight size={13} className={open ? "rotate-90 transition-transform" : "transition-transform"} /> {open ? "Hide procedure" : "Read the procedure"}
      </button>
      {open && (
        <div className="prose-chat mt-2 max-h-96 overflow-y-auto rounded-xl bg-raised-2 px-3.5 py-3 text-[13px]">
          {body === null ? "Loading…" : <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>}
        </div>
      )}
    </li>
  );
}

function ToolsList({ tools }: { tools: ToolInfo[] }) {
  const { state } = useApp();
  const keyIsSet = (envVar?: string) => {
    if (!envVar) return true;
    const keys = state.status?.keys;
    if (envVar === "TAVILY_API_KEY") return Boolean(keys?.tavily);
    if (envVar === "BROWSERBASE_API_KEY") return Boolean(keys?.browserbase);
    if (envVar === "COMPOSIO_API_KEY") return Boolean(keys?.composio);
    return true;
  };
  return (
    <ul className="divide-y divide-line rounded-2xl bg-raised">
      {tools.map((t) => (
        <li key={t.name} className="px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[14px] font-medium">{t.label}</span>
            <span className="font-mono text-[11.5px] text-faint">{t.name}</span>
          </div>
          <p className="mt-1 text-[12.5px] leading-snug text-mute">{t.description}</p>
          <p className="mt-1 text-[12px] text-faint">
            {CATEGORY_TEXT[t.category]} · turned on by: {t.enabledBy}
            {t.needsKey && (keyIsSet(t.needsKey) ? ` · ${t.needsKey} set` : ` · needs ${t.needsKey}`)}
          </p>
        </li>
      ))}
    </ul>
  );
}

function FilesList() {
  const { toast } = useApp();
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [reload, setReload] = useState(0);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .files()
      .then((d) => !cancelled && setFiles(d.files))
      .catch((e) => !cancelled && toast(e instanceof Error ? e.message : "Couldn't load files."));
    return () => {
      cancelled = true;
    };
  }, [reload, toast]);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const { path } = await api.uploadFile(file);
      toast(`Uploaded as ${path}. Bots with Files and charts can read it.`);
      setReload((n) => n + 1);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't upload.");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[12.5px] leading-snug text-mute">Upload spreadsheets (CSV) for bots to analyse. Reports and charts bots make appear here too.</p>
        <input ref={input} type="file" accept=".csv,.md,.txt,.json" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <Button size="sm" variant="secondary" disabled={uploading} onClick={() => input.current?.click()}>
          <Upload size={14} /> {uploading ? "Uploading…" : "Upload"}
        </Button>
      </div>
      <ul className="divide-y divide-line rounded-2xl bg-raised">
        {files?.map((f) => (
          <li key={f.path} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <a href={`/api/files/${f.path.split("/").map(encodeURIComponent).join("/")}`} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate font-mono text-[12.5px] text-ink hover:underline">
              {f.path}
            </a>
            <span className="shrink-0 text-[12px] text-faint">
              {f.size < 1024 ? `${f.size} B` : `${Math.round(f.size / 1024)} KB`} · {timeLabel(f.modifiedAt)}
            </span>
          </li>
        ))}
        {files?.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-mute">No files yet.</li>}
        {!files && <li className="px-4 py-6 text-center text-[13px] text-mute">Loading…</li>}
      </ul>
    </>
  );
}

export function SkillsPanel({ onClose }: { onClose: () => void }) {
  const { data, error, loading } = useSkills();
  const [tab, setTab] = useState<Tab>("skills");

  return (
    <Drawer title="Skills and tools" onClose={onClose}>
      <div className="mb-4">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "skills", label: data ? `Skills (${data.skills.length})` : "Skills" },
            { value: "tools", label: "Tools" },
            { value: "files", label: "Files" },
          ]}
        />
      </div>
      {loading && tab !== "files" && <p className="py-6 text-center text-[13px] text-mute">Loading…</p>}
      {error && tab !== "files" && <p className="rounded-2xl bg-danger-soft px-4 py-3 text-[13px] text-danger">{error}</p>}

      {data && tab === "skills" && (
        <>
          <p className="mb-3 text-[12.5px] leading-relaxed text-mute">
            Each skill is a Markdown file in <code className="rounded bg-raised-2 px-1 font-mono">skills/</code>. Edit one and bots use the new version from their next
            reply. Give skills to a bot in its Edit details.
          </p>
          {data.problems.map((p) => (
            <p key={p.id} className="mb-2 rounded-xl bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
              skills/{p.id}: {p.error}
            </p>
          ))}
          <ul className="space-y-2.5">
            {data.skills.map((s) => (
              <SkillCard key={s.id} skill={s} />
            ))}
          </ul>
        </>
      )}
      {data && tab === "tools" && <ToolsList tools={data.tools} />}
      {tab === "files" && <FilesList />}
    </Drawer>
  );
}
