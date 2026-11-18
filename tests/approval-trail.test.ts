// The approval and audit trail, against a real (temporary) SQLite database.
import { describe, expect, it } from "vitest";
import {
  argsPreview,
  autoActionsInLast24h,
  expireAllPending,
  recordApprovalRequest,
  recordDecision,
  recordToolRun,
} from "@/lib/server/approvals";
import { getApproval, listAudit } from "@/lib/server/db";
import { decideApproval } from "@/lib/server/service";

let counter = 0;
const unique = (prefix: string) => `${prefix}-${++counter}-${Date.now()}`;

function newRequest(botId = unique("bot")) {
  return recordApprovalRequest({
    toolCallId: unique("call"),
    botId,
    conversationId: `dm:${botId}`,
    toolName: "COMPOSIO_MULTI_EXECUTE_TOOL",
    toolCategory: "mcp",
    label: "Used connected apps: Slack: send message",
    args: { channel: "#team", text: "hello" },
  });
}

describe("argsPreview", () => {
  it("shows the exact arguments as readable JSON", () => {
    expect(argsPreview({ channel: "#team", text: "hi" })).toBe('{\n  "channel": "#team",\n  "text": "hi"\n}');
  });

  it("removes anything that looks like a secret", () => {
    const preview = argsPreview({ text: "use key sk-abcdefghijklmnop1234 please" });
    expect(preview).not.toContain("sk-abcdefghijklmnop1234");
    expect(preview).toContain("redacted");
  });
});

describe("approval trail", () => {
  it("a new request is pending and logged", async () => {
    const request = await newRequest();
    expect(request.status).toBe("pending");
    const audit = await listAudit(50);
    expect(audit.some((e) => e.event === "approval.requested" && e.toolCallId === request.toolCallId)).toBe(true);
  });

  it("a decision is saved with who decided and when, and logged", async () => {
    const request = await newRequest();
    const decided = await recordDecision(request, "rejected");
    expect(decided).toMatchObject({ status: "rejected", decidedBy: "you" });
    expect((await getApproval(request.id))?.status).toBe("rejected");
    const audit = await listAudit(50);
    expect(audit.some((e) => e.event === "approval.rejected" && e.toolCallId === request.toolCallId)).toBe(true);
  });

  it("a server restart expires every pending request", async () => {
    const request = await newRequest();
    await expireAllPending("server restart");
    expect(await getApproval(request.id)).toMatchObject({ status: "expired", decidedBy: "server restart" });
  });

  it("approving when the bot is no longer waiting marks the request expired and reports it", async () => {
    const request = await newRequest();
    await expect(decideApproval(request.id, true)).rejects.toThrow(/no longer waiting/);
    expect((await getApproval(request.id))?.status).toBe("expired");
  });

  it("a request can't be decided twice", async () => {
    const request = await newRequest();
    await recordDecision(request, "approved");
    await expect(decideApproval(request.id, false)).rejects.toThrow(/already approved/);
  });

  it("counts only actions that ran without asking toward the daily limit", async () => {
    const botId = unique("bot");
    const run = (toolCategory: string, how: "auto" | "approved" | "not_run") =>
      recordToolRun({ botId, conversationId: `dm:${botId}`, toolName: "t", toolCallId: unique("call"), toolCategory, how, failed: false });
    await run("mcp", "auto");
    await run("execute", "auto");
    await run("mcp", "approved"); // you approved it: doesn't use the allowance
    await run("read", "auto"); // a lookup: not an action
    await run("mcp", "not_run");
    expect(await autoActionsInLast24h(botId)).toBe(2);
  });
});
