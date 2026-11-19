// Types shared by the server and the browser. Everything here is plain JSON.

/**
 * How freely a bot may act. Lookups (search, reading pages) and the bot's own memory never ask.
 * - "ask": every action in another system (an app, an MCP server, a website) waits for your OK.
 * - "controlled": the kinds of action in `preapprovedActions` run on their own, up to
 *   `autoActionsPerDay` in any 24 hours; everything else asks.
 * - "full": every action runs without asking.
 * A tool nobody has classified always asks, at every level.
 */
export type ApprovalMode = "ask" | "controlled" | "full";

/**
 * Kinds of action that change something outside OpenCrewBot.
 * - "apps": connected apps (Composio) and MCP servers: sending messages, creating issues or pages…
 * - "browser": acting in the cloud browser: opening pages, clicking, typing.
 */
export type ActionGroup = "apps" | "browser";

export interface BotTools {
  /** Tavily search, extract and crawl. */
  webSearch: boolean;
  /** Read and update the bot's MEMORY.md. */
  memory: boolean;
  /** Let the model write one TypeScript function that calls several tools at once. */
  codeMode: boolean;
  /** A real browser (Playwright) the bot can drive. */
  browser: boolean;
  /** The bot may stop and ask you a question with a card in chat. */
  askUser: boolean;
  /** Shared files: read spreadsheets (CSV), make charts and save reports in the workspace's Files folder. */
  files: boolean;
  /** Plan and run team work: break a request into tasks for teammates (create_plan, update_plan, plan_status). For a Chief of Staff. */
  planning: boolean;
  /** Work with teammates: ask one a question, hand over a piece of work, get a claim verified, challenge a conclusion (ask_teammate), and share findings (share_finding). */
  teamwork: boolean;
}

/** What one agent asks of another with ask_teammate. */
export type CollabKind = "question" | "delegate" | "verify" | "challenge";

/** A company whose models OpenCrewBot can call. The facts about each one live in `shared/providers.ts`. */
export type ProviderId = "google" | "groq" | "openrouter" | "nebius";

/** Fixed facts about one model provider. */
export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** Env vars that can hold the API key, checked in this order. */
  keyEnvVars: readonly string[];
  /** Where to get a key. */
  signupUrl: string;
  /** Full model id used as the default for new bots, and as this provider's pick when it serves as a fallback. */
  recommendedModel: string;
}

/** A provider plus whether this server has a key for it. */
export interface ProviderStatus extends ProviderInfo {
  configured: boolean;
}

export interface Bot {
  id: string;
  name: string;
  /** Lowercase handle used for @mentions in rooms. */
  handle: string;
  title: string;
  description: string;
  instructions: string;
  emoji: string;
  color: string;
  /** Full model id, always "<provider>/<model>", e.g. "google/gemini-2.5-flash" or "groq/openai/gpt-oss-120b". */
  model: string;
  /**
   * Models to try, in order, when `model` fails (rate limit, outage, error).
   * When absent, the server uses one recommended model from every other provider that has a key.
   */
  fallbackModels?: string[];
  tools: BotTools;
  /** Skill ids (folders in skills/) this bot may load with the load_skill tool. */
  skills: string[];
  /** What the bot's answers should look like, e.g. "Markdown report with a comparison table and a sources list". Empty: no fixed format. */
  outputFormat: string;
  /** Connection ids this bot may use: `composio:<toolkit>` or `mcp:<serverId>`. */
  connections: string[];
  approval: ApprovalMode;
  /** Controlled access only: kinds of action that may run without asking. */
  preapprovedActions: ActionGroup[];
  /** Controlled access only: how many actions may run without asking in any 24 hours before it asks again. */
  autoActionsPerDay: number;
  pinned: boolean;
  createdAt: string;
}

export type BotInput = Omit<Bot, "id" | "createdAt" | "handle" | "connections" | "preapprovedActions" | "autoActionsPerDay" | "skills" | "outputFormat" | "fallbackModels"> & {
  handle?: string;
  connections?: string[];
  /** A list: try these after the bot's model. null: switch back to automatic fallbacks. Absent: keep as is. */
  fallbackModels?: string[] | null;
  preapprovedActions?: ActionGroup[];
  autoActionsPerDay?: number;
  skills?: string[];
  outputFormat?: string;
};

