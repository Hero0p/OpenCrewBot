// What the API routes call. Keeps validation and side effects in one place.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ActionGroup, ApprovalMode, ApprovalRecord, Bot, BotInput, ChatMessage, ConversationId, ConversationSummary, Room, RoomInput } from "@/lib/shared/types";
import { DATA_DIR } from "./config";
import { InputError } from "./errors";
import * as store from "./db";
import { publish } from "./bus";
import { defaultModel } from "./providers";
import { splitModelId } from "@/lib/shared/providers";
import { deleteWorkspace, writeMemory } from "./memory-files";
import { forgetConversation, resetBot, respondToApproval, runTurn, runningBots, stopConversation } from "./runtime";
import { expireAllPending, expireApproval, recordDecision } from "./approvals";
import { DEFAULT_AUTO_ACTIONS_PER_DAY } from "./permissions";
import { MORGAN_INSTRUCTIONS, MORGAN_V1_MARKER, WORKFORCE_AGENTS, WORKFORCE_ROOMS, modelForTier } from "./workforce";
import { listSkills } from "./skills";
import { createProject, listProjects, provenanceComment, provenanceTime, readMemoryFile, saveEditedFile } from "./memory-layers";
import { recoverRuns, setTaskRunner } from "./engine";
import { agentTaskRunner } from "./task-runner";
import { messagePreview } from "@/lib/shared/preview";
import { resumeRoomRounds, roomConversationId, runRoom } from "./rooms";
import { setTeammateRunner } from "./collaboration";
import { recoverWorkflowRuns, setWorkflowTurnRunner, startScheduler } from "./scheduler";

export { InputError };

// ── seeding and restart cleanup (once per process) ──────────────────────

const g = globalThis as unknown as { __opencrewbotBoot?: Promise<void> };

export function boot(): Promise<void> {
  g.__opencrewbotBoot ??= (async () => {
    await sweepInterrupted();
    await migrateModelIdsToProviderPrefix();
    await seed();
    await seedWorkforce();
    await upgradeChiefOfStaff();
    await seedSharedMemory();
    // The engine runs tasks as agent turns; then any run cut off by a restart continues.
    setTaskRunner(agentTaskRunner);
    // A teammate asked with ask_teammate answers in its own conversation, as a normal turn.
    setTeammateRunner({ run: (bot, conversationId, content) => runTurn({ bot, conversationId, content }), stop: stopConversation });
    await recoverRuns();
    // Room messages that were still being answered when the server stopped carry on.
    await resumeRoomRounds();
    // Scheduled workflows: each run is a normal turn; runs cut off by a restart are marked, then the loop starts.
    setWorkflowTurnRunner((bot, conversationId, content) => runTurn({ bot, conversationId, content }));
    await recoverWorkflowRuns();
    startScheduler();
  })();
  return g.__opencrewbotBoot;
}

const CHIEF_OF_STAFF_UPGRADED = "seed.workforce.v2";

/**
 * Once, for installs seeded before the planner existed: give the Chief of Staff (Morgan) the
 * planning tools, and replace its first-version instructions with the planning ones, but only
 * if you haven't edited them (they still contain a phrase only the first version had).
 */
async function upgradeChiefOfStaff() {
  if (await store.getSetting<boolean>(CHIEF_OF_STAFF_UPGRADED)) return;
  for (const bot of await store.listBots()) {
    if (bot.handle !== "morgan" || bot.title !== "Chief of Staff") continue;
    const instructions = bot.instructions.includes(MORGAN_V1_MARKER) ? MORGAN_INSTRUCTIONS : bot.instructions;
    await store.saveBot({ ...bot, instructions, tools: { ...bot.tools, planning: true } });
  }
  await store.setSetting(CHIEF_OF_STAFF_UPGRADED, true);
}

const MEMORY_SEEDED = "seed.memory.v1";

/**
 * Create the shared memory files once: your preferences, team decisions, and a
 * MeetUniversity project (the assignment's example business) as the active project.
 * The project starts with facts stated in the assignment brief only.
 */
