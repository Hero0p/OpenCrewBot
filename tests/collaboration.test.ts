// Module C: agents asking each other (ask_teammate, share_finding) with loop limits, and rooms
// that answer in sequence, in parallel or with a review, within a reply budget, resuming after a restart.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_DEPTH, MAX_PER_PAIR, MAX_PER_WORK, askTeammate, checkExchange, resetCollaboration, setTeammateRunner, shareFinding, type Exchange, type Origin } from "@/lib/server/collaboration";
import { MAX_PAIR_HANDOFFS, MAX_ROOM_TURNS, nextBatch, queueHandoffs, queueReview, resumeRoomRounds } from "@/lib/server/rooms";
import { boot, createRoom, sendMessage } from "@/lib/server/service";
import { listBots, listMessages, saveRoomRound } from "@/lib/server/db";
import type { Bot, ChatMessage, Room, RoomRound } from "@/lib/shared/types";

let team: Bot[];
const bot = (handle: string) => team.find((b) => b.handle === handle)!;

beforeAll(async () => {
  await boot();
  team = await listBots();
});

const reply = (botId: string, text: string, conversationId = "room:x"): ChatMessage => ({
  id: crypto.randomUUID(),
  conversationId,
  role: "bot",
  botId,
  createdAt: new Date().toISOString(),
  status: "done",
  parts: [{ kind: "text", text }],
  usage: { input: 100, output: 50, costUsd: 0 },
});

// ── the loop guards ─────────────────────────────────────────────────────

describe("checkExchange: what stops loops", () => {
  const origin = (chain: string[], work = "run:1"): Origin => ({ work, visibleIn: "dm:x", runId: work.startsWith("run:") ? work.slice(4) : undefined, chain });
  const ex = (fromId: string, toId: string, extra: Partial<Exchange> = {}): Exchange => ({
    id: crypto.randomUUID(), work: "run:1", visibleIn: "dm:x", runId: "1", chain: [fromId, toId], fromId, toId, kind: "question", message: "a question", at: Date.now(), status: "answered", tokens: 0, ...extra,
  });
  const ask = (fromId: string, toId: string, o: Origin, message = "a new question") => ({ fromId, toId, toHandle: toId, kind: "question" as const, message, origin: o });

  it("lets a normal request through", () => {
    expect(checkExchange(ask("a", "b", origin(["a"])), [], Date.now())).toBeNull();
  });

  it("refuses asking yourself, and asking back anyone waiting on you (A → B → A)", () => {
    expect(checkExchange(ask("a", "a", origin(["a"])), [], Date.now())).toMatch(/yourself/);
    expect(checkExchange(ask("b", "a", origin(["a", "b"])), [], Date.now())).toMatch(/already waiting for your answer/);
  });

  it(`stops chains longer than ${MAX_DEPTH}`, () => {
    expect(checkExchange(ask("c", "d", origin(["a", "b", "c"])), [], Date.now())).toMatch(/teammates deep/);
  });

  it(`allows ${MAX_PER_PAIR} exchanges per pair and ${MAX_PER_WORK} per piece of work`, () => {
    const pair = Array.from({ length: MAX_PER_PAIR }, () => ex("a", "b"));
    expect(checkExchange(ask("a", "b", origin(["a"])), pair, Date.now())).toMatch(/back and forth/);
    const busy = Array.from({ length: MAX_PER_WORK }, (_, i) => ex(`x${i}`, `y${i}`));
    expect(checkExchange(ask("a", "b", origin(["a"])), busy, Date.now())).toMatch(/all 12 teammate requests/);
  });

  it("refuses the same question twice, and counts direct chats per hour", () => {
    expect(checkExchange(ask("a", "b", origin(["a"]), "A Question"), [ex("a", "b", { message: "a   question" })], Date.now())).toMatch(/exactly this/);
    const old = Array.from({ length: MAX_PER_WORK }, () => ex("a", "z", { work: "dm:x", runId: undefined, at: Date.now() - 2 * 3_600_000 }));
    expect(checkExchange(ask("a", "b", origin(["a"], "dm:x")), old, Date.now())).toBeNull();
  });

  it("stops when the work's token budget is used up", () => {
    expect(checkExchange(ask("a", "b", origin(["a"])), [ex("c", "d", { tokens: 10_000_000 })], Date.now())).toMatch(/token budget/);
  });
});

