// The tools a bot gets, from its settings. Names are short snake_case words
// because open models pick tools by name more reliably that way.
import type { ToolsInput } from "@mastra/core/agent";
import { createTool, createCodeMode } from "@mastra/core/tools";
import type { ToolCategory } from "@mastra/core/agent-controller";
import { tavily } from "@tavily/core";
import { QuickJsCodeModeTransport } from "@mastra/quickjs";
import { z } from "zod";
import type { Bot, Source, ToolInfo } from "@/lib/shared/types";
import { appendMemory, editMemory } from "./memory-files";
import { publish } from "./bus";
import { keys } from "./config";
import { mcpServerNames } from "./connectors";
import { getSkill } from "./skills";
import { MAX_ROWS, fileUrl, listFiles, readSpreadsheet, saveChart, saveReport } from "./files";
import { CHART_LIMITS, renderChartSvg } from "./charts";

export const CODE_MODE_TOOL = "execute_typescript";

function memoryTools(botId: string): ToolsInput {
  return {
    memory_add: createTool({
      id: "memory_add",
      description:
        "Save one durable fact to your MEMORY.md (a preference, a decision, something about the person or your ongoing work). One short line per call.",
      inputSchema: z.object({
        note: z.string().min(1).describe("The fact, as one short sentence."),
        section: z.string().optional().describe("Optional heading to file it under, e.g. 'About the person' or 'Projects'."),
      }),
      execute: async ({ note, section }) => {
        appendMemory(botId, note, section);
        publish({ type: "memory-changed", botId });
        return { saved: true };
      },
    }),
    memory_edit: createTool({
      id: "memory_edit",
      description:
        "Fix or remove a line in your MEMORY.md. `find` must match the current text exactly once; use an empty `replace` to delete it.",
      inputSchema: z.object({ find: z.string().min(1), replace: z.string() }),
      execute: async ({ find, replace }) => {
        const result = editMemory(botId, find, replace);
        if (result.ok) publish({ type: "memory-changed", botId });
        return result;
      },
    }),
  };
}

/**
 * The web tools, built on Tavily's SDK with deliberately small input schemas.
 * The ready-made @mastra/tavily tools expose 5-13 optional settings each, and two providers trip over them:
 * - Gemini rejects `false` inside an enum (their `includeRawContent`), so every request
 *   from a bot with web search failed on Gemini.
 * - Mastra sends Groq every optional field as "required, may be null" (OpenAI strict style,
 *   see OpenAISchemaCompatLayer in @mastra/schema-compat), and Groq's server rejects a call
 *   that leaves one out ("Tool call validation failed"), which its models often do.
 * So each tool exposes only what an agent needs, and picks sensible values for the rest.
 */
function webTools(): ToolsInput {
  let client: ReturnType<typeof tavily> | null = null;
  const tavilyClient = () => (client ??= tavily({ apiKey: process.env.TAVILY_API_KEY ?? "", clientName: "opencrewbot" }));

  return {
    web_search: createTool({
      id: "web_search",
      description: "Search the web. Returns results with titles, URLs and content snippets.",
      inputSchema: z.object({
        query: z.string().min(1).describe("What to search for."),
        maxResults: z.number().int().min(1).max(10).optional().describe("How many results (default 5)."),
        timeRange: z.enum(["day", "week", "month", "year"]).optional().describe("Only results from this recent period."),
      }),
      execute: async ({ query, maxResults, timeRange }) => {
        const response = await tavilyClient().search(query, { maxResults: maxResults ?? 5, timeRange });
        return {
          query: response.query,
          results: response.results.map((r) => ({ title: r.title, url: r.url, content: r.content })),
        };
      },
    }),
    read_page: createTool({
      id: "read_page",
      description: "Read the main content of up to 5 web pages, as Markdown.",
      inputSchema: z.object({
        urls: z.array(z.string()).min(1).max(5).describe("The page URLs."),
        focus: z.string().optional().describe("What you're looking for, so the most relevant parts come first."),
      }),
      execute: async ({ urls, focus }) => {
        const response = await tavilyClient().extract(urls, { query: focus, format: "markdown" });
        return {
          results: response.results.map((r) => ({ url: r.url, content: r.rawContent })),
          failed: response.failedResults.map((r) => ({ url: r.url, error: r.error })),
        };
      },
    }),
    crawl_site: createTool({
      id: "crawl_site",
      description: "Read several pages of one website, starting from a URL (e.g. to find a pricing page).",
      inputSchema: z.object({
        url: z.string().describe("Where to start."),
        instructions: z.string().optional().describe('What to look for, e.g. "pricing and plans".'),
      }),
      execute: async ({ url, instructions }) => {
        // At most 10 pages, 2 links deep: enough to find a pricing or product page without flooding the model.
        const response = await tavilyClient().crawl(url, { instructions, limit: 10, maxDepth: 2, format: "markdown" });
        return { baseUrl: response.baseUrl, results: response.results.map((r) => ({ url: r.url, content: r.rawContent })) };
      },
    }),
  };
}