async function seedSharedMemory() {
  if (await store.getSetting<boolean>(MEMORY_SEEDED)) return;
  if (!readMemoryFile({ scope: "user" })) saveEditedFile({ scope: "user" }, "# Your preferences\n\n");
  if (!readMemoryFile({ scope: "decisions" })) saveEditedFile({ scope: "decisions" }, "# Team decisions\n\n");
  if ((await listProjects()).length === 0) {
    const source = provenanceComment({ by: "setup", when: provenanceTime(), why: "stated in the assignment brief", in: "first start" });
    const facts = [
      `- Website: https://www.meetuniversity.com/ ${source}`,
      `- Product lines: Aspirations (student career discovery and navigation), Study Abroad / University Applications, and School Partnerships. ${source}`,
    ];
    await createProject("MeetUniversity", { activate: true, body: `${facts.join("\n")}\n` });
  }
  await store.setSetting(MEMORY_SEEDED, true);
}

const WORKFORCE_SEEDED = "seed.workforce.v1";

/**
 * Create the starting workforce (workforce.ts: 10 agents, 5 rooms) exactly once,
 * on new installs and on installs that existed before it. Existing bots and rooms
 * are left untouched. Guarded by a settings flag, so deleting a seeded agent later
 * doesn't bring it back.
 */
async function seedWorkforce() {
  if (await store.getSetting<boolean>(WORKFORCE_SEEDED)) return;
  const idByHandle = new Map<string, string>();
  for (const agent of WORKFORCE_AGENTS) {
    const bot = await createBot({ ...agent.bot, handle: agent.handle, model: modelForTier(agent.tier) });
    idByHandle.set(agent.handle, bot.id);
  }
  for (const room of WORKFORCE_ROOMS) {
    await createRoom({
      name: room.name,
      topic: room.topic,
      emoji: room.emoji,
      memberIds: room.members.map((handle) => idByHandle.get(handle)).filter((id): id is string => id !== undefined),
      leadId: idByHandle.get(room.lead) ?? null,
      responder: "lead",
      pinned: room.pinned,
    });
  }
  await store.setSetting(WORKFORCE_SEEDED, true);
}

const MODEL_ID_MIGRATION = "migrations.modelIdsHaveProvider";

/**
 * One-time upgrade of bots saved by the original OpenCrewBot. It only supported
 * Nebius and stored bare Nebius ids ("MiniMaxAI/MiniMax-M3"); model ids now always
 * start with the provider ("nebius/MiniMaxAI/MiniMax-M3"). A bare id can't be told
 * apart by looking at it (Nebius also hosts "google/gemma-3-27b-it"), so every bot
 * that existed before this upgrade is prefixed exactly once, guarded by a settings flag.
 */
async function migrateModelIdsToProviderPrefix() {
  if (await store.getSetting<boolean>(MODEL_ID_MIGRATION)) return;
  for (const bot of await store.listBots()) {
    await store.saveBot({ ...bot, model: `nebius/${bot.model}` });
  }
  await store.setSetting(MODEL_ID_MIGRATION, true);
}

/**
 * A turn that was streaming when the server stopped can't resume. Say so.
 * Its parked tool calls are gone too, so their approval requests expire: those actions never ran.
 */
async function sweepInterrupted() {
  await expireAllPending("server restart");
  const client = await store.db();
  const rows = await client.execute(`SELECT data FROM messages WHERE data LIKE '%"status":"streaming"%'`);
  for (const r of rows.rows) {
    const m = JSON.parse(String(r.data)) as ChatMessage;
    if (m.status !== "streaming") continue;
    m.status = "stopped";
    m.error = "Interrupted by a server restart.";
    for (const p of m.parts) if (p.kind === "tool" && (p.status === "running" || p.status === "awaiting-approval")) p.status = "denied";
    await store.saveMessage(m);
  }
}

const SEED_MARKER = join(DATA_DIR, ".seeded");

