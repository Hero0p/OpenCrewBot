// The skills library in skills/: every SKILL.md is valid and only mentions real tools.
import { describe, expect, it } from "vitest";
import { getSkill, parseSkill, skillLibrary } from "@/lib/server/skills";
import { TOOL_CATALOG } from "@/lib/server/tools";

/** Every tool name a skill may mention: the catalog, plus browser tools beyond the two catalog examples. */
const KNOWN_TOOLS = new Set([...TOOL_CATALOG.map((t) => t.name), "browser_click", "browser_type"]);

const REQUIRED_SKILLS = [
  "market-research",
  "competitor-analysis",
  "financial-modelling",
  "presentation-creation",
  "email-drafting",
  "code-review",
  "data-analysis",
  "lead-generation",
];

describe("skills library", () => {
  const { skills, problems } = skillLibrary();

  it("reads every skill without problems", () => {
    expect(problems).toEqual([]);
    expect(skills.length).toBeGreaterThanOrEqual(11);
  });

  it("includes the 8 skills the assignment requires", () => {
    const ids = skills.map((s) => s.id);
    for (const id of REQUIRED_SKILLS) expect(ids).toContain(id);
  });

  it("only lists tools that exist", () => {
    for (const skill of skills) {
      for (const tool of skill.tools) expect(KNOWN_TOOLS, `${skill.id} mentions unknown tool ${tool}`).toContain(tool);
    }
  });

  it("gives every skill a procedure with an output template and quality checks", () => {
    for (const skill of skills) {
      expect(skill.body, skill.id).toMatch(/## Procedure/);
      expect(skill.body, skill.id).toMatch(/## Output template/);
      expect(skill.body, skill.id).toMatch(/## Quality checks/);
    }
  });

  it("loads one skill with its full procedure", () => {
    const skill = getSkill("competitor-analysis");
    expect(skill?.name).toBe("Competitor Analysis");
    expect(skill?.body).toContain("Never invent a price");
    expect(getSkill("no-such-skill")).toBeNull();
  });
});

describe("parseSkill", () => {
  const valid = "---\nname: X\ndescription: d\nwhen_to_use: w\ntools: [web_search]\noutput: o\n---\n# Body\n";

  it("accepts Windows line endings", () => {
    expect(parseSkill("x", valid.replace(/\n/g, "\r\n")).body).toBe("# Body");
  });

  it("rejects a file without a header", () => {
    expect(() => parseSkill("x", "# Just markdown")).toThrow(/header/);
  });

  it("names the missing field", () => {
    expect(() => parseSkill("x", valid.replace("output: o\n", ""))).toThrow(/"output"/);
  });

  it("requires tools to be a list", () => {
    expect(() => parseSkill("x", valid.replace("tools: [web_search]", "tools: web_search"))).toThrow(/tools/);
  });
});
