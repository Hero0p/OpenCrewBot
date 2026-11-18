// Actions in connected apps (GitHub, Notion, Slack, Gmail…) through Composio, as three tools
// whose permissions are decided per action:
//   find_app_actions  look up which action does what (Composio's search), with its inputs  → read
//   read_from_app     run an action that only reads (GET / LIST / SEARCH / FETCH …)         → read: no approval
//   act_in_app        run an action that changes something (create an issue, post a message) → "mcp": asks,
//                     per the bot's permission level, with a plain-words summary and the exact inputs.
// read_from_app refuses an action that isn't clearly a read, so a write can never slip past approval.
//
// They replace Composio's own meta tools (COMPOSIO_SEARCH_TOOLS / COMPOSIO_MULTI_EXECUTE_TOOL),
// which bundle reads and writes into one tool, so every read had to ask, or every write ran unasked.
//
// In mock mode the model is a script, so its "actions" aren't real requests: act_in_app then
// writes what it would have done to a report in the Files folder, labelled SIMULATED, and sends nothing.
import { createTool } from "@mastra/core/tools";
import type { ToolsInput } from "@mastra/core/agent";
import { z } from "zod";
import { isMock } from "./config";
import { actionInputSchema, composioSession, describeComposioError } from "./composio";
import { conversationIdOf } from "./request-context";
import { saveReport } from "./files";

/** The verbs (right after the app name) of actions that only read. Anything else counts as a change. */
const READ_VERB = /^[A-Z0-9]+_(GET|LIST|SEARCH|FETCH|FIND|READ|RETRIEVE|VIEW|DESCRIBE|QUERY|CHECK|COUNT)(_|$)/;
/** The most of an action's result handed back to the model. */
const MAX_RESULT_CHARS = 8_000;

/** @returns true when a Composio action slug (e.g. "GITHUB_LIST_REPOSITORY_ISSUES") only reads */
export function isReadAction(slug: string): boolean {
  return READ_VERB.test(slug.toUpperCase());
}

/** "GITHUB_CREATE_AN_ISSUE" → "github" */
export function appOfAction(slug: string): string {
  return slug.split("_")[0].toLowerCase();
}

/** "SLACK_SEND_MESSAGE" → "Slack: send message" */
export function actionLabel(slug: string): string {
  const [app, ...rest] = slug.toLowerCase().split("_");
  return `${app.charAt(0).toUpperCase()}${app.slice(1)}: ${rest.join(" ")}`;
}

function clipJson(value: unknown): string {
  const text = JSON.stringify(value ?? null);
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}… [cut to ${MAX_RESULT_CHARS} characters]` : text;
}

/** Refuse actions of apps this bot wasn't given, in words the model can act on. */
function checkApp(slug: string, apps: string[]): void {
  const app = appOfAction(slug);
  if (!apps.includes(app)) throw new Error(`"${slug}" belongs to ${app}, which isn't switched on for you. Your apps: ${apps.join(", ")}.`);
}

/** How many times one action may fail in one conversation (within FAILURE_WINDOW_MS) before the bot is told to stop. */
const MAX_FAILURES = 2;
const FAILURE_WINDOW_MS = 15 * 60_000;

/**
 * Read the inputs the model wrote as JSON text.
 * Inputs are JSON text, not an object field, because a free-form object reached the app empty: for Groq,
 * Mastra turns tool schemas into OpenAI "strict" schemas, where an object without listed fields can only
 * be {} (seen live: four Gmail sends approved and refused, each with "arguments": {}).
 * @throws Error saying how to write it, when it isn't a JSON object
 */
export function parseInputs(inputs: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(inputs.trim() || "{}");
  } catch {
    throw new Error('inputs must be JSON text for an object, e.g. {"recipient_email": "a@example.com", "subject": "Hi", "body": "Hello"}.');
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("inputs must be a JSON object (curly braces), not a list or a plain value.");
  return value as Record<string, unknown>;
}

type JsonSchema = { properties?: Record<string, { type?: unknown; description?: unknown }>; required?: unknown };

/** An action's inputs in a few words each, so the model uses the real field names. */
export function describeInputs(schema: unknown): { required: string[]; fields: Record<string, string> } | undefined {
  if (!schema || typeof schema !== "object") return undefined;
  const s = schema as JsonSchema;
  const fields: Record<string, string> = {};
  for (const [name, prop] of Object.entries(s.properties ?? {}).slice(0, 15)) {
    const type = typeof prop?.type === "string" ? prop.type : "value";
    const description = typeof prop?.description === "string" ? prop.description.replace(/\s+/g, " ").slice(0, 110) : "";
    fields[name] = description ? `${type}: ${description}` : type;
  }
  const required = Array.isArray(s.required) ? s.required.filter((r): r is string => typeof r === "string") : [];
  return { required, fields };
}

/**
 * The app tools for one bot.
 * @param apps - the Composio app slugs switched on for this bot, e.g. ["github", "notion"]
 */