async function seed() {
  if (existsSync(SEED_MARKER)) return;
  const tools = { webSearch: true, memory: true, codeMode: false, browser: false, askUser: true, files: false, planning: false, teamwork: true };
  const model = defaultModel();
  const scout = await createBot({
    name: "Scout",
    title: "Research",
    description: "Finds things out on the web and comes back with sourced answers.",
    instructions:
      "Research before answering anything time-sensitive. Search, read the best two or three sources, then answer with the URLs you used. Say plainly when sources disagree or you couldn't verify something.",
    emoji: "🔭",
    color: "#2f7df6",
    model,
    tools: { ...tools, codeMode: true },
    approval: "ask",
    pinned: true,
  });
  const quill = await createBot({
    name: "Quill",
    title: "Writing",
    description: "Turns notes and research into clear posts, docs and emails.",
    instructions:
      "Write in plain, specific language. Match the person's voice once you know it, and keep their style preferences in memory. Offer one tight draft, not three options.",
    emoji: "✒️",
    color: "#e0663d",
    model,
    tools: { ...tools, webSearch: false },
    approval: "ask",
    pinned: false,
  });
  const atlas = await createBot({
    name: "Atlas",
    title: "Planning",
    description: "Breaks goals into steps, keeps track of decisions, and pulls in teammates.",
    instructions:
      "Turn vague goals into a short, ordered plan with owners. Keep decisions and open questions in memory. In rooms, hand research to @scout and drafting to @quill.",
    emoji: "🧭",
    color: "#1f9d6b",
    model,
    tools,
    approval: "ask",
    pinned: false,
  });
  await createRoom({
    name: "Studio",
    topic: "Content and launches",
    emoji: "🎬",
    memberIds: [atlas.id, scout.id, quill.id],
    leadId: atlas.id,
    responder: "auto",
    pinned: true,
  });
  writeFileSync(SEED_MARKER, new Date().toISOString());
}

// ── bots ────────────────────────────────────────────────────────────────

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "bot";
}

async function uniqueHandle(wanted: string, exceptId?: string): Promise<string> {
  const taken = new Set((await store.listBots()).filter((b) => b.id !== exceptId).map((b) => b.handle));
  const base = slug(wanted);
  let handle = base;
  for (let n = 2; taken.has(handle) || ["everyone", "all"].includes(handle); n++) handle = `${base}${n}`;
  return handle;
}

function validateModelId(id: string, field: string) {
  if (!splitModelId(id)) {
    throw new InputError(`${field} "${id}" must start with a supported provider: google/, groq/, openrouter/ or nebius/.`);
  }
}

const APPROVAL_MODES: readonly ApprovalMode[] = ["ask", "controlled", "full"];
const ACTION_GROUPS: readonly ActionGroup[] = ["apps", "browser"];

function validatePermissions(input: Partial<BotInput>) {
  if (input.approval !== undefined && !APPROVAL_MODES.includes(input.approval)) {
    throw new InputError(`Approval must be one of: ${APPROVAL_MODES.join(", ")}.`);
  }
  for (const group of input.preapprovedActions ?? []) {
    if (!ACTION_GROUPS.includes(group)) throw new InputError(`Unknown kind of action "${group}". Use: ${ACTION_GROUPS.join(", ")}.`);
  }
  const limit = input.autoActionsPerDay;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0 || limit > 1000)) {
    throw new InputError("The daily limit must be a whole number from 0 to 1,000.");
  }
}

function validateSkills(skills: string[] | undefined) {
  if (!skills?.length) return;
  const known = new Set(listSkills().map((s) => s.id));
  const unknown = skills.filter((id) => !known.has(id));
  if (unknown.length) throw new InputError(`Unknown skill${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. See Skills & Tools for the library.`);
}

function validateBot(input: Partial<BotInput>) {
  if (input.name !== undefined && !input.name.trim()) throw new InputError("A bot needs a name.");
  if (input.name && input.name.length > 40) throw new InputError("Keep the name under 40 characters.");
  if (input.instructions && input.instructions.length > 8000) throw new InputError("Instructions are limited to 8,000 characters.");
  if (input.outputFormat && input.outputFormat.length > 1000) throw new InputError("The output format is limited to 1,000 characters.");
  if (input.model !== undefined) validateModelId(input.model, "Model");
  for (const id of input.fallbackModels ?? []) validateModelId(id, "Fallback model");
  validatePermissions(input);
  validateSkills(input.skills);
}