/** The Files folder tools: find and read spreadsheets, make charts, save reports. Paths can't leave the Files folder. */
function fileTools(): ToolsInput {
  return {
    list_files: createTool({
      id: "list_files",
      description: "List the files in the shared Files folder: uploads (spreadsheets people added), reports and charts.",
      // At least one property: Gemini rejects tools whose parameters are an empty object.
      inputSchema: z.object({
        folder: z.enum(["uploads", "reports", "charts"]).optional().describe("Only list this subfolder."),
      }),
      execute: async ({ folder }) => ({
        files: listFiles()
          .filter((f) => !folder || f.path.startsWith(`${folder}/`))
          .map((f) => ({ ...f, url: fileUrl(f.path) })),
      }),
    }),
    read_spreadsheet: createTool({
      id: "read_spreadsheet",
      description:
        "Read a CSV file from the Files folder. Returns every column's type and summary (min, max, sum, mean for numbers) over ALL rows, plus the first rows. For calculations over many rows, call it from execute_typescript with a larger maxRows.",
      inputSchema: z.object({
        path: z.string().describe('Path inside the Files folder, e.g. "uploads/sales.csv". Use list_files to find it.'),
        maxRows: z.number().int().min(1).max(MAX_ROWS).optional().describe(`How many rows to return (default 20, at most ${MAX_ROWS}).`),
      }),
      execute: async ({ path, maxRows }) => readSpreadsheet(path, maxRows ?? 20),
    }),
    make_chart: createTool({
      id: "make_chart",
      description:
        "Draw a bar or line chart as an image and save it in the Files folder. Returns Markdown you can paste into your reply to show the chart. Compute the numbers first; this tool only draws them.",
      inputSchema: z.object({
        title: z.string().min(1).max(120),
        type: z.enum(["bar", "line"]),
        labels: z.array(z.string()).min(1).max(CHART_LIMITS.labels).describe("One label per point on the x-axis."),
        series: z
          .array(z.object({ name: z.string(), values: z.array(z.number()).describe("One value per label.") }))
          .min(1)
          .max(CHART_LIMITS.series),
        unit: z.string().max(12).optional().describe('Shown next to the title, e.g. "₹" or "%".'),
      }),
      execute: async (spec) => {
        const saved = saveChart(spec.title, renderChartSvg(spec));
        return { ...saved, markdown: `![${spec.title}](${saved.url})` };
      },
    }),
    save_report: createTool({
      id: "save_report",
      description: "Save a long deliverable (report, analysis, plan, deck outline) as a Markdown file in the Files folder. Returns a link to share in your reply.",
      inputSchema: z.object({
        title: z.string().min(1).max(120),
        markdown: z.string().min(1).max(200_000).describe("The full report in Markdown."),
      }),
      execute: async ({ title, markdown }) => {
        const saved = saveReport(title, markdown);
        return { ...saved, markdown: `[${title}](${saved.url})` };
      },
    }),
  };
}