export function appActionTools(apps: string[]): ToolsInput {
  const appEnum = apps as [string, ...string[]];
  let session: Awaited<ReturnType<typeof composioSession>> | null = null;
  // One Composio session per bot, created on first use.
  const getSession = async () => (session ??= await composioSession(apps));
  /** Action input schemas this bot has looked up, by slug. */
  const inputSchemas = new Map<string, unknown>();
  /** "<conversation>|<action>" → times it failed recently, to stop a model that keeps retrying a broken call. */
  const failures = new Map<string, number[]>();

  const inputsOf = async (slug: string) => {
    if (!inputSchemas.has(slug)) inputSchemas.set(slug, await actionInputSchema(slug).catch(() => undefined));
    return describeInputs(inputSchemas.get(slug));
  };

  const run = async (slug: string, args: Record<string, unknown>, conversationId: string) => {
    const key = `${conversationId}|${slug}`;
    const recent = (failures.get(key) ?? []).filter((at) => Date.now() - at < FAILURE_WINDOW_MS);
    if (recent.length >= MAX_FAILURES) {
      return { ok: false, stop: true, error: `${actionLabel(slug)} has already failed ${MAX_FAILURES} times here. Don't try it again: tell the person what went wrong and what you'd need from them.` };
    }
    try {
      const result = await (await getSession()).execute(slug, args);
      if (result.resultType !== "failed") return { ok: true, data: clipJson(result.data) };
      failures.set(key, [...recent, Date.now()]);
      // Hand back the real input fields, so the next call can be right first time.
      return { ok: false, error: result.error || `${actionLabel(slug)} failed.`, expectedInputs: await inputsOf(slug), triesLeft: MAX_FAILURES - recent.length - 1 };
    } catch (error) {
      throw new Error(describeComposioError(error));
    }
  };

  return {
    find_app_actions: createTool({
      id: "find_app_actions",
      description:
        "Find the app action that does what you need (e.g. 'send an email', 'list open issues in a repo'). Returns action names, whether each reads or changes something, and the exact input fields to use.",
      inputSchema: z.object({
        app: z.enum(appEnum).describe("Which app."),
        need: z.string().min(3).describe("What you want to do, in plain words."),
      }),
      execute: async ({ app, need }) => {
        if (isMock()) return { mock: true, note: "Mock mode: app actions can't be looked up. Nothing was sent to the app." };
        try {
          const found = await (await getSession()).search({ query: need, toolkits: [app] });
          for (const [slug, schema] of Object.entries(found.toolSchemas ?? {})) if (schema.inputSchema) inputSchemas.set(slug, schema.inputSchema);
          const results = await Promise.all(
            found.results.slice(0, 2).map(async (r) => ({
              useCase: r.useCase,
              actions: await Promise.all(
                [...r.primaryToolSlugs, ...r.relatedToolSlugs].slice(0, 4).map(async (slug, i) => ({
                  action: slug,
                  kind: isReadAction(slug) ? "reads (use read_from_app)" : "changes something (use act_in_app)",
                  // The inputs of the first two actions, so the model writes real field names instead of guessing.
                  inputs: i < 2 ? await inputsOf(slug) : undefined,
                })),
              ),
              guidance: r.executionGuidance?.slice(0, 500),
              pitfalls: r.knownPitfalls?.slice(0, 3),
            })),
          );
          return { results, error: found.error ?? undefined };
        } catch (error) {
          throw new Error(describeComposioError(error));
        }
      },
    }),
    read_from_app: createTool({
      id: "read_from_app",
      description: "Run an app action that only reads (its name has GET, LIST, SEARCH, FETCH… after the app). Runs without asking. For anything that changes something, use act_in_app.",
      inputSchema: z.object({
        action: z.string().min(3).describe('The action name from find_app_actions, e.g. "GITHUB_LIST_REPOSITORY_ISSUES".'),
        inputs: z.string().describe('The action\'s inputs as JSON text, with the field names find_app_actions gave, e.g. {"owner": "octocat", "repo": "hello-world"}.'),
      }),
      execute: async ({ action, inputs }, context) => {
        const slug = action.toUpperCase();
        if (!isReadAction(slug)) throw new Error(`${actionLabel(slug)} changes something, so it can't run here. Use act_in_app: it shows the person exactly what will happen first.`);
        checkApp(slug, apps);
        const args = parseInputs(inputs);
        if (isMock()) return { mock: true, note: "Mock mode: no live app data is read. Nothing was sent to the app." };
        return run(slug, args, conversationIdOf(context.requestContext) ?? "unknown");
      },
    }),
    act_in_app: createTool({
      id: "act_in_app",
      description:
        "Run an app action that changes something: send an email, create an issue, post a message, add a page. The person sees your summary and the exact inputs and approves first, unless you have full access. If they reject it, it never runs. If it fails twice, stop and tell the person.",
      inputSchema: z.object({
        action: z.string().min(3).describe('The action name, e.g. "GMAIL_SEND_EMAIL".'),
        inputs: z.string().describe('The action\'s inputs as JSON text, exactly as they\'ll be sent, with the field names find_app_actions gave, e.g. {"recipient_email": "a@example.com", "subject": "Hi", "body": "Hello"}.'),
        summary: z.string().min(5).describe('What will happen, in plain words, e.g. "Email a greeting to a@example.com".'),
      }),
      execute: async ({ action, inputs, summary }, context) => {
        const slug = action.toUpperCase();
        checkApp(slug, apps);
        const args = parseInputs(inputs);
        if (isMock()) {
          const saved = saveReport(`SIMULATED ${actionLabel(slug)}`, `# SIMULATED app action (mock mode)\n\nNothing was sent to the app.\n\n- **Action:** ${slug}\n- **Summary:** ${summary}\n- **Inputs:**\n\n\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\`\n`);
          return { simulated: true, note: `Mock mode: nothing was sent. What would have been done is saved in ${saved.path}.`, url: saved.url };
        }
        return run(slug, args, conversationIdOf(context.requestContext) ?? "unknown");
      },
    }),
  };
}

/** The line in "What you can do" for a bot with connected apps. */
export function appActionsCapability(apps: string[]): string {
  const names = apps.map((a) => a.charAt(0).toUpperCase() + a.slice(1)).join(", ");
  return `Use the person's connected apps (${names}): find_app_actions to find the right action, read_from_app to read (runs on its own), act_in_app to change something (the person approves first unless you have full access, and sees your summary). If an app isn't connected yet, say so and point them to Connections.`;
}
