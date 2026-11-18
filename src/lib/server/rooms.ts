// Group rooms: decide who answers, give each bot the part of the room it
// hasn't seen, and let a bot hand off to a teammate by @mentioning them.
//
// How the bots answering one message work together is the room's mode:
//   sequential: one after another, each seeing the answers before it (the original behaviour);
//   parallel:   the first answers all start at the same time;
//   review:     after the answers, the room's fact-checker reviews them and @mentions
//               whoever made a weak claim, who then defends or revises it.
//
// Every message is answered as a "round", saved after each reply (room_rounds table), so
// after a restart the bots that hadn't answered yet still do (resumeRoomRounds). Endless
// conversations are stopped by a reply budget per message (MAX_ROOM_TURNS), a hop limit for
// hand-offs (MAX_HANDOFF_DEPTH) and a limit per pair of bots (MAX_PAIR_HANDOFFS).
import { randomUUID } from "node:crypto";
import type { Bot, ChatMessage, Room, RoomRound, RoomTurn, RouteNote } from "@/lib/shared/types";
import { getRoom, listBots, listMessages, listRunningRoomRounds, saveMessage, saveRoomRound } from "./db";
import { publish } from "./bus";
import { pickResponders } from "./jev";
import { runTurn, stopEpochOf } from "./runtime";
import { setRoomRound } from "./collaboration";

/** How many bot-to-bot @mention hops one message from the person can start. */
const MAX_HANDOFF_DEPTH = 2;
/** The most bot replies one message can lead to: answers, hand-offs and the review together. */
export const MAX_ROOM_TURNS = 8;
/** Hand-offs between the same two bots for one message (stops two bots passing work back and forth). */
export const MAX_PAIR_HANDOFFS = 2;

export function roomConversationId(roomId: string) {
  return `room:${roomId}`;
}

export function messageText(message: ChatMessage): string {
  return message.parts
    .filter((p) => p.kind === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n")
    .trim();
}

function mentionsIn(text: string, members: Bot[]): Bot[] {
  const handles = new Set([...text.matchAll(/@([a-z0-9_-]+)/gi)].map((m) => m[1].toLowerCase()));
  return members.filter((b) => handles.has(b.handle) || handles.has(b.name.toLowerCase()));
}

/**
 * Did this reply start or change a team plan? Its @mentions then only describe the plan
 * ("@leo drafts the posts"): the engine already hands those tasks out, so they aren't hand-offs.
 */
export function changedAPlan(reply: ChatMessage): boolean {
  return reply.parts.some((p) => p.kind === "tool" && (p.name === "create_plan" || p.name === "update_plan") && p.status === "done");
}

function authorName(message: ChatMessage, bots: Map<string, Bot>): string {
  if (message.role === "user") return "Person";
  return bots.get(message.botId ?? "")?.name ?? "A former member";
}

/** Everything in the room since this bot last spoke (at most the last 30 lines). */
function catchUp(history: ChatMessage[], bot: Bot, bots: Map<string, Bot>): string[] {
  let start = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].botId === bot.id && history[i].role === "bot") {
      start = i + 1;
      break;
    }
  }
  return history
    .slice(start)
    .filter((m) => m.role !== "notice" && m.status !== "streaming")
    .slice(-30)
    .map((m) => `${authorName(m, bots)}: ${messageText(m) || "(no text)"}`);
}

/** What the bot is asked to do on this turn, by how it was chosen. */
function turnInstruction(bot: Bot, route: RouteNote): string {
  switch (route.by) {
    case "handoff":
      // Seen live: a review that only credited a teammate made it reply "standing by"; this keeps such replies to one line.
      return `A teammate @mentioned you. Do the part they asked of you, as ${bot.name}. If they challenged your claim, defend it with evidence or correct it. If they didn't ask you for anything, reply in one short line and don't @mention anyone.`;
    case "review":
      // Every @mention becomes a hand-off, so the reviewer names teammates plainly and uses @ only for a challenge.
      return `You are reviewing your teammates' answers above, as ${bot.name}. For each important claim, say whether it holds. Refer to teammates by name WITHOUT the @ sign. Only when a claim is weak, unsupported or wrong, @mention the teammate who made it and say exactly what's wrong and what evidence would settle it. If everything holds, say so briefly.`;
    case "resume":
      return `The app restarted while you were answering. Answer the latest message as ${bot.name}.`;
    default:
      return `Reply to the latest message as ${bot.name}.`;
  }
}