// ── asking for real (with a fake teammate turn) ─────────────────────────

describe("askTeammate", () => {
  beforeEach(() => resetCollaboration());

  it("runs the teammate's turn, returns the answer and posts the exchange where the work is visible", async () => {
    const asker = bot("vega");
    const quinn = bot("quinn");
    const prompts: string[] = [];
    setTeammateRunner({
      run: async (target, conversationId, prompt) => {
        prompts.push(prompt);
        return reply(target.id, "Confirmed: India sent ~95,000 students (HESA 2024/25).", conversationId);
      },
      stop: async () => {},
    });
    const result = await askTeammate(asker, `dm:${asker.id}`, { teammate: "@quinn", kind: "verify", message: "Is it true that India sent the most new students to the UK in 2024/25?" });
    expect(result).toMatchObject({ answered: true, from: "Quinn" });
    expect(prompts[0]).toContain("asks you to verify");
    const chat = await listMessages(`dm:${asker.id}`);
    expect(chat.some((m) => m.role === "notice" && JSON.stringify(m.parts).includes("asked for verification from Quinn"))).toBe(true);
    expect(chat.some((m) => m.role === "notice" && JSON.stringify(m.parts).includes("Quinn answered Vega"))).toBe(true);
    expect(quinn.id).toBeTruthy();
  });

  it("stops a forced loop: a teammate who always asks back is refused, and the refusal is shown", async () => {
    const vega = bot("vega");
    setTeammateRunner({
      // Quinn tries to ask Vega back from inside her answer: the guard refuses, Quinn answers anyway.
      run: async (target, conversationId) => {
        const back = await askTeammate(target, conversationId, { teammate: "vega", kind: "question", message: "Can you check this again for me?" });
        expect(back.answered).toBe(false);
        return reply(target.id, `I couldn't ask back (${back.answered ? "" : back.reason}). My answer: confirmed.`, conversationId);
      },
      stop: async () => {},
    });
    const result = await askTeammate(vega, `dm:${vega.id}`, { teammate: "quinn", kind: "verify", message: "Please verify the 95,000 figure for 2024/25." });
    expect(result.answered).toBe(true);
    const chat = await listMessages(`dm:${vega.id}`);
    expect(chat.some((m) => JSON.stringify(m.parts).includes("not asked") && JSON.stringify(m.parts).includes("already waiting for your answer"))).toBe(true);
  });

  it("answers an unknown teammate with the team list, and finds the fact-checker for an unnamed verification", async () => {
    setTeammateRunner({ run: async (target, c) => reply(target.id, "ok", c), stop: async () => {} });
    const unknown = await askTeammate(bot("leo"), "dm:x", { teammate: "nobody", kind: "question", message: "What do you think about this?" });
    expect(unknown).toMatchObject({ answered: false });
    const toQa = await askTeammate(bot("leo"), "dm:y", { teammate: "the checker", kind: "verify", message: "Check that the January intake exists at most UK universities." });
    expect(toQa).toMatchObject({ answered: true, from: "Quinn" });
  });

  it("shares a finding in the conversation where the work happens", async () => {
    const result = await shareFinding(bot("iris"), "dm:share", "UK study visas for Indians fell 12% in 2025.", ["https://example.org"]);
    expect(result.shared).toBe(true);
    const chat = await listMessages("dm:share");
    expect(JSON.stringify(chat.at(-1)?.parts)).toContain("Shared finding");
  });
});

// ── rooms: modes, budgets, resume ───────────────────────────────────────