/** A reusable skill: a SKILL.md file in skills/<id>/. Agents load its procedure with load_skill when a task matches. */
export interface SkillSummary {
  /** The folder name, e.g. "competitor-analysis". */
  id: string;
  name: string;
  /** What the skill produces, in one or two sentences. */
  description: string;
  /** The kinds of request it fits; agents read this to decide whether to load it. */
  whenToUse: string;
  /** Tools the procedure uses. */
  tools: string[];
  /** The shape of the result. */
  output: string;
}

export interface Skill extends SkillSummary {
  /** The procedure and output template (the Markdown after the frontmatter). */
  body: string;
}

/** A SKILL.md that couldn't be read, and why. */
export interface SkillProblem {
  id: string;
  error: string;
}

/** What the Skills & Tools screen loads. */
export interface SkillsState {
  skills: SkillSummary[];
  problems: SkillProblem[];
  tools: ToolInfo[];
}

/** One built-in tool, as listed in the Skills & Tools screen. */
export interface ToolInfo {
  name: string;
  label: string;
  description: string;
  /** Mastra approval category; decides whether it asks (see permissions.ts). */
  category: "read" | "edit" | "execute" | "mcp" | "other";
  /** The bot setting that turns it on. */
  enabledBy: keyof BotTools | "skills" | "connections";
  /** Env var the tool needs, if any. */
  needsKey?: string;
}

/**
 * The memory layers. Each is one editable Markdown file.
 * - agent: one bot's own notes (data/workspaces/<botId>/MEMORY.md)
 * - user: your preferences, shared by every bot
 * - project: facts about one project (e.g. the business you're working on), shared by every bot while it's the active project
 * - decisions: important decisions, shared by every bot
 * - room: shared by the members of one room
 * - history: what one run (team plan) did, written by the execution engine
 */
export type MemoryScope = "agent" | "user" | "project" | "decisions" | "room" | "history";

/** Which memory file: the scope, plus an id for scopes that have many files. */
export type MemoryKeyInput = { scope: "user" } | { scope: "decisions" } | { scope: "agent" | "project" | "room" | "history"; id: string };

/** Why, when and by whom a memory line was written. Stored as an HTML comment at the end of the line. */
export interface Provenance {
  by: string;
  when: string;
  why: string;
  /** Where it happened, e.g. "chat with Iris" or "room Market Intelligence". */
  in: string;
}

/** One memory file, as listed in the Memory Manager. */
export interface MemoryFileInfo {
  /** "agent:<botId>", "user", "project:<slug>", "decisions", "room:<roomId>" or "history:<runId>". */
  key: string;
  scope: MemoryScope;
  title: string;
  /** Where the file is inside the data folder (OPENCREWBOT_DATA_DIR), e.g. "memory/user.md". Never an absolute path. */
  path: string;
  exists: boolean;
  /** Bullet lines in the file. */
  entries: number;
  modifiedAt?: string;
}

/** One line of a memory file with its provenance, if it has one. */
export interface MemoryEntry {
  text: string;
  provenance?: Provenance;
}

/** A project's memory file, and whether it's the active project. */
export interface ProjectInfo {
  slug: string;
  name: string;
  active: boolean;
}

/** A file in the shared Files folder (uploads, reports, charts). */
export interface FileEntry {
  /** Path inside the Files folder, with forward slashes, e.g. "uploads/sales.csv". */
  path: string;
  size: number;
  modifiedAt: string;
}

export type RoomResponder = "auto" | "lead" | "everyone";

/**
 * How the bots chosen to answer one room message work together:
 * sequential: one after another, each seeing the answers before it ·
 * parallel: all at the same time, independently ·
 * review: they answer one after another, then the room's fact-checker reviews the answers and challenges weak claims.
 */
export type RoomMode = "sequential" | "parallel" | "review";

export interface Room {
  id: string;
  name: string;
  topic: string;
  emoji: string;
  memberIds: string[];
  leadId: string | null;
  responder: RoomResponder;
  /** Rooms saved before Step 10 have none: they work sequentially. */
  mode?: RoomMode;
  pinned: boolean;
  createdAt: string;
}