function roomPrompt(room: Room, bot: Bot, members: Bot[], lines: string[], route: RouteNote): string {
  const roster = members
    .map((b) => `- ${b.name} (@${b.handle})${b.title ? `, ${b.title}` : ""}${b.id === bot.id ? " (you)" : ""}`)
    .join("\n");
  return [
    `[Group room "${room.name}"${room.topic ? `, topic: ${room.topic}` : ""}]`,
    `Members:\n${roster}`,
    `New in the room since your last message:\n${lines.join("\n") || "(nothing new)"}`,
    "---",
    turnInstruction(bot, route),
    "Add only your part; don't repeat what teammates already said. To hand something to a teammate, @mention their handle.",
  ].join("\n\n");
}

async function decideResponders(room: Room, members: Bot[], text: string, history: ChatMessage[], bots: Map<string, Bot>) {
  const lead = members.find((b) => b.id === room.leadId) ?? members[0];
  if (/@(everyone|all)\b/i.test(text) || room.responder === "everyone") {
    return { bots: members, route: { by: "everyone" } as RouteNote };
  }
  const mentioned = mentionsIn(text, members);
  // A message that @mentions a planner (Chief of Staff) goes to the planner alone: it assigns the
  // teammates named in the message as plan tasks, so they don't also answer in the room and do the work twice.
  const planners = mentioned.filter((b) => b.tools.planning);
  if (planners.length) return { bots: planners, route: { by: "mention" } as RouteNote };
  if (mentioned.length) return { bots: mentioned, route: { by: "mention" } as RouteNote };
  if (room.responder === "auto") {
    const lines = history.slice(-9, -1).map((m) => `${authorName(m, bots)}: ${messageText(m).slice(0, 300)}`);
    const pick = await pickResponders(room, members, lines, text);
    if (pick) {
      return {
        bots: members.filter((b) => pick.botIds.includes(b.id)),
        route: { by: "jev", confidence: pick.confidence } as RouteNote,
      };
    }
  }
  return { bots: lead ? [lead] : [], route: { by: "lead" } as RouteNote };
}

// ── the budget and loop rules (pure, so they're easy to test) ───────────

const pairKey = (a: string, b: string) => [a, b].sort().join("|");

/**
 * Queue the teammates a reply @mentioned, within the hop limit, the pair limit and without duplicates.
 * Mutates `round` (queue and pair counts).
 * @returns the names of teammates who were NOT queued because the pair limit was reached
 */
export function queueHandoffs(round: RoomRound, from: RoomTurn, reply: ChatMessage | null, members: Bot[]): string[] {
  if (!reply || reply.status !== "done" || from.depth >= MAX_HANDOFF_DEPTH || changedAPlan(reply)) return [];
  const skipped: string[] = [];
  for (const next of mentionsIn(messageText(reply), members)) {
    if (next.id === from.botId || round.queue.some((q) => q.botId === next.id)) continue;
    const key = pairKey(from.botId, next.id);
    if ((round.pairs[key] ?? 0) >= MAX_PAIR_HANDOFFS) {
      skipped.push(next.name);
      continue;
    }
    round.pairs[key] = (round.pairs[key] ?? 0) + 1;
    round.queue.push({ botId: next.id, route: { by: "handoff" }, depth: from.depth + 1 });
  }
  return skipped;
}

/** Review mode: once the answers are in, queue the room's fact-checker once. */
export function queueReview(round: RoomRound, room: Room, members: Bot[]): void {
  if ((room.mode ?? "sequential") !== "review" || round.reviewed || round.queue.length) return;
  round.reviewed = true;
  const reviewer = members.find((b) => b.skills.includes("fact-check"));
  if (reviewer) round.queue.push({ botId: reviewer.id, route: { by: "review" }, depth: 1 });
}

/** The turns to run next: in parallel mode the first answers start together; everything else runs one at a time. */
export function nextBatch(round: RoomRound, room: Room): RoomTurn[] {
  const turnsLeft = MAX_ROOM_TURNS - round.turns;
  if ((room.mode ?? "sequential") === "parallel" && round.turns === 0) return round.queue.splice(0, turnsLeft);
  return round.queue.splice(0, 1);
}

