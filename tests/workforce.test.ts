// The seeded workforce (10 agents, 5 rooms), the tools each agent gets, and what its prompt says.
import { describe, expect, it } from "vitest";
import { WORKFORCE_AGENTS, WORKFORCE_ROOMS } from "@/lib/server/workforce";
import { listSkills } from "@/lib/server/skills";
import { TOOL_CATALOG, buildTools, toolCategory } from "@/lib/server/tools";
import { systemPrompt } from "@/lib/server/prompt";
import { boot } from "@/lib/server/service";
import { listBots, listRooms } from "@/lib/server/db";
import type { Bot } from "@/lib/shared/types";

/** A full Bot from a workforce definition, for checks that don't need the database. */
function asBot(index: number): Bot {
  const agent = WORKFORCE_AGENTS[index];
  return {
    ...agent.bot,
    id: `test-${agent.handle}`,
    handle: agent.handle,
    model: "google/gemini-2.5-flash",
    connections: [],
    preapprovedActions: agent.bot.preapprovedActions ?? [],
    autoActionsPerDay: agent.bot.autoActionsPerDay ?? 20,
    skills: agent.bot.skills ?? [],
    outputFormat: agent.bot.outputFormat ?? "",
    fallbackModels: agent.bot.fallbackModels ?? undefined,
    createdAt: new Date().toISOString(),
  };
}

describe("workforce definitions", () => {
  it("has 10 agents with unique handles, led by a Chief of Staff", () => {
    expect(WORKFORCE_AGENTS).toHaveLength(10);
    expect(new Set(WORKFORCE_AGENTS.map((a) => a.handle)).size).toBe(10);
    expect(WORKFORCE_AGENTS[0].bot.title).toBe("Chief of Staff");
  });

  it("gives every agent a role, instructions, an output format and skills that exist", () => {
    const skillIds = new Set(listSkills().map((s) => s.id));
    for (const { handle, bot } of WORKFORCE_AGENTS) {
      expect(bot.title, handle).toBeTruthy();
      expect(bot.instructions.length, handle).toBeGreaterThan(100);
      expect(bot.outputFormat, handle).toBeTruthy();
      expect(bot.skills?.length, handle).toBeGreaterThan(0);
      for (const skill of bot.skills ?? []) expect(skillIds, `${handle} → ${skill}`).toContain(skill);
    }
  });

  it("puts every skill in the library to use", () => {
    const used = new Set(WORKFORCE_AGENTS.flatMap((a) => a.bot.skills ?? []));
    for (const skill of listSkills()) expect(used, skill.id).toContain(skill.id);
  });

  it("has 5 rooms whose lead and members are all real agents", () => {
    const handles = new Set(WORKFORCE_AGENTS.map((a) => a.handle));
    expect(WORKFORCE_ROOMS).toHaveLength(5);
    for (const room of WORKFORCE_ROOMS) {
      expect(handles, room.name).toContain(room.lead);
      expect(room.members, room.name).toContain(room.lead);
      for (const member of room.members) expect(handles, `${room.name} → ${member}`).toContain(member);
    }
  });
});

describe("tools per agent", () => {
  it("gives the file tools and load_skill to agents that have them, and code mode can call them", () => {
    const dara = asBot(WORKFORCE_AGENTS.findIndex((a) => a.handle === "dara"));
    const names = Object.keys(buildTools(dara).tools);
    expect(names).toEqual(expect.arrayContaining(["list_files", "read_spreadsheet", "make_chart", "save_report", "load_skill", "execute_typescript"]));
  });

  it("gives no file tools or load_skill to a bot without them", () => {
    const bot = { ...asBot(0), tools: { ...asBot(0).tools, files: false }, skills: [] };
    const names = Object.keys(buildTools(bot).tools);
    expect(names).not.toContain("read_spreadsheet");
    expect(names).not.toContain("load_skill");
  });

  it("lists each catalog tool under the same permission category the gate uses", () => {
    for (const tool of TOOL_CATALOG) expect(toolCategory(tool.name), tool.name).toBe(tool.category);
  });
});

describe("agent prompts", () => {
  it("lists the agent's skills and output format, but not the full procedures", () => {
    const vega = asBot(WORKFORCE_AGENTS.findIndex((a) => a.handle === "vega"));
    const prompt = systemPrompt(vega, [], []);
    expect(prompt).toContain("## Your skills");
    expect(prompt).toContain("`competitor-analysis`");
    expect(prompt).toContain("## Your output format");
    expect(prompt).not.toContain("Never invent a price"); // that line is inside the procedure, loaded on demand
  });
});

describe("seeding", () => {
  it("creates the 10 agents and 5 rooms on first start", async () => {
    await boot();
    const bots = await listBots();
    const rooms = await listRooms();
    for (const { handle } of WORKFORCE_AGENTS) expect(bots.map((b) => b.handle), handle).toContain(handle);
    for (const { name } of WORKFORCE_ROOMS) expect(rooms.map((r) => r.name), name).toContain(name);
    const morgan = bots.find((b) => b.handle === "morgan");
    expect(morgan?.skills).toEqual(["report-consolidation", "presentation-creation"]);
    const marketIntel = rooms.find((r) => r.name === "Market Intelligence");
    expect(marketIntel?.leadId).toBe(morgan?.id);
    expect(marketIntel?.memberIds).toHaveLength(5);
  });
});