export type RoomInput = Omit<Room, "id" | "createdAt">;

/**
 * One room message being answered: who still has to answer, how many replies it has had.
 * Saved after every reply, so a restart can pick up where the room left off (rooms.ts).
 */
export interface RoomRound {
  /** The person's message this round answers. */
  id: string;
  roomId: string;
  status: "running" | "done";
  /** Bots still to answer, in order. */
  queue: RoomTurn[];
  /** Bots answering right now (put back at the front of the queue after a restart). */
  current: RoomTurn[];
  /** Replies so far, counted against the room's limit. */
  turns: number;
  /** Hand-offs per pair of bots ("idA|idB", sorted), counted against the pair limit. */
  pairs: Record<string, number>;
  /** Review mode: the fact-checker's review has been queued. */
  reviewed: boolean;
  createdAt: string;
}

export interface RoomTurn {
  botId: string;
  route: RouteNote;
  /** Hand-off hops from the person's message: 0 for the first answers. */
  depth: number;
}

/** `dm:<botId>` or `room:<roomId>`. */
export type ConversationId = string;

export interface Source {
  title: string;
  url: string;
}

export type ToolStatus = "running" | "awaiting-approval" | "done" | "error" | "denied";

export type Part =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
  | {
      kind: "tool";
      toolCallId: string;
      name: string;
      label: string;
      detail?: string;
      status: ToolStatus;
      preview?: string;
      sources?: Source[];
      /** The tool only pretended (mock mode): e.g. an app action written to Files instead of sent. */
      simulated?: boolean;
    }
  | {
      kind: "question";
      toolCallId: string;
      question: string;
      options: { label: string; description?: string }[];
      answer?: string;
    };

export type MessageStatus = "streaming" | "done" | "error" | "stopped";

export interface RouteNote {
  by: "mention" | "jev" | "lead" | "everyone" | "handoff" | "review" | "resume";
  confidence?: number;
}

export interface ChatMessage {
  id: string;
  conversationId: ConversationId;
  role: "user" | "bot" | "notice";
  botId?: string;
  createdAt: string;
  status: MessageStatus;
  parts: Part[];
  /** The model that actually answered ("mock" in mock mode). */
  model?: string;
  /** Set when a fallback answered: the bot's own model, which failed. */
  fallbackFrom?: string;
  usage?: { input: number; output: number; costUsd: number | null };
  route?: RouteNote;
  error?: string;
}

export interface ConversationSummary {
  id: ConversationId;
  lastMessage?: { text: string; createdAt: string; author: string };
  running: string[];
  unread: number;
}

export interface ModelOption {
  /** Full model id: "<provider>/<model>". */
  id: string;
  label: string;
  provider: ProviderId;
  providerLabel: string;
  context: number;
  tools: boolean;
  reasoning: boolean;
  vision: boolean;
  /** List price in $ per 1M tokens (null when unknown). Free-tier usage is billed $0. */
  inputPerM: number | null;
  outputPerM: number | null;
  /** True when the row came from the provider's live catalog rather than the built-in list. */
  live: boolean;
  /** True when this server has a key for the model's provider. */
  available: boolean;
}

/** Why bots are on the scripted mock model: forced by OPENCREWBOT_MOCK_MODE, or no provider key is set. */
export type MockReason = "forced" | "no-provider-key";

export interface AppStatus {
  mock: boolean;
  /** Null when bots use real models. */
  mockReason: MockReason | null;
  providers: ProviderStatus[];
  /** The model new bots start with. */
  defaultModel: string;
  keys: { tavily: boolean; jev: boolean; browserbase: boolean; composio: boolean };
  dataDir: string;
  /** "hosted": the databases are on Turso and the data folder's files are copied into them (a deployment). */
  storage: "local" | "hosted";
  /** OPENCREWBOT_PASSWORD is set, so the app needs signing in (and offers Sign out). */
  signIn: boolean;
}

/** Where an approval request stands. "expired" means it can no longer be decided (restart, Stop); the action did not run. */
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

