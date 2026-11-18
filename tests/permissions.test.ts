// The policy table for the three permission levels (decided in permissions.ts, enforced by Mastra).
import { describe, expect, it } from "vitest";
import { permissionRules } from "@/lib/server/permissions";

const base = { preapprovedActions: [] as ("apps" | "browser")[], autoActionsPerDay: 20 };

describe("permissionRules", () => {
  it("never asks for lookups or the bot's own memory, at any level", () => {
    for (const approval of ["ask", "controlled", "full"] as const) {
      const rules = permissionRules({ ...base, approval }, 0);
      expect(rules.read).toBe("allow");
      expect(rules.edit).toBe("allow");
    }
  });

  it("always asks for a tool nobody classified, even with full access", () => {
    for (const approval of ["ask", "controlled", "full"] as const) {
      expect(permissionRules({ ...base, approval }, 0).other).toBe("ask");
    }
  });

  it("Ask first: app and browser actions ask", () => {
    const rules = permissionRules({ ...base, approval: "ask" }, 0);
    expect(rules.mcp).toBe("ask");
    expect(rules.execute).toBe("ask");
  });

  it("Full access: app and browser actions run", () => {
    const rules = permissionRules({ ...base, approval: "full" }, 0);
    expect(rules.mcp).toBe("allow");
    expect(rules.execute).toBe("allow");
  });

  it("Controlled: only the pre-approved kind of action runs on its own", () => {
    const rules = permissionRules({ ...base, approval: "controlled", preapprovedActions: ["browser"] }, 0);
    expect(rules.execute).toBe("allow");
    expect(rules.mcp).toBe("ask");
  });

  it("Controlled: pre-approved actions ask again once the daily limit is used up", () => {
    const bot = { approval: "controlled" as const, preapprovedActions: ["apps" as const], autoActionsPerDay: 5 };
    expect(permissionRules(bot, 4).mcp).toBe("allow");
    expect(permissionRules(bot, 5).mcp).toBe("ask");
  });

  it("Controlled: a limit of 0 means every action asks", () => {
    expect(permissionRules({ approval: "controlled", preapprovedActions: ["apps"], autoActionsPerDay: 0 }, 0).mcp).toBe("ask");
  });
});
