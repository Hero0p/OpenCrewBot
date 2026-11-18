// The Agent Factory (Module B): turn a plain-language description ("a pricing analyst who
// compares ed-tech fees in India") into a complete, checked agent: name, role, instructions,
// model, tools, skills, starting memory, permission level and output format.
//
// 1. Draft: a model fills in a fixed schema (structured output). In mock mode a few keyword
//    rules do it instead, and the draft says so.
// 2. Check, in code (checkDraft): skills must exist in the library, the model comes from our
//    own tier list (the model never picks a model id), memory is always on, browser and
//    planning stay off, and the permission level can only be "ask" or "controlled".
// 3. Create: a normal bot (service.createBot), so it's usable at once, with its starting
//    memory written with provenance ("by: Agent Factory").
import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import type { BotInput, BotTools } from "@/lib/shared/types";
import { isMock } from "./config";
import { defaultModel } from "./providers";
import { resolveModelChain, toMastraModels } from "./model-chain";
import { listSkills } from "./skills";
import { modelForTier, type ModelTier } from "./workforce";
import { provenanceTime, remember } from "./memory-layers";
import { listBots } from "./db";

/** The colours the New bot form offers; a drafted agent gets one picked from its name. */
const COLORS = ["#3b82f6", "#f59e0b", "#ec4899", "#22c55e", "#8b5cf6", "#14b8a6", "#ef4444", "#eab308"];

// Every field is required: some providers (Groq) reject structured output that leaves optional fields out.
const draftSchema = z.object({
  name: z.string().describe("A short first name for the agent, e.g. 'Priya'."),
  role: z.string().describe("Its job title, e.g. 'Pricing Analyst'."),
  description: z.string().describe("One sentence: what it does for the team."),
  instructions: z.string().describe("How it works, in 4-8 sentences addressed to the agent ('You …'): method, quality bar, what it never does."),
  skills: z.array(z.string()).describe("Ids of library skills that fit (only ids from the list)."),
  webSearch: z.boolean().describe("Needs to research the web."),
  files: z.boolean().describe("Needs spreadsheets, charts or saved reports."),
  codeMode: z.boolean().describe("Needs exact calculations."),
  askUser: z.boolean().describe("Should ask the person when unsure."),
  teamwork: z.boolean().describe("Should ask teammates and share findings."),
  modelTier: z.enum(["reasoning", "toolHeavy"]).describe("reasoning: judgement and writing; toolHeavy: many tool calls (research, data)."),
  permission: z.enum(["ask", "controlled"]).describe("ask: asks before every outside action; controlled: may run pre-approved kinds of action."),
  outputFormat: z.string().describe("The shape of its answers, e.g. 'A comparison table, then 3 recommendations, then sources.'"),
  memoryNotes: z.array(z.string()).describe("1-4 durable facts for its starting memory, taken only from the description."),
  emoji: z.string().describe("One emoji that fits the role."),
});

type RawDraft = z.infer<typeof draftSchema>;

/** A checked draft, ready to show in the form or to create. */
export interface AgentDraft {
  input: BotInput;
  /** Lines for the agent's starting MEMORY.md. */
  memoryNotes: string[];
  /** What the check changed or what to review, in plain words. */
  notes: string[];
  /** True when the mock rules drafted it, not a model. */
  simulated: boolean;
}

// ── 1. drafting ─────────────────────────────────────────────────────────

