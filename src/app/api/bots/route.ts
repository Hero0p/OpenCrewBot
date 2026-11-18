import type { BotInput } from "@/lib/shared/types";
import { body, handle } from "@/lib/server/http";
import { createBot } from "@/lib/server/service";
import { publish } from "@/lib/server/bus";
import { writeStartingMemory } from "@/lib/server/agent-factory";

/** Create a bot. `memoryNotes` (optional, from the Agent Factory) become its starting MEMORY.md lines. */
export async function POST(request: Request) {
  return handle(async () => {
    const { memoryNotes, ...input } = await body<BotInput & { memoryNotes?: string[] }>(request);
    const bot = await createBot(input);
    const notes = Array.isArray(memoryNotes) ? memoryNotes.map(String).filter(Boolean).slice(0, 10) : [];
    if (notes.length) {
      writeStartingMemory(bot.id, notes, "you");
      publish({ type: "memory-changed", botId: bot.id });
    }
    return { bot };
  });
}