export async function createBot(input: BotInput): Promise<Bot> {
  validateBot(input);
  const bot: Bot = {
    ...input,
    id: randomUUID().slice(0, 8),
    name: input.name.trim(),
    connections: input.connections ?? [],
    preapprovedActions: input.preapprovedActions ?? [],
    autoActionsPerDay: input.autoActionsPerDay ?? DEFAULT_AUTO_ACTIONS_PER_DAY,
    skills: input.skills ?? [],
    outputFormat: input.outputFormat ?? "",
    tools: { ...input.tools, files: input.tools.files ?? false, planning: input.tools.planning ?? false, teamwork: input.tools.teamwork ?? true },
    // null or absent: automatic fallbacks (see automaticFallbacks in shared/providers.ts).
    fallbackModels: input.fallbackModels ?? undefined,
    handle: await uniqueHandle(input.handle || input.name),
    createdAt: new Date().toISOString(),
  };
  await store.saveBot(bot);
  writeMemory(bot.id, `# ${bot.name}'s memory\n\n`);
  publish({ type: "bots-changed" });
  return bot;
}

export async function updateBot(id: string, patch: Partial<BotInput>): Promise<Bot> {
  const bot = await store.getBot(id);
  if (!bot) throw new InputError("That bot doesn't exist.");
  validateBot(patch);
  const next: Bot = {
    ...bot,
    ...patch,
    id: bot.id,
    createdAt: bot.createdAt,
    tools: { ...bot.tools, ...(patch.tools ?? {}) },
    // `fallbackModels: null` switches back to automatic fallbacks; leaving the field out keeps the current list.
    fallbackModels: patch.fallbackModels === null ? undefined : (patch.fallbackModels ?? bot.fallbackModels),
    handle: patch.handle !== undefined || patch.name !== undefined ? await uniqueHandle(patch.handle || patch.name || bot.handle, id) : bot.handle,
  };
  await store.saveBot(next);
  await resetBot(id);
  publish({ type: "bots-changed" });
  return next;
}

export async function deleteBot(id: string): Promise<void> {
  await stopConversation(`dm:${id}`);
  await resetBot(id);
  await store.deleteBotRow(id);
  await store.clearMessages(`dm:${id}`);
  for (const room of await store.listRooms()) {
    if (!room.memberIds.includes(id)) continue;
    const memberIds = room.memberIds.filter((m) => m !== id);
    await store.saveRoom({ ...room, memberIds, leadId: room.leadId === id ? (memberIds[0] ?? null) : room.leadId });
  }
  deleteWorkspace(id);
  publish({ type: "bots-changed" });
  publish({ type: "rooms-changed" });
}

// ── rooms ───────────────────────────────────────────────────────────────

async function cleanRoomInput<T extends Partial<RoomInput>>(input: T): Promise<T> {
  if (input.name !== undefined && !input.name.trim()) throw new InputError("A room needs a name.");
  if (input.memberIds) {
    const known = new Set((await store.listBots()).map((b) => b.id));
    input.memberIds = [...new Set(input.memberIds)].filter((id) => known.has(id));
  }
  return input;
}

export async function createRoom(input: RoomInput): Promise<Room> {
  const clean = await cleanRoomInput(input);
  const room: Room = {
    ...clean,
    id: randomUUID().slice(0, 8),
    name: clean.name.trim(),
    leadId: clean.leadId && clean.memberIds.includes(clean.leadId) ? clean.leadId : (clean.memberIds[0] ?? null),
    createdAt: new Date().toISOString(),
  };
  await store.saveRoom(room);
  publish({ type: "rooms-changed" });
  return room;
}

export async function updateRoom(id: string, patch: Partial<RoomInput>): Promise<Room> {
  const room = await store.getRoom(id);
  if (!room) throw new InputError("That room doesn't exist.");
  const clean = await cleanRoomInput(patch);
  const next: Room = { ...room, ...clean, id: room.id, createdAt: room.createdAt };
  if (!next.leadId || !next.memberIds.includes(next.leadId)) next.leadId = next.memberIds[0] ?? null;
  await store.saveRoom(next);
  publish({ type: "rooms-changed" });
  return next;
}

export async function deleteRoom(id: string): Promise<void> {
  const conversationId = roomConversationId(id);
  await stopConversation(conversationId);
  await store.deleteRoomRow(id);
  await store.clearMessages(conversationId);
  publish({ type: "rooms-changed" });
}

// ── conversations ───────────────────────────────────────────────────────

