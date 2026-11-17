// Types shared by the server and the browser. Everything here is plain JSON.

export type ApprovalMode = "ask" | "full";

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
}

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
  /** Connection ids this bot may use: `composio:<toolkit>` or `mcp:<serverId>`. */
  connections: string[];
  approval: ApprovalMode;
  pinned: boolean;
  createdAt: string;
}

export type BotInput = Omit<Bot, "id" | "createdAt" | "handle" | "connections"> & { handle?: string; connections?: string[] };

export type RoomResponder = "auto" | "lead" | "everyone";

export interface Room {
  id: string;
  name: string;
  topic: string;
  emoji: string;
  memberIds: string[];
  leadId: string | null;
  responder: RoomResponder;
  pinned: boolean;
  createdAt: string;
}

export type RoomInput = Omit<Room, "id" | "createdAt">;

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
  by: "mention" | "jev" | "lead" | "everyone" | "handoff";
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
  | { type: "connections-changed" };

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
}

/** Something a bot can be given access to. */
export interface ConnectionOption {
  id: string;
  name: string;
  kind: "composio" | "mcp";
  logo?: string;
}
