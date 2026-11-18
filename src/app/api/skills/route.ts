import { connection } from "next/server";
import { handle } from "@/lib/server/http";
import { skillLibrary } from "@/lib/server/skills";
import { TOOL_CATALOG } from "@/lib/server/tools";

/** The skills library (without procedures), skills that couldn't be read, and the built-in tool catalog. */
export async function GET() {
  await connection();
  return handle(async () => {
    const { skills, problems } = skillLibrary();
    return {
      skills: skills.map((s) => ({ id: s.id, name: s.name, description: s.description, whenToUse: s.whenToUse, tools: s.tools, output: s.output })),
      problems,
      tools: TOOL_CATALOG,
    };
  });
}
