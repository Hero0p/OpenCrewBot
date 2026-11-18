// The approval and audit trail. Every approval request, every decision and
// every tool run is written to the database here, and then announced so open
// Approval Centre views refresh.
//
// Deciding an approval also has to release the waiting bot, which needs the
// runtime, so that part lives in service.ts (decideApproval).
import { randomUUID } from "node:crypto";
import type { ApprovalRecord, AuditEvent, ConversationId } from "@/lib/shared/types";
import * as store from "./db";
import { publish } from "./bus";
import { redactSecrets } from "./memory-files";
import { ACTION_CATEGORIES } from "./permissions";

/** Longest argument preview kept for an approval request. */
const PREVIEW_LIMIT = 4000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The tool's arguments as readable JSON, with anything that looks like a key, token or password removed.
 * @param args - the arguments the model chose
 * @returns at most PREVIEW_LIMIT characters
 */
export function argsPreview(args: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(args ?? {}, null, 2);
  } catch {
    // Arguments that can't be serialised (e.g. circular) are rare; say so instead of failing the request.
    json = "(arguments could not be shown)";
  }
  return redactSecrets(json).slice(0, PREVIEW_LIMIT);
}

async function audit(event: AuditEvent, fields: Omit<store.NewAuditEntry, "event">): Promise<void> {
  await store.appendAudit({ event, ...fields });
  publish({ type: "approvals-changed" });
}

/**
 * Save a new pending request when a bot's tool call is parked waiting for approval.
 * @returns the saved request
 */
export async function recordApprovalRequest(input: {
  toolCallId: string;
  botId: string;
  conversationId: ConversationId;
  toolName: string;
  toolCategory: string;
  label: string;
  args: unknown;
}): Promise<ApprovalRecord> {
  const record: ApprovalRecord = {
    id: randomUUID(),
    toolCallId: input.toolCallId,
    botId: input.botId,
    conversationId: input.conversationId,
    toolName: input.toolName,
    label: input.label,
    argsPreview: argsPreview(input.args),
    status: "pending",
    requestedAt: new Date().toISOString(),
  };
  await store.saveApproval(record);
  await audit("approval.requested", {
    botId: record.botId,
    conversationId: record.conversationId,
    toolName: record.toolName,
    toolCallId: record.toolCallId,
    toolCategory: input.toolCategory,
    detail: record.label,
  });
  return record;
}

/**
 * Record your decision on a pending request. This only writes the decision;
 * service.decideApproval then releases the waiting bot.
 * @returns the updated request
 */
export async function recordDecision(record: ApprovalRecord, status: "approved" | "rejected"): Promise<ApprovalRecord> {
  const decided: ApprovalRecord = { ...record, status, decidedAt: new Date().toISOString(), decidedBy: "you" };
  await store.saveApproval(decided);
  await audit(status === "approved" ? "approval.approved" : "approval.rejected", {
    botId: record.botId,
    conversationId: record.conversationId,
    toolName: record.toolName,
    toolCallId: record.toolCallId,
    detail: "by you",
  });
  return decided;
}

/**
 * Mark a request as expired: it can no longer be decided, and its action did not run.
 * @param reason - plain words, e.g. "server restart" or "the run was stopped"
 */
export async function expireApproval(record: ApprovalRecord, reason: string): Promise<void> {
  await store.saveApproval({ ...record, status: "expired", decidedAt: new Date().toISOString(), decidedBy: reason });
  await audit("approval.expired", {
    botId: record.botId,
    conversationId: record.conversationId,
    toolName: record.toolName,
    toolCallId: record.toolCallId,
    detail: reason,
  });
}

/** Expire the pending request for one parked tool call, if there is one (used when a run stops while waiting). */
export async function expirePendingFor(conversationId: ConversationId, botId: string, toolCallId: string, reason: string): Promise<void> {
  const record = await store.findPendingApproval(conversationId, botId, toolCallId);
  if (record) await expireApproval(record, reason);
}

/**
 * Expire every pending request. Used at startup: a parked tool call doesn't survive a
 * server restart, so its request can't be decided any more (and its action never ran).
 * @returns how many requests were expired
 */
export async function expireAllPending(reason: string): Promise<number> {
  const pending = await store.listApprovalsByStatus(["pending"]);
  for (const record of pending) await expireApproval(record, reason);
  return pending.length;
}

/**
 * Record how a tool call ended.
 * @param how - "auto": ran without asking; "approved": ran after you approved; "not_run": stopped before it ran
 */
export async function recordToolRun(input: {
  botId: string;
  conversationId: ConversationId;
  toolName: string;
  toolCallId: string;
  toolCategory: string;
  how: "auto" | "approved" | "not_run";
  failed: boolean;
}): Promise<void> {
  const event: AuditEvent = input.how === "auto" ? "tool.ran_auto" : input.how === "approved" ? "tool.ran_approved" : "tool.not_run";
  await audit(event, {
    botId: input.botId,
    conversationId: input.conversationId,
    toolName: input.toolName,
    toolCallId: input.toolCallId,
    toolCategory: input.toolCategory,
    detail: input.how === "not_run" ? "did not run" : input.failed ? "failed" : "succeeded",
  });
}

/** Record that a controlled-access bot used up its daily allowance of actions without asking. */
export async function recordLimitReached(botId: string, conversationId: ConversationId, limit: number): Promise<void> {
  const actions = limit === 1 ? "1 action" : `${limit} actions`;
  await audit("limit.reached", { botId, conversationId, detail: `${actions} without asking in 24 hours; actions ask again` });
}

/** @returns how many actions (apps, MCP, browser) a bot ran without asking in the last 24 hours */
export function autoActionsInLast24h(botId: string): Promise<number> {
  return store.countAutoRunsSince(botId, ACTION_CATEGORIES, new Date(Date.now() - DAY_MS).toISOString());
}
