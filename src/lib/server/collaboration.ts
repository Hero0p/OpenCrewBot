// How agents work with each other (Module C): one asks another a question, hands over a
// piece of work, asks for a claim to be verified, or challenges a conclusion (ask_teammate),
// and anyone can share an intermediate result with the rest of the team (share_finding).
//
// An ask runs one turn of the teammate in its own conversation ("collab:<id>") and returns
// the teammate's answer to the asker as the tool result. Every exchange is also posted
// where the work is visible (the room, or the chat a plan was started in), and recorded
// on the plan's "What happened" list.
//
// Loops are stopped in code, before a teammate is ever asked (checkExchange):
//   - a chain of asks is at most MAX_DEPTH agents long (A asks B asks C, and C can't ask on);
//   - nobody asks an agent who is already waiting on them in the chain (no A → B → A);
//   - the same question to the same teammate is asked once;
//   - two agents get at most MAX_PER_PAIR exchanges on one piece of work;
//   - one piece of work gets at most MAX_PER_WORK exchanges and a token budget.
// "One piece of work" is a plan (all its tasks), or one room message, or a direct chat
// within the last hour.
//
// How a teammate's turn actually runs is injected with setTeammateRunner() (wired in
// service.ts boot), the same way the engine's task runner is, so tests can use a fake.
import { randomUUID } from "node:crypto";
import { createTool } from "@mastra/core/tools";
import type { ToolsInput } from "@mastra/core/agent";
import { z } from "zod";
import type { Bot, ChatMessage, CollabKind, ConversationId } from "@/lib/shared/types";
import { getBot, getRun, getTask, listBots, saveMessage } from "./db";
import { publish } from "./bus";
import { noteOnRun } from "./engine";
import { conversationIdOf } from "./request-context";

/** How long one chain of asks may be: the first asker plus two more agents. */
export const MAX_DEPTH = 3;
/** Exchanges allowed between the same two agents on one piece of work. */
export const MAX_PER_PAIR = 3;
/** Exchanges allowed on one piece of work, across the whole team. */
export const MAX_PER_WORK = 12;
/** Tokens the teammates' answers may use on one piece of work. Configurable, because it depends on your models and quotas. */
export const TOKEN_BUDGET = Math.max(1_000, Number(process.env.OPENCREWBOT_COLLAB_TOKEN_BUDGET) || 200_000);
/** How long a teammate gets to answer before the ask is stopped. */
const ANSWER_TIMEOUT_MS = 5 * 60_000;
/** For direct chats, which have no natural end: exchanges in this window count as one piece of work. */
const CHAT_WINDOW_MS = 60 * 60_000;
/** The most of an answer handed back to the asker. */
const MAX_ANSWER_CHARS = 6_000;

// ── records and state ───────────────────────────────────────────────────

export interface Exchange {
  id: string;
  /** The piece of work this belongs to: "run:<id>", "<room conversation>#<round>", or a chat id. */
  work: string;
  /** Where the work is visible: the room, or the chat a plan was started in. Exchanges are posted there. */
  visibleIn: ConversationId;
  runId?: string;
  /** Bot ids from the first asker down to the teammate asked here. */
  chain: string[];
  fromId: string;
  toId: string;
  kind: CollabKind;
  message: string;
  at: number;
  status: "waiting" | "answered" | "failed";
  tokens: number;
}

/** Where an ask comes from: the piece of work, where it's visible, and the chain of agents so far. */
export interface Origin {
  work: string;
  visibleIn: ConversationId;
  runId?: string;
  /** Bot ids of the agents already waiting in this chain, ending with the one asking now. */
  chain: string[];
}

export interface TeammateRunner {
  /** Run one turn of `bot` in `conversationId` with `prompt`; resolve with its reply (null if it never started). */
  run(bot: Bot, conversationId: ConversationId, prompt: string): Promise<ChatMessage | null>;
  /** Stop that turn (used when the teammate takes too long). */
  stop(conversationId: ConversationId): Promise<void>;
}

interface CollabState {
  runner: TeammateRunner | null;
  exchanges: Map<string, Exchange>;
  /** Room conversation id → the id of the room message being answered right now (set by rooms.ts). */
  roomRounds: Map<ConversationId, string>;
}

const g = globalThis as unknown as { __opencrewbotCollab?: CollabState };
const state: CollabState = (g.__opencrewbotCollab ??= { runner: null, exchanges: new Map(), roomRounds: new Map() });

/** Wire how a teammate's turn runs. Called once at boot (service.ts) and by tests. */
export function setTeammateRunner(runner: TeammateRunner): void {
  state.runner = runner;
}