function parseConversation(conversationId: ConversationId): { kind: "dm" | "room"; id: string } {
  const [kind, id] = conversationId.split(":");
  if ((kind !== "dm" && kind !== "room") || !id) throw new InputError("Unknown conversation.");
  return { kind, id };
}

export async function sendMessage(conversationId: ConversationId, text: string): Promise<ChatMessage> {
  const content = text.trim();
  if (!content) throw new InputError("Type a message first.");
  if (content.length > 20000) throw new InputError("Messages are limited to 20,000 characters.");
  const { kind, id } = parseConversation(conversationId);

  const bot = kind === "dm" ? await store.getBot(id) : null;
  const room = kind === "room" ? await store.getRoom(id) : null;
  if (kind === "dm" && !bot) throw new InputError("That bot doesn't exist.");
  if (kind === "room" && !room) throw new InputError("That room doesn't exist.");
  if (room && room.memberIds.length === 0) throw new InputError("Add at least one bot to this room first.");

  const message: ChatMessage = {
    id: randomUUID(),
    conversationId,
    role: "user",
    createdAt: new Date().toISOString(),
    status: "done",
    parts: [{ kind: "text", text: content }],
  };
  await store.saveMessage(message);
  await store.markRead(conversationId);
  publish({ type: "message", message });

  // The reply streams over SSE; the request returns as soon as it's queued.
  if (bot) void runTurn({ bot, conversationId, content }).catch(() => {});
  if (room) void runRoom(room, message).catch(() => {});
  return message;
}

// ── approvals ───────────────────────────────────────────────────────────

/**
 * Approve or reject one waiting action, from the Approval Centre.
 * @param approvalId - the request's id
 * @returns the decided request
 * @throws InputError when it doesn't exist, was already decided, or its bot is no longer waiting
 */
export async function decideApproval(approvalId: string, approve: boolean): Promise<ApprovalRecord> {
  const record = await store.getApproval(approvalId);
  if (!record) throw new InputError("That approval request doesn't exist.");
  return decide(record, approve);
}

/**
 * Approve or reject one waiting action, from its card in the chat.
 * @throws InputError when no pending request exists for that tool call
 */
export async function decideToolCall(conversationId: ConversationId, botId: string, toolCallId: string, approve: boolean): Promise<ApprovalRecord> {
  const record = await store.findPendingApproval(conversationId, botId, toolCallId);
  if (!record) throw new InputError("That request is no longer waiting.");
  return decide(record, approve);
}

/**
 * The decision is written first, then the waiting bot is released, so the audit log shows
 * the decision before the tool's run. If the bot can't be reached, the request is marked
 * expired: Mastra never ran the action, and the log says why.
 */
async function decide(record: ApprovalRecord, approve: boolean): Promise<ApprovalRecord> {
  if (record.status !== "pending") throw new InputError(`That request was already ${record.status}.`);
  const decided = await recordDecision(record, approve ? "approved" : "rejected");
  try {
    await respondToApproval(record.conversationId, record.botId, record.toolCallId, approve);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "the waiting bot couldn't be reached";
    await expireApproval(decided, reason);
    throw new InputError(reason);
  }
  return decided;
}

export async function clearConversation(conversationId: ConversationId): Promise<void> {
  parseConversation(conversationId);
  await stopConversation(conversationId);
  await store.clearMessages(conversationId);
  await store.bumpGeneration(conversationId);
  forgetConversation(conversationId);
}

export async function summaries(): Promise<ConversationSummary[]> {
  const [bots, rooms, last, unread] = await Promise.all([store.listBots(), store.listRooms(), store.lastMessages(), store.unreadCounts()]);
  const names = new Map(bots.map((b) => [b.id, b.name]));
  const ids = [...bots.map((b) => `dm:${b.id}`), ...rooms.map((r) => roomConversationId(r.id))];
  return ids.map((id) => {
    const m = last.get(id);
    return {
      id,
      running: runningBots(id),
      unread: unread.get(id) ?? 0,
      lastMessage: m
        ? {
            text: messagePreview(m),
            createdAt: m.createdAt,
            author: m.role === "user" ? "You" : (names.get(m.botId ?? "") ?? "Bot"),
          }
        : undefined,
    };
  });
}