/** One request from a bot to run an action, as shown in the Approval Centre. */
export interface ApprovalRecord {
  id: string;
  /** Mastra's id for the parked tool call this request belongs to. */
  toolCallId: string;
  botId: string;
  conversationId: ConversationId;
  toolName: string;
  /** Readable summary, e.g. "Slack: send message". */
  label: string;
  /** The exact arguments the action would run with, as JSON, with secrets redacted. */
  argsPreview: string;
  status: ApprovalStatus;
  requestedAt: string;
  decidedAt?: string;
  /** Why it left "pending": "you", or the reason it expired. */
  decidedBy?: string;
}

/** What an audit log row records. Rows are only ever added, never changed or deleted. */
export type AuditEvent =
  | "approval.requested"
  | "approval.approved"
  | "approval.rejected"
  | "approval.expired"
  /** The tool ran without asking, because its policy allowed it. */
  | "tool.ran_auto"
  /** The tool ran after you approved it. */
  | "tool.ran_approved"
  /** The tool was stopped before it ran (rejected, or the run was stopped). */
  | "tool.not_run"
  /** A controlled-access bot used up its daily allowance; its actions ask again. */
  | "limit.reached";

export interface AuditEntry {
  id: number;
  at: string;
  event: AuditEvent;
  botId: string;
  conversationId: ConversationId;
  toolName?: string;
  toolCallId?: string;
  /** Mastra's approval category for the tool: read, edit, execute, mcp or other. */
  toolCategory?: string;
  /** Extra facts in plain words, e.g. "succeeded" or "failed: timeout". */
  detail?: string;
}

// ── runs and tasks (the execution engine, engine.ts) ────────────────────

/** A run is one team plan being carried out. It ends when every task has ended. */
export type RunStatus = "running" | "completed" | "failed" | "cancelled";

/** Something the engine did, in plain words, for the run's timeline. */
export interface RunEvent {
  at: string;
  text: string;
  /** The task it's about, if any. */
  taskKey?: string;
}

export interface Run {
  id: string;
  title: string;
  /** The person's request, as the planner understood it. */
  goal: string;
  /** Where it was started; progress notices and the final deliverable are posted there. */
  conversationId: ConversationId;
  /** The agent that planned it (the Chief of Staff); it also writes the final deliverable. */
  plannerBotId: string;
  /** The active project when the run started (its memory is shared with every task). */
  project: string | null;
  status: RunStatus;
  createdAt: string;
  completedAt?: string;
  /** The final deliverable: the output of the run's final task. */
  result?: string;
  error?: string;
  events: RunEvent[];
  /** Intermediate results teammates shared with share_finding; every task that starts later sees them. */
  findings?: SharedFinding[];
  /** True when the run used the mock model: its outputs are SIMULATED, not real work. */
  simulated?: boolean;
}

/** A recurring job (Module I): an instruction sent to an agent on a schedule. */
export interface Workflow {
  id: string;
  name: string;
  /** What the agent is asked each time, e.g. "Check MeetUniversity's competitors and report what changed." */
  instruction: string;
  /** Who runs it: usually the Chief of Staff, who can turn it into a team plan. */
  botId: string;
  /** When it runs, as a cron expression, e.g. "0 9 * * 1" (Mondays at 09:00, server time). */
  schedule: string;
  /** False while paused. */
  enabled: boolean;
  createdAt: string;
  /** When it runs next (from the schedule); empty while paused. */
  nextRunAt?: string;
  lastRunAt?: string;
}

export type WorkflowInput = Pick<Workflow, "name" | "instruction" | "botId" | "schedule" | "enabled">;

/**
 * One execution of a workflow. trigger: "schedule" (on time), "catch-up" (it was due while
 * the app was off; missed runs are made up once, not once per missed slot) or "manual" (Run now).
 */
export interface WorkflowRun {
  id: string;
  workflowId: string;
  trigger: "schedule" | "catch-up" | "manual";
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  /** Where the agent worked ("workflow:<runId>"): its transcript. */
  conversationId: ConversationId;
  /** Set when the agent turned the instruction into a team plan. */
  planRunId?: string;
  result?: string;
  error?: string;
  /** The result as a report in the Files folder. */
  reportPath?: string;
  /** True when it ran on the mock model: the result is SIMULATED. */
  simulated: boolean;
}

/** One intermediate result an agent shared with the rest of the team. */
export interface SharedFinding {
  by: string;
  text: string;
  at: string;
}

