// The shared Files folder: spreadsheets people upload, reports and charts bots
// create. It lives at data/files/ with three subfolders:
//   uploads/  files you add in Skills & Tools → Files
//   reports/  Markdown reports saved by bots (save_report)
//   charts/   SVG charts made by bots (make_chart)
// Every path from a bot or a request goes through safeFilePath(), so nothing can
// read or write outside this folder.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import Papa from "papaparse";
import type { FileEntry } from "@/lib/shared/types";
import { DATA_DIR } from "./config";
import { mirrorFile } from "./data-mirror";

export const FILES_DIR = join(DATA_DIR, "files");
const SUBFOLDERS = ["uploads", "reports", "charts"] as const;
for (const folder of SUBFOLDERS) mkdirSync(join(FILES_DIR, folder), { recursive: true });

/** Largest upload accepted. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** File types people may upload. SVG and HTML are excluded on purpose: they can carry scripts. */
export const UPLOAD_EXTENSIONS = [".csv", ".md", ".txt", ".json"];
/** Most rows read_spreadsheet will return in one call. */
export const MAX_ROWS = 5000;

/** A file request that can't be served: bad path, missing file, wrong type. The message is safe to show. */
export class FileAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileAccessError";
  }
}

/**
 * Turn a path inside the Files folder into an absolute path, refusing anything that escapes it.
 * @param relativePath - e.g. "uploads/sales.csv"
 * @returns the absolute path
 * @throws FileAccessError for empty paths or paths outside the Files folder ("../", absolute paths)
 */
export function safeFilePath(relativePath: string): string {
  const cleaned = relativePath.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!cleaned) throw new FileAccessError("Give a file path, e.g. uploads/sales.csv.");
  const absolute = resolve(FILES_DIR, cleaned);
  if (!absolute.startsWith(FILES_DIR + sep)) throw new FileAccessError(`"${relativePath}" is outside the Files folder.`);
  return absolute;
}

/** A reply shorter than this that links to a saved report is "only a link". */
const LINK_ONLY_CHARS = 1_500;

/**
 * If a short reply only points at reports it saved ("You can read it here: /api/files/reports/x.md"),
 * add those reports' text, so the deliverable shown in the chat and kept in history isn't just a link
 * (seen live with Gemini 3.5 Flash-Lite as the Chief of Staff). Longer replies come back unchanged.
 * @param text - the reply
 * @returns the reply, followed by each linked report's Markdown when it was only a link
 */
