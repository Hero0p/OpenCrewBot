// Module H: app actions with per-action permissions (reads run, changes ask), honest status
// badges (live / not connected / not configured / not working / untested), and SIMULATED changes in mock mode.
import { describe, expect, it } from "vitest";
import { actionLabel, appActionTools, describeInputs, isReadAction, parseInputs } from "@/lib/server/app-actions";
import { argsPreview } from "@/lib/server/approvals";
import { appStatuses, recordServerTest, serverStatuses } from "@/lib/server/integrations";
import { describeComposioError } from "@/lib/server/composio";
import { toolCategory } from "@/lib/server/tools";
import { permissionRules } from "@/lib/server/permissions";
import { listFiles } from "@/lib/server/files";
import type { ToolsInput } from "@mastra/core/agent";

function executeOf<T>(tool: ToolsInput[string]): (input: unknown, context?: unknown) => Promise<T> {
  if (!("execute" in tool) || typeof tool.execute !== "function") throw new Error("this tool can't be executed directly");
  // Safe: tools made with createTool always take (input, context); the union type just doesn't say which.
  return tool.execute as (input: unknown, context?: unknown) => Promise<T>;
}

describe("which app actions ask first", () => {
  it("treats only clear reads as reads", () => {
    expect(isReadAction("GITHUB_LIST_REPOSITORY_ISSUES")).toBe(true);
    expect(isReadAction("GITHUB_GET_A_REPOSITORY")).toBe(true);
    expect(isReadAction("NOTION_SEARCH_NOTION_PAGE")).toBe(true);
    expect(isReadAction("GITHUB_CREATE_AN_ISSUE")).toBe(false);
    expect(isReadAction("SLACK_SEND_MESSAGE")).toBe(false);
    expect(isReadAction("GITHUB_MERGE_A_PULL_REQUEST")).toBe(false);
    expect(actionLabel("SLACK_SEND_MESSAGE")).toBe("Slack: send message");
  });

  it("lets reads run and makes changes ask, at Ask first and Controlled (unless pre-approved)", () => {
    expect(toolCategory("read_from_app")).toBe("read");
    expect(toolCategory("find_app_actions")).toBe("read");
    expect(toolCategory("act_in_app")).toBe("mcp");
    expect(permissionRules({ approval: "ask", preapprovedActions: [], autoActionsPerDay: 20 }, 0).mcp).toBe("ask");
    expect(permissionRules({ approval: "controlled", preapprovedActions: [], autoActionsPerDay: 20 }, 0).mcp).toBe("ask");
    expect(permissionRules({ approval: "ask", preapprovedActions: [], autoActionsPerDay: 20 }, 0).read).toBe("allow");
  });

  it("refuses a change sent to read_from_app, and an app the bot wasn't given", async () => {
    const tools = appActionTools(["github"]);
    const read = executeOf(tools.read_from_app);
    await expect(read({ action: "GITHUB_CREATE_AN_ISSUE", inputs: "{}" })).rejects.toThrow(/changes something/);
    await expect(read({ action: "SLACK_LIST_ALL_CHANNELS", inputs: "{}" })).rejects.toThrow(/isn't switched on for you/);
  });

  it("simulates a change in mock mode: nothing is sent, and what would have been done is saved in Files", async () => {
    const act = executeOf<{ simulated: boolean; note: string }>(appActionTools(["slack"]).act_in_app);
    const result = await act({ action: "SLACK_SEND_MESSAGE", inputs: JSON.stringify({ channel: "#marketing", text: "Launch!" }), summary: "Post the launch note to #marketing" }, { requestContext: undefined });
    expect(result.simulated).toBe(true);
    expect(result.note).toContain("nothing was sent");
    expect(listFiles().some((f) => f.path.includes("simulated-slack-send-message"))).toBe(true);
  });
});

describe("app action inputs (seen live: Gmail sends arrived with empty inputs)", () => {
  it("reads inputs written as JSON text, and explains a bad one", () => {
    expect(parseInputs('{"recipient_email": "a@example.com", "subject": "Hi"}')).toEqual({ recipient_email: "a@example.com", subject: "Hi" });
    expect(parseInputs("")).toEqual({});
    expect(() => parseInputs("recipient_email=a@example.com")).toThrow(/JSON text/);
    expect(() => parseInputs("[1, 2]")).toThrow(/JSON object/);
  });

  it("describes an action's real input fields for the model", () => {
    const schema = { properties: { recipient_email: { type: "string", description: "Email address of the recipient." }, subject: { type: "string" } }, required: ["recipient_email"] };
    expect(describeInputs(schema)).toEqual({ required: ["recipient_email"], fields: { recipient_email: "string: Email address of the recipient.", subject: "string" } });
    expect(describeInputs(undefined)).toBeUndefined();
  });

  it("shows JSON-text inputs readably in the approval preview", () => {
    const preview = argsPreview({ action: "GMAIL_SEND_EMAIL", inputs: '{"recipient_email": "a@example.com", "subject": "Hi"}', summary: "Email a greeting" });
    expect(preview).toContain('"recipient_email": "a@example.com"');
    expect(preview).not.toContain('\\"');
  });
});

describe("integration status badges", () => {
  const bots = [{ name: "Sasha", connections: ["composio:slack"] }];

  it("says what's really working", () => {
    expect(appStatuses({ keySet: false, apps: [] }, bots).find((s) => s.id === "composio:slack")).toMatchObject({ state: "not-configured", usedBy: ["Sasha"] });
    expect(appStatuses({ keySet: true, apps: [], error: "Composio rejected COMPOSIO_API_KEY" }, bots)[0].state).toBe("error");
    const apps = [{ slug: "github", name: "GitHub", connected: true }, { slug: "slack", name: "Slack", connected: false }];
    const statuses = appStatuses({ keySet: true, apps }, bots);
    expect(statuses.find((s) => s.id === "composio:github")?.state).toBe("live");
    expect(statuses.find((s) => s.id === "composio:slack")?.state).toBe("not-connected");
  });

  it("shows an MCP server as untested until a test passes", () => {
    const server = { id: "s1", name: "DeepWiki", url: "https://mcp.deepwiki.com/mcp", hasToken: false, headerNames: [] };
    expect(serverStatuses([server], [])[0].state).toBe("untested");
    recordServerTest("s1", { ok: true, tools: 3 });
    expect(serverStatuses([server], [])[0]).toMatchObject({ state: "live", detail: "Reachable: 3 tools" });
    recordServerTest("s1", { ok: false, error: "timeout" });
    expect(serverStatuses([server], [])[0].state).toBe("error");
  });

  it("explains a rejected Composio key and how to fix it", () => {
    expect(describeComposioError(new Error('401 {"error":{"message":"Invalid API key: ck_**"}}'))).toMatch(/COMPOSIO_API_KEY.*platform\.composio\.dev/);
  });
});