describe("room rules", () => {
  const room = (mode: Room["mode"]): Room => ({ id: "r", name: "R", topic: "", emoji: "", memberIds: [], leadId: null, responder: "lead", mode, pinned: false, createdAt: "" });
  const round = (queue: RoomRound["queue"]): RoomRound => ({ id: "m", roomId: "r", status: "running", queue, current: [], turns: 0, pairs: {}, reviewed: false, createdAt: "" });

  it("starts the first answers together in parallel mode, one at a time otherwise", () => {
    const turns = [{ botId: "a", route: { by: "everyone" as const }, depth: 0 }, { botId: "b", route: { by: "everyone" as const }, depth: 0 }];
    expect(nextBatch(round([...turns]), room("parallel"))).toHaveLength(2);
    expect(nextBatch(round([...turns]), room("sequential"))).toHaveLength(1);
  });

  it(`hands off at most ${MAX_PAIR_HANDOFFS} times between the same two bots`, () => {
    const leo = bot("leo");
    const maya = bot("maya");
    const r = round([]);
    const from = { botId: leo.id, route: { by: "mention" as const }, depth: 0 };
    for (let i = 0; i < MAX_PAIR_HANDOFFS; i++) {
      expect(queueHandoffs(r, from, reply(leo.id, "@maya over to you"), [leo, maya])).toEqual([]);
      r.queue = [];
    }
    expect(queueHandoffs(r, from, reply(leo.id, "@maya over to you"), [leo, maya])).toEqual(["Maya"]);
  });

  it("queues the fact-checker once in review mode", () => {
    const r = round([]);
    queueReview(r, room("review"), [bot("leo"), bot("quinn")]);
    expect(r.queue).toMatchObject([{ botId: bot("quinn").id, route: { by: "review" } }]);
    queueReview(r, room("review"), [bot("leo"), bot("quinn")]);
    expect(r.queue).toHaveLength(1);
  });

  it("answers in parallel with the mock model, and resumes a round cut off by a restart", async () => {
    const members = [bot("leo"), bot("maya"), bot("iris")];
    const created = await createRoom({ name: "Parallel test", topic: "", emoji: "", memberIds: members.map((b) => b.id), leadId: members[0].id, responder: "everyone", mode: "parallel", pinned: false });
    await sendMessage(`room:${created.id}`, "Each of you: one idea for a parents' webinar.");
    const answered = async (n: number) => {
      for (let i = 0; i < 200; i++) {
        const done = (await listMessages(`room:${created.id}`)).filter((m) => m.role === "bot" && m.status === "done");
        if (done.length >= n) return done;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("the room didn't answer");
    };
    expect(new Set((await answered(3)).map((m) => m.botId)).size).toBe(3);

    // A round saved as "still answering" (what a restart leaves behind) is finished on resume.
    await saveRoomRound({ id: crypto.randomUUID(), roomId: created.id, status: "running", queue: [{ botId: members[2].id, route: { by: "everyone" }, depth: 0 }], current: [{ botId: members[1].id, route: { by: "everyone" }, depth: 0 }], turns: 1, pairs: {}, reviewed: false, createdAt: new Date().toISOString() });
    expect(await resumeRoomRounds()).toBeGreaterThan(0);
    const after = await answered(5);
    expect(after.at(-1)?.route?.by).toBeDefined();
    const chat = await listMessages(`room:${created.id}`);
    expect(chat.some((m) => m.role === "notice" && JSON.stringify(m.parts).includes("Picking up after a restart"))).toBe(true);
    expect(chat.some((m) => m.route?.by === "resume")).toBe(true);
  }, 60_000);

  it(`stops a room after ${MAX_ROOM_TURNS} replies to one message, and says why`, async () => {
    // No planner: its mock plan would post a deliverable of its own, which isn't a room reply.
    const members = team.filter((b) => !b.tools.planning).slice(0, MAX_ROOM_TURNS + 2);
    const created = await createRoom({ name: "Budget test", topic: "", emoji: "", memberIds: members.map((b) => b.id), leadId: members[0].id, responder: "everyone", mode: "sequential", pinned: false });
    await sendMessage(`room:${created.id}`, "Everyone, introduce yourselves.");
    let chat: ChatMessage[] = [];
    for (let i = 0; i < 400; i++) {
      chat = await listMessages(`room:${created.id}`);
      if (chat.some((m) => m.role === "notice" && JSON.stringify(m.parts).includes(`Stopped after ${MAX_ROOM_TURNS} replies`))) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(chat.filter((m) => m.role === "bot").length).toBe(MAX_ROOM_TURNS);
    expect(chat.some((m) => m.role === "notice" && JSON.stringify(m.parts).includes("limit that keeps room conversations from running on"))).toBe(true);
  }, 90_000);
});