export function inlineReportLinks(text: string): string {
  if (text.length > LINK_ONLY_CHARS) return text;
  const links = [...text.matchAll(/\/api\/files\/(reports\/[^\s)"']+\.md)/g)].map((m) => decodeURIComponent(m[1]));
  const reports: string[] = [];
  for (const path of [...new Set(links)]) {
    try {
      reports.push(readFileSync(safeFilePath(path), "utf8"));
    } catch {
      // A link to a report that doesn't exist (or outside Files) is left as it is.
    }
  }
  return reports.length ? `${text}\n\n---\n\n${reports.join("\n\n---\n\n")}` : text;
}

/** The URL the app serves a file at (see src/app/api/files/[...path]/route.ts). */
export function fileUrl(relativePath: string): string {
  return `/api/files/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

/** A safe file name from free text: "Q3 Sales Report!" → "q3-sales-report". */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "untitled"
  );
}

/** @returns every file in the Files folder, newest first */
export function listFiles(): FileEntry[] {
  const entries: FileEntry[] = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = join(folder, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        const stats = statSync(full);
        entries.push({ path: relative(FILES_DIR, full).split(sep).join("/"), size: stats.size, modifiedAt: stats.mtime.toISOString() });
      }
    }
  };
  walk(FILES_DIR);
  return entries.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

// ── spreadsheets ────────────────────────────────────────────────────────

export interface ColumnSummary {
  name: string;
  type: "number" | "text";
  /** Cells with no value. */
  blanks: number;
  /** Only for number columns. */
  min?: number;
  max?: number;
  sum?: number;
  mean?: number;
  /** Only for text columns: up to 10 distinct values, to show what the column holds. */
  examples?: string[];
}

export interface SpreadsheetData {
  path: string;
  rowCount: number;
  columns: ColumnSummary[];
  /** The first `maxRows` rows; each row maps column name → value. */
  rows: Record<string, string | number | null>[];
  truncated: boolean;
}

function summarizeColumn(name: string, values: unknown[]): ColumnSummary {
  const present = values.filter((v) => v !== null && v !== undefined && v !== "");
  const blanks = values.length - present.length;
  const numbers = present.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (present.length > 0 && numbers.length === present.length) {
    const sum = numbers.reduce((total, n) => total + n, 0);
    return { name, type: "number", blanks, min: Math.min(...numbers), max: Math.max(...numbers), sum, mean: sum / numbers.length };
  }
  return { name, type: "text", blanks, examples: [...new Set(present.map(String))].slice(0, 10) };
}

/**
 * Read a CSV file from the Files folder.
 * @param relativePath - e.g. "uploads/sales.csv"
 * @param maxRows - how many rows to return (column summaries always cover every row); capped at MAX_ROWS
 * @returns the column summaries and the first rows
 * @throws FileAccessError when the path is unsafe, the file is missing, or it isn't a CSV
 */
export function readSpreadsheet(relativePath: string, maxRows = 20): SpreadsheetData {
  const absolute = safeFilePath(relativePath);
  if (extname(absolute).toLowerCase() !== ".csv") throw new FileAccessError("Only .csv files can be read as spreadsheets. Export Excel sheets as CSV first.");
  let text: string;
  try {
    text = readFileSync(absolute, "utf8");
  } catch {
    throw new FileAccessError(`There is no file "${relativePath}". Use list_files to see what's there.`);
  }
  const parsed = Papa.parse<Record<string, string | number | null>>(text, { header: true, dynamicTyping: true, skipEmptyLines: true });
  const names = parsed.meta.fields ?? [];
  const limit = Math.max(1, Math.min(MAX_ROWS, Math.floor(maxRows)));
  return {
    path: relativePath,
    rowCount: parsed.data.length,
    columns: names.map((name) => summarizeColumn(name, parsed.data.map((row) => row[name]))),
    rows: parsed.data.slice(0, limit),
    truncated: parsed.data.length > limit,
  };
}

// ── saving ──────────────────────────────────────────────────────────────

/** Write a file into one of the subfolders, adding -2, -3… if the name is taken. Returns its path inside the Files folder. */
function writeNew(folder: (typeof SUBFOLDERS)[number], baseName: string, extension: string, content: string | Buffer): string {
  let name = `${baseName}${extension}`;
  for (let n = 2; statSafe(join(FILES_DIR, folder, name)); n++) name = `${baseName}-${n}${extension}`;
  writeFileSync(join(FILES_DIR, folder, name), content);
  mirrorFile(join(FILES_DIR, folder, name));
  return `${folder}/${name}`;
}

function statSafe(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    // Missing file: the name is free.
    return false;
  }
}

/**
 * Save a Markdown report.
 * @returns its path in the Files folder and the URL to open it
 */
export function saveReport(title: string, markdown: string): { path: string; url: string } {
  const path = writeNew("reports", slugify(title), ".md", markdown.startsWith("#") ? markdown : `# ${title}\n\n${markdown}`);
  return { path, url: fileUrl(path) };
}

/**
 * Save an SVG chart.
 * @returns its path in the Files folder and the URL to show it
 */
export function saveChart(title: string, svg: string): { path: string; url: string } {
  const path = writeNew("charts", slugify(title), ".svg", svg);
  return { path, url: fileUrl(path) };
}

/**
 * Save a file someone uploaded.
 * @returns its path in the Files folder
 * @throws FileAccessError for disallowed types or files over MAX_UPLOAD_BYTES
 */
export function saveUpload(fileName: string, content: Buffer): string {
  const extension = extname(fileName).toLowerCase();
  if (!UPLOAD_EXTENSIONS.includes(extension)) throw new FileAccessError(`Only ${UPLOAD_EXTENSIONS.join(", ")} files can be uploaded.`);
  if (content.byteLength > MAX_UPLOAD_BYTES) throw new FileAccessError("Files are limited to 5 MB.");
  return writeNew("uploads", slugify(fileName.slice(0, -extension.length)), extension, content);
}
