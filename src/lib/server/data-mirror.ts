// A copy of the data folder's files in the database, for hosts whose disk is wiped on every
// restart (Render's free tier). Memory files, bot workspaces, uploads, reports and charts are
// plain files the app reads synchronously; rather than rewriting all of that, the disk stays
// the working copy and the database becomes the durable one:
//   - every write is also saved to the database (mirrorFile), every delete removed (mirrorRemove);
//   - at boot, files the disk is missing are written back from the database (restoreDataFiles).
// It's on when the databases are hosted (OPENCREWBOT_DB_URL), or when OPENCREWBOT_MIRROR_FILES=true
// (for trying it locally). Locally, by default, it's off and nothing changes.
//
// Saving happens in the background (the app's file writes are synchronous). A write made in the
// last moment before the host stops can be lost; flushDataMirror() waits for pending saves.
import { mkdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { DATA_DIR, HOSTED_DB } from "./config";
import { deleteDataFiles, listDataFiles, saveDataFile } from "./db";

/** Files bigger than this aren't copied (the database is for memory and documents, not large media). */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

/** Decided in one place: on with hosted databases, or when asked for explicitly. */
export function mirrorEnabled(): boolean {
  return HOSTED_DB || process.env.OPENCREWBOT_MIRROR_FILES === "true";
}

/** "memory/user.md" for a path inside the data folder; null for anything outside it (or temp files). */
function dataPath(absolutePath: string): string | null {
  const rel = relative(DATA_DIR, resolve(absolutePath));
  if (!rel || rel.startsWith("..") || rel.includes(`..${sep}`) || rel.endsWith(".tmp")) return null;
  return rel.split(sep).join("/");
}

const g = globalThis as unknown as { __opencrewbotMirror?: { pending: Set<Promise<void>> } };
const state = (g.__opencrewbotMirror ??= { pending: new Set() });

function track(work: Promise<void>, what: string): void {
  const saved = work.catch((error) => console.error(`[opencrewbot] couldn't copy ${what} to the database:`, error));
  state.pending.add(saved);
  void saved.finally(() => state.pending.delete(saved));
}

/** Save a file the app just wrote into the database copy. Its bytes are read now, so later changes can't race it. */
export function mirrorFile(absolutePath: string): void {
  if (!mirrorEnabled()) return;
  const path = dataPath(absolutePath);
  if (!path) return;
  const size = statSync(absolutePath).size;
  if (size > MAX_FILE_BYTES) {
    console.warn(`[opencrewbot] ${path} is ${Math.round(size / 1024 / 1024)} MB, over the ${MAX_FILE_BYTES / 1024 / 1024} MB limit, so it isn't kept in the database and won't survive a restart.`);
    return;
  }
  const content = new Uint8Array(readFileSync(absolutePath));
  track(saveDataFile(path, content), path);
}

/** Remove a file or folder (e.g. a deleted bot's workspace) from the database copy. */
export function mirrorRemove(absolutePath: string): void {
  if (!mirrorEnabled()) return;
  const path = dataPath(absolutePath);
  if (path) track(deleteDataFiles(path), path);
}

/** Wait for every pending save (tests, and anything that needs the copy to be complete). */
export async function flushDataMirror(): Promise<void> {
  await Promise.all([...state.pending]);
}

/**
 * At boot: write back every file the disk doesn't have (after a restart on a wiped disk, that's all of them).
 * Files already on disk are left alone: on a disk that survived, they're the newest copy.
 * @returns how many files were restored
 */
export async function restoreDataFiles(): Promise<number> {
  if (!mirrorEnabled()) return 0;
  let restored = 0;
  for (const file of await listDataFiles()) {
    const target = join(DATA_DIR, ...file.path.split("/"));
    if (!dataPath(target) || existsSync(target)) continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
    restored++;
  }
  return restored;
}