/** rooms.ts: the room is now answering this message, so exchanges in the room count toward it. */
export function setRoomRound(roomConversationId: ConversationId, messageId: string): void {
  state.roomRounds.set(roomConversationId, messageId);
}

/** For tests: forget every exchange. */
export function resetCollaboration(): void {
  state.exchanges.clear();
  state.roomRounds.clear();
}

/** The exchange a "collab:<id>" conversation belongs to (for its label and room memory). */
export function exchangeOf(exchangeId: string): Exchange | undefined {
  return state.exchanges.get(exchangeId);
}

export function collabConversationId(exchangeId: string): ConversationId {
  return `collab:${exchangeId}`;
}

// ── where an ask comes from ─────────────────────────────────────────────

/**
 * Work out which piece of work a conversation belongs to.
 * @param conversationId - where the asking agent is working right now
 * @param botId - the asking agent
 */
export async function originOf(conversationId: ConversationId, botId: string): Promise<Origin> {
  const [kind, id] = conversationId.split(":");
  if (kind === "collab") {
    // Asked by a teammate: inherit that exchange's work and chain.
    const parent = state.exchanges.get(id);
    if (parent) return { work: parent.work, visibleIn: parent.visibleIn, runId: parent.runId, chain: parent.chain };
  }
  if (kind === "task") {
    const task = await getTask(id);
    const run = task ? await getRun(task.runId) : null;
    if (run) return { work: `run:${run.id}`, visibleIn: run.conversationId, runId: run.id, chain: [botId] };
  }
  if (kind === "room") {
    return { work: `${conversationId}#${state.roomRounds.get(conversationId) ?? "chat"}`, visibleIn: conversationId, chain: [botId] };
  }
  return { work: conversationId, visibleIn: conversationId, chain: [botId] };
}

// ── the loop guards (pure, so they're easy to test) ─────────────────────

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Decide whether an ask may go ahead.
 * @param request - who asks whom, what kind, what, and where it comes from
 * @param history - earlier exchanges (any work; filtered here)
 * @param now - the current time, in ms
 * @returns the reason it's refused, in words the asking model can act on, or null when it may go ahead
 */
export function checkExchange(
  request: { fromId: string; toId: string; toHandle: string; kind: CollabKind; message: string; origin: Origin },
  history: Exchange[],
  now: number,
): string | null {
  const { fromId, toId, toHandle, origin } = request;
  if (toId === fromId) return "You can't ask yourself. Do this part yourself.";
  if (origin.chain.includes(toId)) {
    return `@${toHandle} is already waiting for your answer in this chain of requests. Answer them with what you have instead of asking back; this is what stops loops.`;
  }
  if (origin.chain.length >= MAX_DEPTH) {
    return `This request is already ${origin.chain.length} teammates deep, the most allowed. Finish it yourself and say what you couldn't check.`;
  }
  const sameWork = history.filter((e) => e.work === origin.work && (origin.runId || now - e.at < CHAT_WINDOW_MS));
  if (sameWork.length >= MAX_PER_WORK) {
    return `The team has used all ${MAX_PER_WORK} teammate requests for this piece of work. Finish with what you have.`;
  }
  const pair = sameWork.filter((e) => (e.fromId === fromId && e.toId === toId) || (e.fromId === toId && e.toId === fromId));
  if (pair.length >= MAX_PER_PAIR) {
    return `You and @${toHandle} have already gone back and forth ${MAX_PER_PAIR} times on this work. Decide with what you have, or ask the person.`;
  }
  const repeat = sameWork.find((e) => e.fromId === fromId && e.toId === toId && e.kind === request.kind && normalize(e.message) === normalize(request.message));
  if (repeat) return `You already asked @${toHandle} exactly this. Use their earlier answer instead of asking again.`;
  const tokens = sameWork.reduce((sum, e) => sum + e.tokens, 0);
  if (tokens >= TOKEN_BUDGET) {
    return `The token budget for teammate requests on this work (${TOKEN_BUDGET.toLocaleString("en-US")}) is used up. Finish with what you have.`;
  }
  return null;
}

// ── asking a teammate ───────────────────────────────────────────────────

const KIND_WORDS: Record<CollabKind, { asked: string; brief: string }> = {
  question: { asked: "asked", brief: "has a question for you. Answer it from your expertise, briefly and with sources where it matters." },
  delegate: { asked: "handed a piece of work to", brief: "has handed you a piece of work. Do it and reply with the complete result." },
  verify: {
    asked: "asked for verification from",
    brief: "asks you to verify something. Check each claim (search or read sources if you can) and give a verdict per claim: confirmed, corrected (with the right value) or unsupported, with sources.",
  },
  challenge: {
    asked: "challenged",
    brief: "challenges your conclusion. Either defend it with evidence or revise it. Say plainly which you're doing and why.",
  },
};

