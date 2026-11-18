import { body, handle } from "@/lib/server/http";
import { publish } from "@/lib/server/bus";
import { InputError } from "@/lib/server/service";
import { MemoryKeyError, createProject, setActiveProject } from "@/lib/server/memory-layers";

/** Create a project memory file: `{ name, activate }`. */
export async function POST(request: Request) {
  return handle(async () => {
    const { name, activate } = await body<{ name: string; activate?: boolean }>(request);
    if (typeof name !== "string" || !name.trim()) throw new InputError("Give the project a name.");
    const slug = await createProject(name, { activate: activate !== false });
    publish({ type: "memory-files-changed", key: `project:${slug}` });
    return { slug };
  });
}

/** Choose the active project, whose memory every bot sees: `{ slug }` (null for none). */
export async function PUT(request: Request) {
  return handle(async () => {
    const { slug } = await body<{ slug: string | null }>(request);
    try {
      await setActiveProject(slug);
    } catch (error) {
      if (error instanceof MemoryKeyError) throw new InputError(error.message);
      throw error;
    }
    publish({ type: "memory-files-changed", key: slug ? `project:${slug}` : "project" });
  });
}
