// What a bot may do without asking.
//
// This file only DECIDES policies; Mastra ENFORCES them. Before every tool call,
// the bot's session looks up the policy for the tool's category: "allow" runs it,
// "ask" parks the call until you approve or reject it, and a rejected call never
// runs (Mastra reports it with `denied: true` and the tool's code is not called).
// tests/approval-enforcement.test.ts proves that with a real Mastra session.
//
// Tool categories come from toolCategory() in tools.ts:
//   read    – lookups: web search, reading pages, code mode, asking you a question
//   edit    – the bot's own MEMORY.md
//   execute – acting in the cloud browser
//   mcp     – actions in connected apps (Composio) and MCP servers
//   other   – a tool nobody classified
import type { PermissionPolicy, Session, ToolCategory } from "@mastra/core/agent-controller";
import type { ActionGroup, ApprovalMode, Bot } from "@/lib/shared/types";

/** The Mastra category that holds each kind of action. */
export const ACTION_GROUP_CATEGORY: Record<ActionGroup, ToolCategory> = {
  apps: "mcp",
  browser: "execute",
};

/** New controlled-access bots may run this many actions without asking in any 24 hours. */
export const DEFAULT_AUTO_ACTIONS_PER_DAY = 20;

/** The categories whose tools change something outside OpenCrewBot. Runs of these count toward the daily limit. */
export const ACTION_CATEGORIES: readonly ToolCategory[] = ["mcp", "execute"];

/** One policy per tool category. A Record, so TypeScript insists that every category gets one. */
export type CategoryPolicies = Record<ToolCategory, PermissionPolicy>;

type PermissionSettings = Pick<Bot, "approval" | "preapprovedActions" | "autoActionsPerDay">;

/** The policy for one kind of action at the bot's permission level. */
function actionPolicy(bot: PermissionSettings, group: ActionGroup, autoActionsToday: number): PermissionPolicy {
  const mode: ApprovalMode = bot.approval;
  switch (mode) {
    case "full":
      return "allow";
    case "ask":
      return "ask";
    case "controlled": {
      const preapproved = bot.preapprovedActions.includes(group);
      const withinLimit = autoActionsToday < bot.autoActionsPerDay;
      return preapproved && withinLimit ? "allow" : "ask";
    }
  }
}

/**
 * Decide the policy for every tool category for one bot.
 * @param bot - the bot's permission settings
 * @param autoActionsToday - actions this bot ran without asking in the last 24 hours (counts toward the controlled-access limit)
 * @returns one policy per category
 */
export function permissionRules(bot: PermissionSettings, autoActionsToday: number): CategoryPolicies {
  return {
    // Lookups and the bot's own memory don't change anything outside OpenCrewBot.
    read: "allow",
    edit: "allow",
    // Actions depend on the bot's permission level.
    execute: actionPolicy(bot, "browser", autoActionsToday),
    mcp: actionPolicy(bot, "apps", autoActionsToday),
    // A tool nobody classified might do anything, so it asks at every level. Classify new tools in tools.ts.
    other: "ask",
  };
}

/**
 * Write the rules into a Mastra session, which enforces them on every tool call.
 * @param permissions - the session's permission store (`session.permissions`)
 * @param rules - from {@link permissionRules}
 */
export async function applyPermissionRules(permissions: Pick<Session["permissions"], "setForCategory">, rules: CategoryPolicies): Promise<void> {
  const categories: ToolCategory[] = ["read", "edit", "execute", "mcp", "other"];
  for (const category of categories) {
    await permissions.setForCategory({ category, policy: rules[category] });
  }
}