/** load_skill: hands the bot the full procedure of one of its own skills. */
function skillTools(allowed: string[]): ToolsInput {
  return {
    load_skill: createTool({
      id: "load_skill",
      description: "Load the step-by-step procedure, output template and quality checks of one of your skills. Call it before starting a task that matches the skill.",
      inputSchema: z.object({ skill: z.string().describe('The skill id, e.g. "competitor-analysis".') }),
      execute: async ({ skill }) => {
        if (!allowed.includes(skill)) throw new Error(`"${skill}" isn't one of your skills. Yours are: ${allowed.join(", ")}.`);
        const found = getSkill(skill);
        if (!found) throw new Error(`The skill "${skill}" couldn't be loaded: its SKILL.md is missing or invalid (see Skills & Tools).`);
        return { skill: found.id, name: found.name, usesTools: found.tools, output: found.output, procedure: found.body };
      },
    }),
  };
}

export interface BotToolset {
  tools: ToolsInput;
  /** Extra prompt text the tools need (Code Mode's function stubs). */
  instructions: string[];
  /** What the bot can do, in words, for its own system prompt. */
  capabilities: string[];
}

export function buildTools(bot: Bot): BotToolset {
  const tools: ToolsInput = {};
  const instructions: string[] = [];
  const capabilities: string[] = [];

  if (bot.tools.webSearch && keys.tavily()) {
    Object.assign(tools, webTools());
    capabilities.push("Search the web (web_search), read pages (read_page) and crawl sites (crawl_site). Cite the URLs you used.");
  } else if (bot.tools.webSearch) {
    capabilities.push("Web search is switched on for you, but no Tavily key is set yet, so you can't search right now. Say so if asked.");
  }
  if (bot.tools.memory) {
    Object.assign(tools, memoryTools(bot.id));
  }
  if (bot.tools.files) {
    Object.assign(tools, fileTools());
    capabilities.push(
      "Use the shared Files folder: list_files, read_spreadsheet (CSV), make_chart (paste the Markdown it returns to show the chart) and save_report (save long deliverables and share the link).",
    );
  }
  if (bot.skills.length) {
    Object.assign(tools, skillTools(bot.skills));
  }
  // Code Mode is added last, so the program it writes can call every tool above (e.g. read_spreadsheet).
  if (bot.tools.codeMode) {
    // The program runs in a QuickJS (WebAssembly) isolate with no filesystem or
    // network; its only reach is the tools passed here, bridged back to the host.
    const reachable = { ...tools };
    const codeMode = createCodeMode({ tools: reachable, timeout: 60_000 }, new QuickJsCodeModeTransport({ memoryLimitMb: 128 }));
    tools[CODE_MODE_TOOL] = codeMode.tool;
    instructions.push(codeMode.instructions);
    capabilities.push(
      `Run TypeScript with ${CODE_MODE_TOOL} when a question needs several tool calls, filtering, or exact arithmetic; call the other tools from inside it with Promise.all.`,
    );
  }
  if (bot.tools.browser && keys.browserbase()) {
    capabilities.push(
      "Drive a real cloud browser with the browser_* tools for pages that need clicks, forms or JavaScript. Start with browser_goto, then browser_snapshot to get element refs. The person can watch you live. Prefer read_page for plain reading; it's faster.",
    );
  } else if (bot.tools.browser) {
    capabilities.push("The browser is switched on for you, but no Browserbase key is set yet, so browsing will fail. Say so if asked.");
  }
  return { tools, instructions, capabilities };
}

/** Which approval policy a tool falls under. Read and memory tools never ask;
 * acting in the browser does, unless the bot has Full access. */
/** MCP tool names that only look things up. A heuristic over the tool's own name:
 * anything that doesn't read clearly as a lookup asks first. */
const READ_ONLY_VERB = /^(get|list|search|read|fetch|find|view|show|describe|lookup|query)(_|$)/;

