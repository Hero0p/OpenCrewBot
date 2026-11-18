// The memory layers: provenance, scopes, hand edits, and what reaches a prompt (Demo 6 in miniature).
import { describe, expect, it } from "vitest";
import {
  MemoryKeyError,
  correct,
  createProject,
  memoryEntries,
  memoryFileDisplayPath,
  parseEntry,
  parseMemoryKey,
  provenanceComment,
  readMemoryFile,
  remember,
  resolveMemoryTarget,
  saveEditedFile,
  setActiveProject,
  sharedMemoryFor,
} from "@/lib/server/memory-layers";
import { systemPrompt } from "@/lib/server/prompt";
import { createBot, createRoom } from "@/lib/server/service";
import type { Bot, Provenance } from "@/lib/shared/types";

const by = (who: string): Provenance => ({ by: who, when: "2026-11-18 10:42 UTC", why: "the person said so", in: "chat with Iris" });

describe("provenance", () => {
  it("round-trips through the comment at the end of a line", () => {
    const line = `- Prefers short bullet reports ${provenanceComment(by("Iris"))}`;
    expect(parseEntry(line)).toEqual({ text: "Prefers short bullet reports", provenance: by("Iris") });
  });

  it("reads older lines without provenance", () => {
    expect(parseEntry("- my name is hero0p _(2026-11-17)_")).toEqual({ text: "my name is hero0p _(2026-11-17)_" });
  });

  it("can't be broken by values that contain the separators", () => {
    const tricky = { ...by("Iris"), why: "a | b --> c" };
    expect(parseEntry(`- x ${provenanceComment(tricky)}`).provenance?.why).toBe("a / b → c");
  });
});

describe("memory keys", () => {
  it("parses every layer", () => {
    expect(parseMemoryKey("user")).toEqual({ scope: "user" });
    expect(parseMemoryKey("project:meetuniversity")).toEqual({ scope: "project", id: "meetuniversity" });
  });

  it("refuses unknown scopes and unsafe ids", () => {
    expect(() => parseMemoryKey("secrets")).toThrow(MemoryKeyError);
    expect(() => parseMemoryKey("room:../../etc")).toThrow(MemoryKeyError);
  });
});

describe("writing memory", () => {
  it("remembers with provenance, and corrects with new provenance", () => {
    const key = { scope: "decisions" as const };
    remember(key, "Use INR for all prices", by("Morgan"), { title: "Team decisions" });
    expect(readMemoryFile(key)).toMatch(/^# Team decisions/);
    expect(correct(key, "Use INR", "Use INR and USD", by("Felix")).ok).toBe(true);
    const entry = memoryEntries(key).find((e) => e.text.startsWith("Use INR and USD"));
    expect(entry?.provenance?.by).toBe("Felix");
  });

  it("stamps only the new lines of a hand edit as 'by you'", () => {
    const key = { scope: "user" as const };
    saveEditedFile(key, "# Your preferences\n\n- Old line\n");
    saveEditedFile(key, "# Your preferences\n\n- Old line\n- New line\n");
    const entries = memoryEntries(key);
    expect(entries.find((e) => e.text === "Old line")?.provenance?.by).toBe("you"); // stamped when first added
    expect(entries.find((e) => e.text === "New line")?.provenance).toMatchObject({ by: "you", why: "edited by hand" });
  });
});

describe("where a bot's memory goes", () => {
  const bot = { id: "b1", name: "Iris" };

  it("needs a room for room memory and an active project for project memory", async () => {
    await setActiveProject(null);
    await expect(resolveMemoryTarget(bot, "room", "dm:b1")).rejects.toThrow(/not working in a room/);
    await expect(resolveMemoryTarget(bot, "project", "dm:b1")).rejects.toThrow(/no active project/);
    await createProject("Acme Launch", { activate: true });
    expect((await resolveMemoryTarget(bot, "project", "dm:b1")).key).toEqual({ scope: "project", id: "acme-launch" });
  });

  it("finds the room of a room conversation", async () => {
    const member = await createBot({
      name: "Member",
      title: "",
      description: "",
      instructions: "",
      emoji: "",
      color: "#fff",
      model: "google/gemini-2.5-flash",
      tools: { webSearch: false, memory: true, codeMode: false, browser: false, askUser: false, files: false, planning: false, teamwork: false },
      approval: "ask",
      pinned: false,
    });
    const room = await createRoom({ name: "Launch Room", topic: "", emoji: "", memberIds: [member.id], leadId: member.id, responder: "lead", pinned: false });
    const target = await resolveMemoryTarget(bot, "room", `room:${room.id}`);
    expect(target).toMatchObject({ key: { scope: "room", id: room.id }, label: "room Launch Room" });
  });
});

describe("Demo 6 in miniature: a taught preference reaches the next prompt, and a hand edit replaces it", () => {
  const bot: Bot = {
    id: "demo6",
    name: "Iris",
    handle: "iris",
    title: "Research Analyst",
    description: "",
    instructions: "",
    emoji: "",
    color: "#3b82f6",
    model: "google/gemini-2.5-flash",
    tools: { webSearch: false, memory: true, codeMode: false, browser: false, askUser: false, files: false, planning: false, teamwork: false },
    skills: [],
    outputFormat: "",
    connections: [],
    approval: "ask",
    preapprovedActions: [],
    autoActionsPerDay: 20,
    pinned: false,
    createdAt: new Date().toISOString(),
  };

  it("works end to end through the files", async () => {
    const key = { scope: "user" as const };
    saveEditedFile(key, "# Your preferences\n\n");
    remember(key, "Prefers reports in Hindi", by("Iris"), { title: "Your preferences" });
    let prompt = systemPrompt(bot, [], [], { shared: await sharedMemoryFor() });
    expect(prompt).toContain("Prefers reports in Hindi");
    expect(prompt).not.toContain("<!--"); // provenance stays in the file, not the prompt

    // The person corrects the file by hand (Memory Manager). The very next prompt follows the file.
    saveEditedFile(key, readMemoryFile(key).replace("Prefers reports in Hindi", "Prefers reports in English"));
    prompt = systemPrompt(bot, [], [], { shared: await sharedMemoryFor() });
    expect(prompt).toContain("Prefers reports in English");
    expect(prompt).not.toContain("Hindi");
  });
});

describe("what the app shows of a memory file's location", () => {
  it("is the path inside the data folder, never the server's absolute path", () => {
    expect(memoryFileDisplayPath({ scope: "user" })).toBe("memory/user.md");
    expect(memoryFileDisplayPath({ scope: "agent", id: "abc123" })).toBe("workspaces/abc123/MEMORY.md");
  });
});
