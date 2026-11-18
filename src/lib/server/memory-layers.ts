// The memory layers: which Markdown file each kind of memory lives in, how a
// remembered line records its provenance (what, when, why, where), and what
// goes into each bot's prompt.
//
//   agent      data/workspaces/<botId>/MEMORY.md   one bot's own notes (the original)
//   user       data/memory/user.md                  your preferences, every bot sees them
//   project    data/memory/projects/<slug>.md       the active project's facts, every bot sees them
//   decisions  data/memory/decisions.md             important decisions, every bot sees the latest
//   room       data/memory/rooms/<roomId>.md        shared by a room's members, in that room
//   history    data/memory/history/<runId>.md       what one team run did (written by the engine)
//
// All of them are plain files: edit them in the Memory Manager or any editor and
// the next reply uses the new text, because prompts read them on every turn.
//
// A remembered line looks like this in the file (the comment is the provenance):
//   - Prefers reports as short bullet points <!-- by: Iris | when: 2026-11-18 10:42 UTC | why: the person said so | in: chat with Iris -->
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { MemoryEntry, MemoryFileInfo, MemoryKeyInput, MemoryScope, ProjectInfo, Provenance } from "@/lib/shared/types";
import { DATA_DIR } from "./config";
import { appendLine, memoryPath, promptSlice, readTextFile, replaceOnce, stripComments, writeTextFile } from "./memory-files";
import { getSetting, setSetting } from "./db";
import { conversationContext } from "./conversation-context";

export const MEMORY_DIR = join(DATA_DIR, "memory");
for (const folder of ["projects", "rooms", "history"]) mkdirSync(join(MEMORY_DIR, folder), { recursive: true });

/** How much of each shared layer goes into a prompt. Decisions take the newest lines; the others the first. */
const SHARED_PROMPT_LIMIT = { lines: 120, bytes: 8 * 1024 };
const ACTIVE_PROJECT_SETTING = "memory.activeProject";
const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

/** A memory key that can't be used: unknown scope, bad id. The message is safe to show. */
export class MemoryKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryKeyError";
  }
}

// ── keys and files ──────────────────────────────────────────────────────

/** Scopes whose key has an id after the colon. */
const SCOPES_WITH_ID: readonly MemoryScope[] = ["agent", "project", "room", "history"];

/**
 * @param key - "user", "decisions", or "<scope>:<id>" for agent / project / room / history
 * @returns the parsed key
 * @throws MemoryKeyError for unknown scopes or unsafe ids
 */
export function parseMemoryKey(key: string): MemoryKeyInput {
  const [scope, id, ...rest] = key.split(":");
  if (scope === "user" || scope === "decisions") {
    if (id !== undefined) throw new MemoryKeyError(`"${scope}" has no id.`);
    return { scope };
  }
  if (!SCOPES_WITH_ID.includes(scope as MemoryScope)) throw new MemoryKeyError(`Unknown memory "${key}". Use user, decisions, agent:<id>, project:<slug>, room:<id> or history:<id>.`);
  if (!id || rest.length || !SAFE_ID.test(id)) throw new MemoryKeyError(`"${key}" needs a simple id after the colon.`);
  return { scope: scope as Exclude<MemoryScope, "user" | "decisions">, id };
}

/** The key as text, e.g. "project:meetuniversity". */
export function memoryKeyText(key: MemoryKeyInput): string {
  return key.scope === "user" || key.scope === "decisions" ? key.scope : `${key.scope}:${key.id}`;
}

/** The file a memory layer lives in. */
export function memoryFilePath(key: MemoryKeyInput): string {
  switch (key.scope) {
    case "agent":
      return memoryPath(key.id);
    case "user":
      return join(MEMORY_DIR, "user.md");
    case "decisions":
      return join(MEMORY_DIR, "decisions.md");
    case "project":
      return join(MEMORY_DIR, "projects", `${key.id}.md`);
    case "room":
      return join(MEMORY_DIR, "rooms", `${key.id}.md`);
    case "history":
      return join(MEMORY_DIR, "history", `${key.id}.md`);
  }
}

/**
 * Where the file is, for showing in the app: relative to the data folder, e.g. "memory/user.md".
 * Never the absolute path, which would reveal the server's folders (and your user name) in the browser.
 */
export function memoryFileDisplayPath(key: MemoryKeyInput): string {
  return relative(DATA_DIR, memoryFilePath(key)).split(sep).join("/");
}

/** @returns the file's text ("" when it doesn't exist yet) */
export function readMemoryFile(key: MemoryKeyInput): string {
  return readTextFile(memoryFilePath(key));
}

// ── provenance ──────────────────────────────────────────────────────────

/** Values can't contain the comment's own separators. */
function clean(value: string): string {
  return value.replace(/-->/g, "→").replace(/\|/g, "/").replace(/\s+/g, " ").trim();
}

