// Plain Markdown memory files. Every memory layer (memory-layers.ts) is one of
// these files: you can open and edit them in any editor, and bots read them at
// the start of every turn. This file holds the low-level helpers (read, atomic
// write with secret redaction, append under a heading, replace text, the slice
// that goes into a prompt) plus the original per-bot MEMORY.md API.
//
// Each bot's own memory is data/workspaces/<botId>/MEMORY.md, as in the original app.
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { mirrorFile, mirrorRemove } from "./data-mirror";
import { dirname, join } from "node:path";
import { WORKSPACES_DIR } from "./config";

/** How much of a bot's MEMORY.md goes into the prompt. The file itself can be longer. */
export const MEMORY_PROMPT_LIMIT = { lines: 200, bytes: 16 * 1024 };

const SECRET_PATTERNS: RegExp[] = [
  /\b(sk|pk|rk|tvly|ak|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{12,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*\S+/gi,
];

/** Bots sometimes "helpfully" remember a key they saw. They don't get to keep it. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (m) => `«redacted ${m.length} chars»`);
  }
  return out;
}

/** Provenance notes are HTML comments (`<!-- by: … -->`); they stay in the file but not in prompts. */
export function stripComments(text: string): string {
  return text.replace(/[ \t]*<!--[\s\S]*?-->/g, "");
}

// ── generic file helpers (used by every memory layer) ───────────────────

/** @returns the file's text, or "" when it doesn't exist yet */
export function readTextFile(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/**
 * Write a memory file atomically (write a temp file, then rename), with secrets redacted.
 * @returns what was actually written
 */
export function writeTextFile(path: string, content: string): string {
  mkdirSync(dirname(path), { recursive: true });
  const clean = redactSecrets(content);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, clean, { mode: 0o600 });
  renameSync(tmp, path);
  mirrorFile(path);
  return clean;
}

/**
 * Add one line to a file, under `## section` when given (the heading is created if missing).
 * @returns the new file content
 */
export function appendLine(path: string, line: string, section?: string): string {
  let content = readTextFile(path).trimEnd();
  if (section) {
    const heading = `## ${section.trim()}`;
    const lines = content.split("\n");
    const idx = lines.findIndex((l) => l.trim().toLowerCase() === heading.toLowerCase());
    if (idx >= 0) {
      let end = idx + 1;
      while (end < lines.length && !lines[end].startsWith("## ")) end++;
      while (end > idx + 1 && lines[end - 1].trim() === "") end--;
      lines.splice(end, 0, line);
      content = lines.join("\n");
    } else {
      content = `${content}${content ? "\n\n" : ""}${heading}\n${line}`;
    }
  } else {
    const afterHeading = /(^|\n)#[^\n]*$/.test(content);
    content = `${content}${content ? (afterHeading ? "\n\n" : "\n") : ""}${line}`;
  }
  return writeTextFile(path, `${content}\n`);
}

/** Replace text that must appear exactly once. */
export function replaceOnce(path: string, find: string, replace: string): { ok: boolean; reason?: string; content?: string } {
  const content = readTextFile(path);
  const count = find ? content.split(find).length - 1 : 0;
  if (count === 0) return { ok: false, reason: "That exact text isn't in the memory file. Read it again and copy the text exactly." };
  if (count > 1) return { ok: false, reason: `That text appears ${count} times. Include more surrounding words so it matches once.` };
  return { ok: true, content: writeTextFile(path, content.replace(find, replace)) };
}

/**
 * The part of a memory file that goes into a prompt: provenance comments removed,
 * cut to a size limit from the start (or from the end, for logs where recent lines matter most).
 */
export function promptSlice(text: string, limit: { lines: number; bytes: number }, from: "start" | "end" = "start"): { text: string; truncated: boolean } {
  const full = stripComments(text).trim();
  const allLines = full.split("\n");
  let lines = from === "start" ? allLines.slice(0, limit.lines) : allLines.slice(-limit.lines);
  let sliced = lines.join("\n");
  while (Buffer.byteLength(sliced) > limit.bytes && lines.length > 1) {
    lines = from === "start" ? lines.slice(0, -1) : lines.slice(1);
    sliced = lines.join("\n");
  }
  return { text: sliced.trim(), truncated: sliced.trim().length < full.length };
}

// ── each bot's own MEMORY.md (the original API) ─────────────────────────

export function workspaceDir(botId: string): string {
  const dir = join(WORKSPACES_DIR, botId.replace(/[^a-zA-Z0-9_-]/g, ""));
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function memoryPath(botId: string): string {
  return join(workspaceDir(botId), "MEMORY.md");
}

export function readMemory(botId: string): string {
  return readTextFile(memoryPath(botId));
}

export function writeMemory(botId: string, content: string): string {
  return writeTextFile(memoryPath(botId), content);
}

export function deleteWorkspace(botId: string): void {
  const dir = workspaceDir(botId);
  rmSync(dir, { recursive: true, force: true });
  mirrorRemove(dir);
}

/** The slice of a bot's MEMORY.md that loads into the prompt, and whether it was cut. */
export function memoryForPrompt(botId: string): { text: string; truncated: boolean } {
  return promptSlice(readMemory(botId), MEMORY_PROMPT_LIMIT);
}
