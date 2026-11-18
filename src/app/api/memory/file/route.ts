import { connection } from "next/server";
import { body, handle } from "@/lib/server/http";
import { publish } from "@/lib/server/bus";
import { InputError } from "@/lib/server/service";
import { MemoryKeyError, memoryEntries, memoryFileDisplayPath, memoryKeyText, parseMemoryKey, readMemoryFile, saveEditedFile } from "@/lib/server/memory-layers";

function keyFrom(text: string | null) {
  try {
    return parseMemoryKey(text ?? "");
  } catch (error) {
    throw new InputError(error instanceof MemoryKeyError ? error.message : "Bad memory key.");
  }
}

/** One memory file: `?key=user`, `?key=project:meetuniversity`, `?key=agent:<botId>`… */
export async function GET(request: Request) {
  await connection();
  return handle(async () => {
    const key = keyFrom(new URL(request.url).searchParams.get("key"));
    return { key: memoryKeyText(key), path: memoryFileDisplayPath(key), content: readMemoryFile(key), entries: memoryEntries(key) };
  });
}

/** Save a memory file edited by hand: `{ key, content }`. New lines are stamped "by you". */
export async function PUT(request: Request) {
  return handle(async () => {
    const { key: keyText, content } = await body<{ key: string; content: string }>(request);
    if (typeof content !== "string") throw new InputError("Expected { key, content }.");
    const key = keyFrom(keyText);
    if (key.scope === "history") throw new InputError("Run history is written by the engine and can't be edited here.");
    const saved = saveEditedFile(key, content);
    if (key.scope === "agent") publish({ type: "memory-changed", botId: key.id });
    publish({ type: "memory-files-changed", key: memoryKeyText(key) });
    return { content: saved };
  });
}