// ── running a round ─────────────────────────────────────────────────────

async function notice(conversationId: string, text: string): Promise<void> {
  const message: ChatMessage = { id: randomUUID(), conversationId, role: "notice", createdAt: new Date().toISOString(), status: "done", parts: [{ kind: "text", text }] };
  await saveMessage(message);
  publish({ type: "message", message });
}

/** Run the round's queue until it's empty, the budget is used up, or Stop is pressed. Saves after every step. */
async function continueRound(room: Room, round: RoomRound): Promise<void> {
  const allBots = await listBots();
  const bots = new Map(allBots.map((b) => [b.id, b]));
  const members = room.memberIds.map((id) => bots.get(id)).filter((b): b is Bot => Boolean(b));
  const conversationId = roomConversationId(room.id);
  const epoch = stopEpochOf(conversationId);
  setRoomRound(conversationId, round.id);

  while (round.queue.length && stopEpochOf(conversationId) === epoch) {
    if (round.turns >= MAX_ROOM_TURNS) {
      round.queue = [];
      await notice(conversationId, `■ Stopped after ${MAX_ROOM_TURNS} replies to one message: the limit that keeps room conversations from running on. Send another message to continue.`);
      break;
    }
    const batch = nextBatch(round, room).filter((turn) => bots.has(turn.botId));
    round.current = batch;
    await saveRoomRound(round);
    const replies = await Promise.all(
      batch.map(async (turn) => {
        const bot = bots.get(turn.botId)!;
        const transcript = await listMessages(conversationId, 60);
        return runTurn({ bot, conversationId, content: roomPrompt(room, bot, members, catchUp(transcript, bot, bots), turn.route), route: turn.route });
      }),
    );
    round.turns += batch.length;
    round.current = [];
    for (const [i, reply] of replies.entries()) {
      const skipped = queueHandoffs(round, batch[i], reply, members);
      if (skipped.length) await notice(conversationId, `■ Not handed to ${skipped.join(", ")}: they've already passed this back and forth ${MAX_PAIR_HANDOFFS} times.`);
    }
    queueReview(round, room, members);
    await saveRoomRound(round);
  }
  round.status = "done";
  round.queue = [];
  await saveRoomRound(round);
}

/** Handle the person's new room message: route it, then run each responder (by the room's mode). */
export async function runRoom(room: Room, userMessage: ChatMessage): Promise<void> {
  const allBots = await listBots();
  const bots = new Map(allBots.map((b) => [b.id, b]));
  const members = room.memberIds.map((id) => bots.get(id)).filter((b): b is Bot => Boolean(b));
  if (!members.length) return;

  const history = await listMessages(roomConversationId(room.id), 60);
  const { bots: responders, route } = await decideResponders(room, members, messageText(userMessage), history, bots);
  const round: RoomRound = {
    id: userMessage.id,
    roomId: room.id,
    status: "running",
    queue: responders.map((bot) => ({ botId: bot.id, route, depth: 0 })),
    current: [],
    turns: 0,
    pairs: {},
    reviewed: false,
    createdAt: new Date().toISOString(),
  };
  await saveRoomRound(round);
  await continueRound(room, round);
}

/**
 * After a restart: finish the room messages that were still being answered. The bot whose
 * reply was cut off answers again (its cut-off reply is marked "Interrupted by a server restart").
 * @returns how many rounds were resumed
 */
export async function resumeRoomRounds(): Promise<number> {
  const rounds = await listRunningRoomRounds();
  for (const round of rounds) {
    const room = await getRoom(round.roomId);
    if (!room) {
      await saveRoomRound({ ...round, status: "done", queue: [], current: [] });
      continue;
    }
    round.queue = [...round.current.map((turn) => ({ ...turn, route: { by: "resume" } as RouteNote })), ...round.queue];
    round.current = [];
    const names = (await listBots()).filter((b) => round.queue.some((t) => t.botId === b.id)).map((b) => b.name);
    if (names.length) await notice(roomConversationId(room.id), `↻ Picking up after a restart: ${names.join(", ")} still to answer.`);
    void continueRound(room, round).catch((error) => console.error("[opencrewbot] resuming a room failed:", error));
  }
  return rounds.length;
}