/** The prompt the teammate receives. */
function teammatePrompt(asker: Bot, kind: CollabKind, message: string, depth: number): string {
  const canAskOn = depth < MAX_DEPTH;
  return [
    `[Teammate request: ${asker.name} (@${asker.handle}) ${KIND_WORDS[kind].brief}]`,
    message,
    "---",
    "Reply with your answer only: it goes straight back to them.",
    canAskOn
      ? "If you really need someone else, you may use ask_teammate once, but never ask back anyone who is waiting on you."
      : "Don't ask anyone else: this request is already as deep as requests may go.",
  ].join("\n\n");
}

function textOf(message: ChatMessage): string {
  return message.parts
    .filter((p): p is Extract<typeof p, { kind: "text" }> => p.kind === "text")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** Post a short line where the work is visible, and on the plan's history when there is one. */
async function announce(origin: Origin, text: string): Promise<void> {
  const message: ChatMessage = { id: randomUUID(), conversationId: origin.visibleIn, role: "notice", createdAt: new Date().toISOString(), status: "done", parts: [{ kind: "text", text }] };
  await saveMessage(message);
  publish({ type: "message", message });
  if (origin.runId) await noteOnRun(origin.runId, text);
}

/** Find the teammate: by @handle or name; for verification without a usable name, the team's fact-checker. */
async function findTeammate(name: string, kind: CollabKind): Promise<Bot | null> {
  const bots = await listBots();
  const wanted = name.replace(/^@/, "").trim().toLowerCase();
  const byName = bots.find((b) => b.handle === wanted || b.name.toLowerCase() === wanted);
  if (byName) return byName;
  if (kind === "verify") return bots.find((b) => b.skills.includes("fact-check")) ?? null;
  return null;
}

export type AskResult = { answered: true; from: string; answer: string } | { answered: false; reason: string };

/**
 * Ask a teammate and wait for the answer.
 * @param asker - the agent asking
 * @param conversationId - where the asker is working
 * @param input - teammate (@handle), what kind of request, and the message
 * @returns the answer, or why the ask didn't happen (the asking model is told and adapts)
 */
export async function askTeammate(asker: Bot, conversationId: ConversationId, input: { teammate: string; kind: CollabKind; message: string }): Promise<AskResult> {
  const runner = state.runner;
  if (!runner) throw new Error("collaboration.ts: no teammate runner is set; boot() wires it (setTeammateRunner).");
  const target = await findTeammate(input.teammate, input.kind);
  if (!target) {
    const team = (await listBots()).filter((b) => b.id !== asker.id).map((b) => `@${b.handle}`);
    return { answered: false, reason: `There's no teammate "${input.teammate}". Your team: ${team.join(", ")}.` };
  }
  const origin = await originOf(conversationId, asker.id);
  const refusal = checkExchange({ fromId: asker.id, toId: target.id, toHandle: target.handle, kind: input.kind, message: input.message, origin }, [...state.exchanges.values()], Date.now());
  if (refusal) {
    await announce(origin, `⛔ ${asker.name} → ${target.name}: not asked. ${refusal}`);
    return { answered: false, reason: refusal };
  }

  const exchange: Exchange = {
    id: randomUUID(),
    work: origin.work,
    visibleIn: origin.visibleIn,
    runId: origin.runId,
    chain: [...origin.chain, target.id],
    fromId: asker.id,
    toId: target.id,
    kind: input.kind,
    message: input.message,
    at: Date.now(),
    status: "waiting",
    tokens: 0,
  };
  state.exchanges.set(exchange.id, exchange);
  await announce(origin, `💬 ${asker.name} ${KIND_WORDS[input.kind].asked} ${target.name}: “${clip(input.message, 200)}”`);

  const collabId = collabConversationId(exchange.id);
  const latest = (await getBot(target.id)) ?? target;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => (timer = setTimeout(() => resolve("timeout"), ANSWER_TIMEOUT_MS)));
  const reply = await Promise.race([runner.run(latest, collabId, teammatePrompt(asker, input.kind, input.message, exchange.chain.length)), timeout]);
  clearTimeout(timer);

  if (reply === "timeout") {
    await runner.stop(collabId);
    exchange.status = "failed";
    await announce(origin, `✗ ${target.name} didn't answer ${asker.name} within ${ANSWER_TIMEOUT_MS / 60_000} minutes.`);
    return { answered: false, reason: `${target.name} didn't answer in time. Carry on without it.` };
  }
  exchange.tokens = (reply?.usage?.input ?? 0) + (reply?.usage?.output ?? 0);
  const answer = reply && reply.status === "done" ? textOf(reply) : "";
  if (!answer) {
    exchange.status = "failed";
    const why = reply?.error ?? "no answer";
    await announce(origin, `✗ ${target.name} couldn't answer ${asker.name} (${why}).`);
    return { answered: false, reason: `${target.name} couldn't answer (${why}). Carry on without it.` };
  }
  exchange.status = "answered";
  await announce(origin, `↩ ${target.name} answered ${asker.name}: “${clip(answer.replace(/\s+/g, " "), 280)}”`);
  return { answered: true, from: target.name, answer: clip(answer, MAX_ANSWER_CHARS) };
}

