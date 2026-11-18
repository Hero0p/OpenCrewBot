// The skills library. Each skill is a folder in skills/ holding a SKILL.md:
// a YAML header (name, description, when_to_use, tools, output) between "---"
// lines, then the Markdown procedure. Skills are plain files, so anyone can add
// or edit one without touching code; they are re-read from disk on every call,
// so an edit applies to the next reply without a restart.
//
// Agents see each assigned skill's name, description and when_to_use in their
// system prompt, and load the full procedure with the load_skill tool only when
// a task matches. That keeps prompts short while the library grows.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Skill, SkillProblem, SkillSummary } from "@/lib/shared/types";

/** Where skills live. The folder is chosen at runtime, so keep the bundler from tracing it. */
export const SKILLS_DIR = resolve(/*turbopackIgnore: true*/ process.env.OPENCREWBOT_SKILLS_DIR || "./skills");

/** A skill id is its folder name: lowercase words joined by dashes. */
const SKILL_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function requireText(header: Record<string, unknown>, key: string): string {
  const value = header[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`"${key}" is missing or empty in the header.`);
  return value.trim();
}

/**
 * Parse one SKILL.md.
 * @param id - the folder name
 * @param text - the file's contents
 * @returns the skill
 * @throws Error naming what's wrong (missing header, missing field, bad tools list)
 */
export function parseSkill(id: string, text: string): Skill {
  const normalized = text.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error('SKILL.md must start with a header between two "---" lines.');
  const header: unknown = parseYaml(match[1]);
  if (typeof header !== "object" || header === null || Array.isArray(header)) throw new Error("The header must be a set of key: value lines.");
  const fields = header as Record<string, unknown>;
  const tools = fields.tools;
  if (!Array.isArray(tools) || !tools.every((t) => typeof t === "string")) throw new Error('"tools" must be a list of tool names, e.g. [web_search, read_page].');
  return {
    id,
    name: requireText(fields, "name"),
    description: requireText(fields, "description"),
    whenToUse: requireText(fields, "when_to_use"),
    tools,
    output: requireText(fields, "output"),
    body: match[2].trim(),
  };
}

/**
 * Read every skill in the library.
 * @returns the valid skills (sorted by name) and the folders that couldn't be read
 */
export function skillLibrary(): { skills: Skill[]; problems: SkillProblem[] } {
  const skills: Skill[] = [];
  const problems: SkillProblem[] = [];
  if (!existsSync(SKILLS_DIR)) return { skills, problems: [{ id: "(library)", error: `The skills folder ${SKILLS_DIR} doesn't exist.` }] };
  for (const entry of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    const file = join(SKILLS_DIR, id, "SKILL.md");
    if (!SKILL_ID.test(id)) {
      problems.push({ id, error: "Folder names must be lowercase words joined by dashes, e.g. market-research." });
      continue;
    }
    if (!existsSync(file)) {
      problems.push({ id, error: "The folder has no SKILL.md." });
      continue;
    }
    try {
      skills.push(parseSkill(id, readFileSync(file, "utf8")));
    } catch (error) {
      problems.push({ id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return { skills, problems };
}

/** @returns every valid skill, without its procedure */
export function listSkills(): SkillSummary[] {
  return skillLibrary().skills.map((s) => ({ id: s.id, name: s.name, description: s.description, whenToUse: s.whenToUse, tools: s.tools, output: s.output }));
}

/**
 * @param id - a skill id
 * @returns the full skill, or null when there is no valid skill with that id
 */
export function getSkill(id: string): Skill | null {
  return skillLibrary().skills.find((s) => s.id === id) ?? null;
}