export function toolCategory(toolName: string): ToolCategory | null {
  if (["web_search", "read_page", "crawl_site", "ask_user", CODE_MODE_TOOL, "load_skill", "list_files", "read_spreadsheet"].includes(toolName)) return "read";
  // These write only inside OpenCrewBot's own Files folder, like memory does.
  if (["make_chart", "save_report"].includes(toolName)) return "edit";
  // Composio: looking up actions is free; running them ("multi execute", the remote workbench) asks.
  if (toolName.startsWith("COMPOSIO_")) {
    return /SEARCH_TOOLS|GET_TOOL_SCHEMAS|MANAGE_CONNECTIONS/.test(toolName) ? "read" : "mcp";
  }
  if (toolName.startsWith("mcp_")) {
    const action = toolName.split("_").slice(2).join("_");
    return READ_ONLY_VERB.test(action) ? "read" : "mcp";
  }
  if (toolName.startsWith("memory_")) return "edit";
  if (toolName.startsWith("browser_")) {
    return /snapshot|screenshot|scroll|wait|tabs|close|get_|read|extract|console/.test(toolName) ? "read" : "execute";
  }
  return "other";
}

// ── the tool catalog (shown in Skills & Tools) ──────────────────────────

/**
 * Every built-in tool, for the Skills & Tools screen. `category` must equal what
 * toolCategory() returns for that name; tests/tools.test.ts checks this.
 */
export const TOOL_CATALOG: ToolInfo[] = [
  { name: "web_search", label: "Web search", description: "Searches the web and returns results with sources.", category: "read", enabledBy: "webSearch", needsKey: "TAVILY_API_KEY" },
  { name: "read_page", label: "Read page", description: "Reads the main content of one or more web pages.", category: "read", enabledBy: "webSearch", needsKey: "TAVILY_API_KEY" },
  { name: "crawl_site", label: "Crawl site", description: "Reads several pages of one website.", category: "read", enabledBy: "webSearch", needsKey: "TAVILY_API_KEY" },
  { name: "memory_add", label: "Save to memory", description: "Adds a durable fact to the bot's MEMORY.md.", category: "edit", enabledBy: "memory" },
  { name: "memory_edit", label: "Fix memory", description: "Corrects or removes a line in the bot's MEMORY.md.", category: "edit", enabledBy: "memory" },
  { name: "list_files", label: "List files", description: "Lists uploads, reports and charts in the shared Files folder.", category: "read", enabledBy: "files" },
  { name: "read_spreadsheet", label: "Read spreadsheet", description: "Reads a CSV: column types and summaries over all rows, plus the first rows.", category: "read", enabledBy: "files" },
  { name: "make_chart", label: "Make chart", description: "Draws a bar or line chart (SVG) into the Files folder.", category: "edit", enabledBy: "files" },
  { name: "save_report", label: "Save report", description: "Saves a Markdown report into the Files folder and returns its link.", category: "edit", enabledBy: "files" },
  { name: "load_skill", label: "Load skill", description: "Loads the full procedure of one of the bot's skills.", category: "read", enabledBy: "skills" },
  { name: CODE_MODE_TOOL, label: "Run code", description: "Runs TypeScript in a sandbox (no files, no network) that can call the bot's other tools; for exact maths.", category: "read", enabledBy: "codeMode" },
  { name: "browser_goto", label: "Browser actions", description: "Opens pages, clicks and types in a Browserbase cloud browser (browser_goto, browser_click, browser_type…).", category: "execute", enabledBy: "browser", needsKey: "BROWSERBASE_API_KEY" },
  { name: "browser_snapshot", label: "Browser reading", description: "Reads what the browser shows (snapshots, scrolling, tabs).", category: "read", enabledBy: "browser", needsKey: "BROWSERBASE_API_KEY" },
  { name: "ask_user", label: "Ask me", description: "Pauses and asks you a question with a card in chat.", category: "read", enabledBy: "askUser" },
  { name: "COMPOSIO_SEARCH_TOOLS", label: "Find app actions", description: "Looks up what a connected app (GitHub, Notion, Slack…) can do.", category: "read", enabledBy: "connections", needsKey: "COMPOSIO_API_KEY" },
  { name: "COMPOSIO_MULTI_EXECUTE_TOOL", label: "Run app actions", description: "Runs actions in connected apps: create an issue, send a message, add a page…", category: "mcp", enabledBy: "connections", needsKey: "COMPOSIO_API_KEY" },
];

