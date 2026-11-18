import { connection } from "next/server";
import { handle } from "@/lib/server/http";
import { listBots, listRooms, listRuns } from "@/lib/server/db";
import { listMemoryFiles, listProjects } from "@/lib/server/memory-layers";

/** Every memory file (all layers) and the projects, for the Memory Manager. */
export async function GET() {
  await connection();
  return handle(async () => {
    const [bots, rooms, runs] = await Promise.all([listBots(), listRooms(), listRuns(100)]);
    return { files: await listMemoryFiles({ bots, rooms, runs }), projects: await listProjects() };
  });
}