/**
 * pending: waiting for its dependencies or a free slot · running · completed · failed: gave up after its retries
 * · cancelled: you (or the planner) cancelled it. While running, a task may also be waiting for your approval;
 * that shows as a pending approval for its conversation ("task:<id>").
 */
export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface Task {
  id: string;
  runId: string;
  /** Short id the planner gave it, used for dependencies, e.g. "research". */
  key: string;
  title: string;
  /** What the agent must do. */
  brief: string;
  expectedOutput: string;
  /** The skill this task needs, if the planner named one. */
  skill?: string;
  agentId: string;
  /** Keys of tasks whose results this one needs. It starts once they have all ended. */
  dependsOn: string[];
  /** The run's last task: the planner consolidates everything into the final deliverable. */
  isFinal: boolean;
  status: TaskStatus;
  /** How many times it has started (retries included). */
  attempt: number;
  maxAttempts: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  output?: string;
  error?: string;
  /** Agents that already failed this task, so a reassignment picks someone else. */
  triedAgentIds: string[];
  /** A retry waits until this time (backoff). */
  notBefore?: string;
}

/** One row of the Task Dashboard's run list. */
export interface RunSummary {
  run: Run;
  tasks: { total: number; completed: number; running: number; failed: number; cancelled: number };
}

/** A run with its tasks, as the Task Dashboard shows it. */
export interface RunDetail {
  run: Run;
  tasks: Task[];
  /** Task ids currently waiting for your approval. */
  waitingForApproval: string[];
}

/** What the Approval Centre loads. */
export interface ApprovalsState {
  /** Waiting for you, newest first. */
  pending: ApprovalRecord[];
  /** Decided or expired, newest first. */
  history: ApprovalRecord[];
  /** Newest first. */
  audit: AuditEntry[];
}

/** Events the server pushes to the browser over one SSE stream. */
export type ServerEvent =
  | { type: "message"; message: ChatMessage }
  | { type: "delta"; conversationId: ConversationId; messageId: string; partIndex: number; kind: "text" | "reasoning"; delta: string }
  | { type: "running"; conversationId: ConversationId; botIds: string[] }
  | { type: "bots-changed" }
  | { type: "rooms-changed" }
  | { type: "memory-changed"; botId: string }
  /** A bot's Browserbase live view opened (url) or closed (null). */
  | { type: "browser-session"; botId: string; liveUrl: string | null }
  | { type: "connections-changed" }
  /** An approval was requested or decided, or the audit log grew. */
  | { type: "approvals-changed" }
  /** A run or one of its tasks changed. */
  | { type: "runs-changed"; runId: string }
  /** A shared memory file changed (agent memory also sends memory-changed). */
  | { type: "memory-files-changed"; key: string }
  /** A workflow or one of its runs changed. */
  | { type: "workflows-changed" };

/** An app from Composio's catalog, with this install's connection state. */
export interface ComposioApp {
  slug: string;
  name: string;
  logo?: string;
  connected: boolean;
}

/** A remote MCP server you added. The token never leaves the server. */
export interface McpServer {
  id: string;
  name: string;
  url: string;
  hasToken: boolean;
  headerNames: string[];
}

export interface ConnectionsState {
  composio: { enabled: boolean; apps: ComposioApp[]; error?: string };
  mcpServers: McpServer[];
  /** Every integration with its real state (integrations.ts), for the LIVE / NOT CONNECTED badges. */
  statuses: IntegrationStatus[];
  /** Mock mode: app changes are SIMULATED (saved to Files, never sent). */
  mock: boolean;
}

export type IntegrationState = "live" | "not-connected" | "not-configured" | "error" | "untested";

export interface IntegrationStatus {
  /** "composio:<slug>" or "mcp:<serverId>", the same ids bots use in `connections`. */
  id: string;
  name: string;
  via: "Composio" | "MCP";
  state: IntegrationState;
  /** What the state means and what to do next, in plain words. */
  detail: string;
  /** The bots that have it switched on. */
  usedBy: string[];
}

/** Something a bot can be given access to. */
export interface ConnectionOption {
  id: string;
  name: string;
  kind: "composio" | "mcp";
  logo?: string;
}