// ── how tool calls look in chat ─────────────────────────────────────────

function host(url: unknown): string {
  try {
    return new URL(String(url)).host.replace(/^www\./, "");
  } catch {
    return String(url ?? "");
  }
}

/** "SLACK_SEND_MESSAGE" → "Slack: send message" */
function composioAction(slug: string): string {
  const [app, ...rest] = String(slug).toLowerCase().split("_");
  return `${app.charAt(0).toUpperCase()}${app.slice(1)}: ${rest.join(" ")}`;
}

export function toolLabel(name: string, args: unknown): { label: string; detail?: string } {
  const a = (args ?? {}) as Record<string, unknown>;
  if (name.startsWith("COMPOSIO_")) {
    if (/SEARCH_TOOLS/.test(name)) {
      const queries = Array.isArray(a.queries) ? a.queries.map((q) => (q as { use_case?: string })?.use_case ?? q) : [];
      return { label: "Looked up app actions", detail: queries.map(String).join(", ") || undefined };
    }
    if (/MULTI_EXECUTE/.test(name)) {
      const runs = Array.isArray(a.tools) ? a.tools.map((t) => composioAction((t as { tool_slug?: string })?.tool_slug ?? "")) : [];
      return { label: "Used connected apps", detail: runs.join(", ") || undefined };
    }
    return { label: composioAction(name.replace(/^COMPOSIO_/, "")) };
  }
  if (name.startsWith("mcp_")) {
    const [, id, ...rest] = name.split("_");
    return { label: `${mcpServerNames.get(id) ?? "MCP"}: ${rest.join(" ")}` };
  }
  switch (name) {
    case "web_search":
      return { label: "Searched the web", detail: String(a.query ?? "") };
    case "read_page": {
      const urls = Array.isArray(a.urls) ? a.urls : [a.urls ?? a.url];
      return { label: "Read", detail: urls.map(host).join(", ") };
    }
    case "crawl_site":
      return { label: "Crawled", detail: host(a.url) };
    case "memory_add":
      return { label: "Saved to memory", detail: String(a.note ?? "") };
    case "memory_edit":
      return { label: "Updated memory" };
    case CODE_MODE_TOOL:
      return { label: "Ran code" };
    case "ask_user":
      return { label: "Asked you" };
    case "load_skill":
      return { label: "Loaded skill", detail: String(a.skill ?? "") };
    case "list_files":
      return { label: "Listed files", detail: a.folder ? String(a.folder) : undefined };
    case "read_spreadsheet":
      return { label: "Read spreadsheet", detail: String(a.path ?? "") };
    case "make_chart":
      return { label: "Made a chart", detail: String(a.title ?? "") };
    case "save_report":
      return { label: "Saved a report", detail: String(a.title ?? "") };
    default:
      if (name.startsWith("browser_")) {
        const action = name.slice("browser_".length).replace(/_/g, " ");
        return { label: `Browser: ${action}`, detail: a.url ? host(a.url) : undefined };
      }
      return { label: name.replace(/_/g, " ") };
  }
}

export function toolSources(result: unknown): Source[] | undefined {
  const r = result as { results?: Array<{ title?: string; url?: string }> } | null;
  if (!r || !Array.isArray(r.results)) return undefined;
  const sources = r.results
    .filter((x) => typeof x?.url === "string")
    .map((x) => ({ title: x.title || host(x.url), url: x.url as string }));
  return sources.length ? sources.slice(0, 8) : undefined;
}

export function toolPreview(result: unknown): string | undefined {
  if (result === undefined || result === null) return undefined;
  if (typeof result === "string") return result.slice(0, 400);
  const r = result as Record<string, unknown>;
  if (typeof r.answer === "string" && r.answer) return r.answer.slice(0, 400);
  if (typeof r.error === "string") return r.error.slice(0, 400);
  if (typeof r.reason === "string") return r.reason.slice(0, 400);
  try {
    return JSON.stringify(result).slice(0, 400);
  } catch {
    return undefined;
  }
}