/** "2026-11-18 10:42 UTC" */
export function provenanceTime(date = new Date()): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** The HTML comment that records where a line came from. */
export function provenanceComment(p: Provenance): string {
  return `<!-- by: ${clean(p.by)} | when: ${clean(p.when)} | why: ${clean(p.why)} | in: ${clean(p.in)} -->`;
}

/**
 * Split one memory line into its text and provenance.
 * @returns the text without the comment, and the provenance when the line has a well-formed one
 */
export function parseEntry(line: string): MemoryEntry {
  const comment = line.match(/<!--\s*(.*?)\s*-->/);
  const text = stripComments(line).replace(/^\s*[-*]\s+/, "").trim();
  if (!comment) return { text };
  const fields = Object.fromEntries(
    comment[1].split("|").map((part) => {
      const colon = part.indexOf(":");
      return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()];
    }),
  );
  if (!fields.by || !fields.when) return { text };
  return { text, provenance: { by: fields.by, when: fields.when, why: fields.why ?? "", in: fields.in ?? "" } };
}

/** The bullet lines of a memory file, with their provenance. */
export function memoryEntries(key: MemoryKeyInput): MemoryEntry[] {
  return readMemoryFile(key)
    .split(/\r?\n/)
    .filter((line) => /^\s*[-*]\s+\S/.test(line))
    .map(parseEntry);
}

// ── writing ─────────────────────────────────────────────────────────────

/**
 * Remember one fact in a layer, with its provenance.
 * @param title - the file's heading, used only when the file doesn't exist yet
 * @returns the new file content
 */
export function remember(key: MemoryKeyInput, note: string, provenance: Provenance, options: { title: string; section?: string }): string {
  const path = memoryFilePath(key);
  if (!existsSync(path)) writeTextFile(path, `# ${options.title}\n\n`);
  const line = `- ${note.trim().replace(/\n+/g, " ")} ${provenanceComment(provenance)}`;
  return appendLine(path, line, options.section);
}

/**
 * Correct a remembered line: replace text that appears exactly once, and stamp the
 * changed line with new provenance (replacing the old comment on that line).
 */
export function correct(key: MemoryKeyInput, find: string, replace: string, provenance: Provenance): { ok: boolean; reason?: string } {
  const path = memoryFilePath(key);
  const result = replaceOnce(path, find, replace);
  if (!result.ok || !replace.trim() || !result.content) return result;
  const lines = result.content.split("\n");
  const index = lines.findIndex((line) => line.includes(replace));
  if (index >= 0) {
    lines[index] = `${stripComments(lines[index]).trimEnd()} ${provenanceComment(provenance)}`;
    writeTextFile(path, lines.join("\n"));
  }
  return { ok: true };
}

/**
 * Save a whole file edited by the person (Memory Manager or the bot's Memory tab).
 * New bullet lines without provenance get stamped "by you", so every line keeps a record of where it came from.
 * @returns what was written
 */
export function saveEditedFile(key: MemoryKeyInput, content: string): string {
  const before = new Set(readMemoryFile(key).split(/\r?\n/).map((l) => l.trim()));
  const stamp = provenanceComment({ by: "you", when: provenanceTime(), why: "edited by hand", in: "Memory Manager" });
  const lines = content.split(/\r?\n/).map((line) => {
    const isNewBullet = /^\s*[-*]\s+\S/.test(line) && !before.has(line.trim()) && !line.includes("<!--");
    return isNewBullet ? `${line.trimEnd()} ${stamp}` : line;
  });
  return writeTextFile(memoryFilePath(key), lines.join("\n"));
}

// ── projects ────────────────────────────────────────────────────────────

/** "MeetUniversity Growth" → "meetuniversity-growth" */
export function projectSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "project"
  );
}

/** The project name is the file's first "# " heading. */
function projectName(slug: string): string {
  const heading = readMemoryFile({ scope: "project", id: slug }).match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : slug;
}

export async function activeProjectSlug(): Promise<string | null> {
  const slug = await getSetting<string | null>(ACTIVE_PROJECT_SETTING);
  return slug && existsSync(memoryFilePath({ scope: "project", id: slug })) ? slug : null;
}

export async function setActiveProject(slug: string | null): Promise<void> {
  if (slug !== null && !existsSync(memoryFilePath({ scope: "project", id: slug }))) throw new MemoryKeyError(`There is no project "${slug}".`);
  await setSetting(ACTIVE_PROJECT_SETTING, slug);
}

