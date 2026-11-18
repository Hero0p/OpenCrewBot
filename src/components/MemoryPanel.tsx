"use client";

// The Memory Manager: every memory layer as a plain file you can read and edit.
// Each line shows its provenance (who remembered it, when, why, where). Bots read
// these files on every turn, so a saved edit applies to their next reply.
import clsx from "clsx";
import { ArrowLeft, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { timeLabel } from "@/lib/client/format";
import type { MemoryEntry, MemoryFileInfo, MemoryScope, ProjectInfo } from "@/lib/shared/types";
import { useApp } from "./OpenCrewBotApp";
import { Button, Drawer, inputClass } from "./ui";

/** The groups, in order, with a line explaining who sees each kind of memory. */
const GROUPS: { title: string; scopes: MemoryScope[]; who: string }[] = [
  { title: "Shared with every bot", scopes: ["user", "decisions"], who: "Every bot reads these on every turn." },
  { title: "Projects", scopes: ["project"], who: "Every bot reads the active project's memory." },
  { title: "Rooms", scopes: ["room"], who: "Members read a room's memory while working in that room." },
  { title: "Agents", scopes: ["agent"], who: "Each bot's own notes." },
  { title: "Run history", scopes: ["history"], who: "What each team run did. Written by the engine." },
];

function EntryList({ entries }: { entries: MemoryEntry[] }) {
  if (entries.length === 0) return <p className="py-4 text-center text-[13px] text-mute">Nothing remembered yet.</p>;
  return (
    <ul className="divide-y divide-line rounded-2xl bg-raised">
      {entries.map((e, i) => (
        <li key={i} className="px-4 py-2.5">
          <p className="text-[13.5px] leading-relaxed">{e.text}</p>
          <p className="mt-0.5 text-[11.5px] leading-snug text-faint">
            {e.provenance ? `by ${e.provenance.by} · ${e.provenance.when} · why: ${e.provenance.why} · in ${e.provenance.in}` : "no provenance (older line)"}
          </p>
        </li>
      ))}
    </ul>
  );
}

function FileView({ file, onBack }: { file: MemoryFileInfo; onBack: () => void }) {
  const { state, toast } = useApp();
  const [data, setData] = useState<{ path: string; content: string; entries: MemoryEntry[] } | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .memoryFile(file.key)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && toast(e instanceof Error ? e.message : "Couldn't load the file."));
    return () => {
      cancelled = true;
    };
  }, [file.key, state.memoryFilesVersion, toast]);

  const save = async () => {
    setSaving(true);
    try {
      await api.saveMemoryFile(file.key, draft);
      setEditing(false);
      toast("Saved. Bots use it from their next reply.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1 text-[13px] text-mute hover:text-ink">
        <ArrowLeft size={14} /> All memory
      </button>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[15px] font-medium">{file.title}</h3>
          <p className="font-mono text-[11px] break-all text-faint">data folder / {data?.path ?? file.path}</p>
        </div>
        {!editing && file.scope !== "history" && data && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setDraft(data.content);
              setEditing(true);
            }}
          >
            <Pencil size={13} /> Edit
          </Button>
        )}
      </div>
      {!data && <p className="py-6 text-center text-[13px] text-mute">Loading…</p>}
      {data && !editing && <EntryList entries={data.entries} />}
      {data && editing && (
        <>
          <p className="mb-2 text-[12px] leading-snug text-faint">
            Plain Markdown. Keep the <code className="font-mono">{"<!-- … -->"}</code> notes: they record where each line came from. New lines you add are stamped &quot;by you&quot;.
          </p>
          <textarea className={clsx(inputClass, "min-h-72 font-mono text-[12.5px] leading-relaxed")} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={saving} onClick={save}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function ProjectPicker({ projects }: { projects: ProjectInfo[] }) {
  const { toast } = useApp();
  const [name, setName] = useState("");
  const active = projects.find((p) => p.active);

  const choose = async (slug: string) => {
    try {
      await api.setActiveProject(slug || null);
      toast(slug ? "Active project changed. Every bot uses its memory from the next reply." : "No active project.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't change the project.");
    }
  };
  const create = async () => {
    try {
      await api.createProject(name);
      setName("");
      toast("Project created and made active.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't create the project.");
    }
  };

  return (
    <div className="mb-5 rounded-2xl bg-raised p-4">
      <label className="block text-[12.5px] font-medium text-mute">
        Active project
        <select className={clsx(inputClass, "mt-1.5")} value={active?.slug ?? ""} onChange={(e) => choose(e.target.value)}>
          <option value="">None</option>
          {projects.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <div className="mt-3 flex gap-2">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="New project, e.g. a new client" />
        <Button size="sm" variant="secondary" disabled={!name.trim()} onClick={create}>
          Create
        </Button>
      </div>
    </div>
  );
}

export function MemoryPanel({ onClose }: { onClose: () => void }) {
  const { state, toast } = useApp();
  const [data, setData] = useState<{ files: MemoryFileInfo[]; projects: ProjectInfo[] } | null>(null);
  const [open, setOpen] = useState<MemoryFileInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .memoryFiles()
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && toast(e instanceof Error ? e.message : "Couldn't load memory."));
    return () => {
      cancelled = true;
    };
  }, [state.memoryFilesVersion, state.bots.length, state.rooms.length, toast]);

  return (
    <Drawer title="Memory" onClose={onClose}>
      {open ? (
        <FileView file={open} onBack={() => setOpen(null)} />
      ) : (
        <>
          <p className="mb-4 text-[13px] leading-relaxed text-mute">
            Everything the team remembers, as plain Markdown files. Each line records who remembered it, when and why. Edit any file and bots follow the new
            version from their next reply.
          </p>
          {data && <ProjectPicker projects={data.projects} />}
          {!data && <p className="py-6 text-center text-[13px] text-mute">Loading…</p>}
          {data &&
            GROUPS.map((group) => {
              const files = data.files.filter((f) => group.scopes.includes(f.scope));
              if (files.length === 0) return null;
              return (
                <section key={group.title} className="mb-5">
                  <h3 className="text-[12.5px] font-medium text-mute">{group.title}</h3>
                  <p className="mb-1.5 text-[12px] text-faint">{group.who}</p>
                  <ul className="divide-y divide-line rounded-2xl bg-raised">
                    {files.map((f) => (
                      <li key={f.key}>
                        <button type="button" onClick={() => setOpen(f)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-hover">
                          <span className="min-w-0 truncate text-[13.5px]">{f.title}</span>
                          <span className="shrink-0 text-[12px] text-faint">
                            {f.entries} {f.entries === 1 ? "line" : "lines"}
                            {f.modifiedAt ? ` · ${timeLabel(f.modifiedAt)}` : ""}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
        </>
      )}
    </Drawer>
  );
}