// ── sharing a finding ───────────────────────────────────────────────────

/**
 * Share an intermediate result with everyone working on the same thing: it's posted where the
 * work is visible, and in a plan every task that starts later gets it in its brief.
 */
export async function shareFinding(bot: Bot, conversationId: ConversationId, finding: string, sources: string[]): Promise<{ shared: true; where: string }> {
  const origin = await originOf(conversationId, bot.id);
  const text = sources.length ? `${finding}\n\nSources: ${sources.join(", ")}` : finding;
  const message: ChatMessage = {
    id: randomUUID(),
    conversationId: origin.visibleIn,
    role: "bot",
    botId: bot.id,
    createdAt: new Date().toISOString(),
    status: "done",
    parts: [{ kind: "text", text: `📌 **Shared finding**\n\n${text}` }],
  };
  await saveMessage(message);
  publish({ type: "message", message });
  if (origin.runId) {
    await noteOnRun(origin.runId, `📌 ${bot.name} shared a finding: “${clip(finding, 160)}”`, { by: bot.name, text, at: message.createdAt });
  }
  return { shared: true, where: origin.runId ? "the team plan (later tasks see it) and its chat" : "this conversation" };
}

// ── the tools ───────────────────────────────────────────────────────────

const KINDS = ["question", "delegate", "verify", "challenge"] as const satisfies readonly CollabKind[];

/** ask_teammate and share_finding, for a bot with the teamwork switch on. */
export function collaborationTools(bot: Bot): ToolsInput {
  return {
    ask_teammate: createTool({
      id: "ask_teammate",
      description:
        'Ask a teammate and wait for their answer. kind: "question" (ask what they know), "delegate" (hand them a piece of work), "verify" (get a claim or result checked; the fact-checker if unsure who), "challenge" (dispute a teammate\'s conclusion; they defend or revise it). Use sparingly: limits stop loops.',
      inputSchema: z.object({
        teammate: z.string().min(1).describe('Their @handle, e.g. "quinn".'),
        kind: z.enum(KINDS),
        message: z.string().min(10).describe("Everything they need: the question, work or claim, with context. They don't see your conversation."),
      }),
      execute: async (input, context) => askTeammate(bot, conversationIdOf(context.requestContext) ?? `dm:${bot.id}`, input),
    }),
    share_finding: createTool({
      id: "share_finding",
      description: "Share an intermediate result (a fact, a number, a draft) with everyone working on the same thing. In a team plan, every task that starts later sees it.",
      inputSchema: z.object({
        finding: z.string().min(10).describe("The finding, self-contained."),
        sources: z.array(z.string()).max(8).describe("URLs or file names it comes from; empty if none."),
      }),
      execute: async ({ finding, sources }, context) => shareFinding(bot, conversationIdOf(context.requestContext) ?? `dm:${bot.id}`, finding, sources),
    }),
  };
}

/** The line in "What you can do" for a bot with teamwork on. */
export const TEAMWORK_CAPABILITY =
  "Work with teammates: ask_teammate for a question, a piece of work, a check of a claim (verify) or to challenge a conclusion; share_finding to pass an intermediate result to the others. Only when it really helps: each request takes time, and limits stop loops.";

/**
 * Who the teammates are, read fresh on every model call (runtime.ts), so a new agent is known at once.
 * Planners already get a fuller roster from planning.ts, so they get none here.
 */
export async function teamSections(bot: Bot): Promise<string[]> {
  if (!bot.tools.teamwork || bot.tools.planning) return [];
  const team = (await listBots()).filter((b) => b.id !== bot.id);
  const lines = team.map((b) => `- @${b.handle}: ${b.name}${b.title ? `, ${b.title}` : ""}${b.skills.length ? ` (skills: ${b.skills.join(", ")})` : ""}`);
  return [`## Your teammates (for ask_teammate)\n${lines.join("\n")}`];
}