export async function listProjects(): Promise<ProjectInfo[]> {
  const active = await activeProjectSlug();
  return readdirSync(join(MEMORY_DIR, "projects"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3))
    .filter((slug) => SAFE_ID.test(slug))
    .map((slug) => ({ slug, name: projectName(slug), active: slug === active }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Create a project's memory file (if it doesn't exist) and optionally make it the active one.
 * @returns the project's slug
 */
export async function createProject(name: string, options: { activate: boolean; body?: string }): Promise<string> {
  const slug = projectSlug(name);
  const path = memoryFilePath({ scope: "project", id: slug });
  if (!existsSync(path)) writeTextFile(path, `# ${name.trim()}\n\n${options.body ?? ""}`);
  if (options.activate) await setActiveProject(slug);
  return slug;
}

// ── listing (Memory Manager) ────────────────────────────────────────────

function fileInfo(key: MemoryKeyInput, title: string): MemoryFileInfo {
  const path = memoryFilePath(key);
  const exists = existsSync(path);
  return {
    key: memoryKeyText(key),
    scope: key.scope,
    title,
    path: memoryFileDisplayPath(key),
    exists,
    entries: exists ? memoryEntries(key).length : 0,
    modifiedAt: exists ? statSync(path).mtime.toISOString() : undefined,
  };
}

/**
 * Every memory file, in the order the Memory Manager shows them.
 * @param names - display names for bots, rooms and runs (from the database)
 */
export async function listMemoryFiles(names: { bots: { id: string; name: string }[]; rooms: { id: string; name: string }[]; runs: { id: string; title: string }[] }): Promise<MemoryFileInfo[]> {
  const files: MemoryFileInfo[] = [fileInfo({ scope: "user" }, "Your preferences"), fileInfo({ scope: "decisions" }, "Team decisions")];
  for (const project of await listProjects()) files.push(fileInfo({ scope: "project", id: project.slug }, project.active ? `${project.name} (active project)` : project.name));
  for (const room of names.rooms) files.push(fileInfo({ scope: "room", id: room.id }, room.name));
  for (const bot of names.bots) files.push(fileInfo({ scope: "agent", id: bot.id }, bot.name));
  for (const run of names.runs) {
    const info = fileInfo({ scope: "history", id: run.id }, run.title);
    if (info.exists) files.push(info);
  }
  return files;
}

// ── where a bot's memory_add / memory_edit writes ───────────────────────

/** The scopes a bot can choose in memory_add / memory_edit. "mine" is its own MEMORY.md. */
export const BOT_MEMORY_SCOPES = ["mine", "user", "project", "decisions", "room"] as const;
export type BotMemoryScope = (typeof BOT_MEMORY_SCOPES)[number];

export interface MemoryTarget {
  key: MemoryKeyInput;
  /** The file's heading (used when the file is new) and how the bot is told where it saved. */
  title: string;
  /** Where the turn happened, for provenance. */
  label: string;
}

/**
 * Turn a bot's chosen scope into the file to write.
 * @param bot - the bot writing
 * @param conversationId - the conversation of the turn
 * @throws Error the bot can act on, when the scope doesn't apply here (no room, no active project)
 */
export async function resolveMemoryTarget(bot: { id: string; name: string }, scope: BotMemoryScope, conversationId: string | undefined): Promise<MemoryTarget> {
  const context = await conversationContext(conversationId);
  switch (scope) {
    case "mine":
      return { key: { scope: "agent", id: bot.id }, title: `${bot.name}'s memory`, label: context.label };
    case "user":
      return { key: { scope: "user" }, title: "Your preferences", label: context.label };
    case "decisions":
      return { key: { scope: "decisions" }, title: "Team decisions", label: context.label };
    case "project": {
      const slug = await activeProjectSlug();
      if (!slug) throw new Error('There is no active project. Use scope "mine" or "user", or ask the person to pick a project in the Memory Manager.');
      return { key: { scope: "project", id: slug }, title: projectName(slug), label: context.label };
    }
    case "room":
      if (!context.room) throw new Error('You are not working in a room right now, so there is no room memory. Use another scope.');
      return { key: { scope: "room", id: context.room.id }, title: `Room ${context.room.name}`, label: context.label };
  }
}

// ── what goes into a prompt ─────────────────────────────────────────────

/** The shared memory a bot sees in one conversation, ready for the prompt. */
export interface SharedMemory {
  user: string;
  project?: { name: string; text: string };
  decisions: string;
  room?: { name: string; text: string };
}

/**
 * Read the shared layers for one turn.
 * @param room - the room this conversation belongs to, if any (a room chat, or a task of a run started in a room)
 */
export async function sharedMemoryFor(room?: { id: string; name: string }): Promise<SharedMemory> {
  const project = await activeProjectSlug();
  const memory: SharedMemory = {
    user: promptSlice(readMemoryFile({ scope: "user" }), SHARED_PROMPT_LIMIT).text,
    decisions: promptSlice(readMemoryFile({ scope: "decisions" }), SHARED_PROMPT_LIMIT, "end").text,
  };
  if (project) memory.project = { name: projectName(project), text: promptSlice(readMemoryFile({ scope: "project", id: project }), SHARED_PROMPT_LIMIT).text };
  if (room) memory.room = { name: room.name, text: promptSlice(readMemoryFile({ scope: "room", id: room.id }), SHARED_PROMPT_LIMIT).text };
  return memory;
}