function factoryPrompt(description: string, takenNames: string[]): string {
  const skills = listSkills().map((s) => `- ${s.id}: ${s.description}`);
  return [
    "Design one AI agent for a business team from the description below. Fill in every field of the schema.",
    "Write the instructions for the agent itself, concrete to its role: method, quality checks, when to ask, and that it never invents facts or sources.",
    takenNames.length ? `Pick a first name nobody on the team has. Already taken: ${takenNames.join(", ")}.` : "",
    `Skills library (use only these ids):\n${skills.join("\n")}`,
    `Description: ${description}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Keep names apart: seen live, the Chief of Staff created two agents both called "Riya".
 * @returns the name, or "Name (Role word)" when it's taken
 */
export function uniqueName(name: string, role: string, takenNames: string[]): string {
  const taken = new Set(takenNames.map((n) => n.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  const word = role.split(/\s+/).find((w) => w.length > 3) ?? "New";
  return `${name} (${word})`.slice(0, 40);
}

async function modelDraft(description: string, takenNames: string[]): Promise<RawDraft> {
  const agent = new Agent({
    id: "agent-factory",
    name: "Agent Factory",
    instructions: "You design AI agents. Reply only with the structured object.",
    model: toMastraModels(resolveModelChain({ model: defaultModel(), fallbackModels: undefined })),
  });
  const response = await agent.generate(factoryPrompt(description, takenNames), { structuredOutput: { schema: draftSchema } });
  return draftSchema.parse(response.object);
}

/** Words in a description that point at a library skill (mock mode only). */
const SKILL_KEYWORDS: Record<string, RegExp> = {
  "market-research": /\b(market|research|audience|trend)/i,
  "competitor-analysis": /\b(competitor|competition|rival)/i,
  "financial-modelling": /\b(pric|financ|revenue|cost|budget|unit economics)/i,
  "presentation-creation": /\b(slide|deck|presentation)/i,
  "email-drafting": /\b(email|outreach|newsletter)/i,
  "code-review": /\b(code|repo|github|engineer)/i,
  "data-analysis": /\b(data|spreadsheet|csv|analy[sz])/i,
  "lead-generation": /\b(lead|prospect|sales)/i,
  "content-calendar": /\b(content|calendar|social|post)/i,
  "report-consolidation": /\b(report|summar)/i,
  "fact-check": /\b(fact|verif|check)/i,
};

/** Mock mode: a rule-based draft, so the factory works (and can be tested) without a model. */
export function ruleDraft(description: string): RawDraft {
  const named = description.match(/\b(?:called|named)\s+([A-Z][a-z]+)/)?.[1];
  const role = description.match(/\b(?:an?|the)\s+([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2}?\s+(?:analyst|strategist|writer|researcher|engineer|manager|specialist|assistant|creator|planner|agent))\b/i)?.[1];
  const title = role ? role.replace(/\b\w/g, (c) => c.toUpperCase()) : "Specialist";
  const skills = Object.entries(SKILL_KEYWORDS).filter(([, re]) => re.test(description)).map(([id]) => id).slice(0, 3);
  return {
    name: named ?? title.split(" ")[0],
    role: title,
    description: description.slice(0, 160),
    instructions: `You are the team's ${title}. ${description} Work from evidence, cite your sources, say clearly what you couldn't verify, and ask the person before anything irreversible.`,
    skills,
    webSearch: /research|web|market|competitor|news|trend/i.test(description),
    files: /data|spreadsheet|csv|chart|report/i.test(description),
    codeMode: /calculat|model|forecast|number|data/i.test(description),
    askUser: true,
    teamwork: true,
    modelTier: /research|data|search/i.test(description) ? "toolHeavy" : "reasoning",
    permission: "ask",
    outputFormat: "A short answer first, then the details, then sources.",
    memoryNotes: [`Created to: ${description.slice(0, 200)}`],
    emoji: "🧩",
  };
}

// ── 2. checking ─────────────────────────────────────────────────────────

const clip = (text: string, max: number) => text.trim().slice(0, max);

/**
 * Turn a raw draft into a valid BotInput, fixing what doesn't fit and saying so.
 * @param raw - the drafted fields
 * @returns the checked draft (input, memory notes, notes about what changed)
 */
export function checkDraft(raw: RawDraft, simulated: boolean): AgentDraft {
  const notes: string[] = [];
  const known = new Set(listSkills().map((s) => s.id));
  const skills = [...new Set(raw.skills)].filter((id) => known.has(id));
  const unknown = raw.skills.filter((id) => !known.has(id));
  if (unknown.length) notes.push(`Left out skills that aren't in the library: ${unknown.join(", ")}.`);
  const name = clip(raw.name, 40) || "New agent";
  const tools: BotTools = {
    webSearch: raw.webSearch,
    // Memory is always on: every agent keeps notes (Module B requires memory).
    memory: true,
    codeMode: raw.codeMode,
    // A cloud browser and planning are given by hand, not by a description.
    browser: false,
    askUser: raw.askUser,
    files: raw.files,
    planning: false,
    teamwork: raw.teamwork,
  };
  const tier: ModelTier = raw.modelTier;
  const input: BotInput = {
    name,
    title: clip(raw.role, 40),
    description: clip(raw.description, 300),
    instructions: clip(raw.instructions, 8000),
    emoji: [...raw.emoji.trim()][0] ?? "🧩",
    color: COLORS[[...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % COLORS.length],
    model: modelForTier(tier),
    tools,
    approval: raw.permission === "controlled" ? "controlled" : "ask",
    pinned: false,
    skills,
    outputFormat: clip(raw.outputFormat, 1000),
  };
  if (raw.permission === "controlled") notes.push("Controlled access: check which kinds of action it may run without asking (none yet).");
  notes.push(`Model: ${input.model} (picked for ${tier === "reasoning" ? "judgement and writing" : "many tool calls"}; change it in Details).`);
  if (simulated) notes.unshift("Drafted by the mock model's keyword rules, not by an AI. Review every field.");
  return { input, memoryNotes: raw.memoryNotes.map((n) => clip(n, 300)).filter(Boolean).slice(0, 4), notes, simulated };
}

/**
 * Draft and check an agent from a description.
 * @throws Error when the description is too short, or the model call fails (the message says why)
 */
export async function draftAgent(description: string): Promise<AgentDraft> {
  const text = description.trim();
  if (text.length < 15) throw new Error("Describe the agent in a sentence or two: what it does, for whom, and how.");
  if (text.length > 2000) throw new Error("Keep the description under 2,000 characters.");
  const takenNames = (await listBots()).map((b) => b.name);
  const draft = isMock() ? checkDraft(ruleDraft(text), true) : checkDraft(await modelDraft(text, takenNames), false);
  const name = uniqueName(draft.input.name, draft.input.title, takenNames);
  if (name !== draft.input.name) draft.notes.push(`Renamed to "${name}": "${draft.input.name}" is already on the team.`);
  return { ...draft, input: { ...draft.input, name } };
}

// ── 3. creating ─────────────────────────────────────────────────────────

/**
 * Write a new agent's starting memory, each line stamped with where it came from.
 * @param botId - the agent just created
 * @param notes - its starting facts
 * @param by - who created it ("you" in the form, or the Chief of Staff's name)
 */
export function writeStartingMemory(botId: string, notes: string[], by: string): void {
  for (const note of notes) {
    remember({ scope: "agent", id: botId }, note, { by, when: provenanceTime(), why: "from the description it was created with", in: "Agent Factory" }, { title: "Memory" });
  }
}
