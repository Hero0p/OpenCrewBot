import type {
  AppStatus,
  ApprovalRecord,
  ApprovalsState,
  Bot,
  BotInput,
  ChatMessage,
  ComposioApp,
  ConnectionsState,
  ConversationId,
  ConversationSummary,
  FileEntry,
  McpServer,
  MemoryEntry,
  MemoryFileInfo,
  ProjectInfo,
  ModelOption,
  Room,
  RoomInput,
  RunDetail,
  RunSummary,
  Skill,
  SkillsState,
  Workflow,
  WorkflowInput,
  WorkflowRun,
} from "@/lib/shared/types";

/** A workflow as the Workflows screen gets it: with its latest runs and whether one is in progress. */
export type WorkflowWithRuns = Workflow & { runs: WorkflowRun[]; running: boolean };

async function call<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.json !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const conv = (id: ConversationId) => `/api/conversations/${encodeURIComponent(id)}`;

export interface Bootstrap {
  status: AppStatus;
  bots: Bot[];
  rooms: Room[];
  conversations: ConversationSummary[];
  models: ModelOption[];
  /** botId → Browserbase live view URL for bots with an open browser. */
  liveViews: Record<string, string>;
}

export const api = {
  bootstrap: () => call<Bootstrap>("/api/bootstrap"),
  models: (refresh = false) => call<{ models: ModelOption[] }>(`/api/models${refresh ? "?refresh=1" : ""}`),
  createBot: (input: BotInput, memoryNotes: string[] = []) => call<{ bot: Bot }>("/api/bots", { method: "POST", json: { ...input, memoryNotes } }),
  /** Agent Factory: a checked draft from a description (not saved). */
  draftAgent: (description: string) =>
    call<{ draft: { input: BotInput; memoryNotes: string[]; notes: string[]; simulated: boolean } }>("/api/bots/draft", { method: "POST", json: { description } }),
  updateBot: (id: string, patch: Partial<BotInput>) => call<{ bot: Bot }>(`/api/bots/${id}`, { method: "PATCH", json: patch }),
  deleteBot: (id: string) => call(`/api/bots/${id}`, { method: "DELETE" }),
  getMemory: (id: string) => call<{ content: string; path: string; limit: { lines: number; bytes: number } }>(`/api/bots/${id}/memory`),
  saveMemory: (id: string, content: string) => call<{ content: string }>(`/api/bots/${id}/memory`, { method: "PUT", json: { content } }),
  createRoom: (input: RoomInput) => call<{ room: Room }>("/api/rooms", { method: "POST", json: input }),
  updateRoom: (id: string, patch: Partial<RoomInput>) => call<{ room: Room }>(`/api/rooms/${id}`, { method: "PATCH", json: patch }),
  deleteRoom: (id: string) => call(`/api/rooms/${id}`, { method: "DELETE" }),
  messages: (id: ConversationId) => call<{ messages: ChatMessage[]; running: string[] }>(`${conv(id)}/messages`),
  send: (id: ConversationId, text: string) => call<{ message: ChatMessage }>(`${conv(id)}/messages`, { method: "POST", json: { text } }),
  approve: (id: ConversationId, botId: string, toolCallId: string, approve: boolean) =>
    call(`${conv(id)}/approval`, { method: "POST", json: { botId, toolCallId, approve } }),
  answer: (id: ConversationId, botId: string, toolCallId: string, answer: string) =>
    call(`${conv(id)}/answer`, { method: "POST", json: { botId, toolCallId, answer } }),
  stop: (id: ConversationId) => call(`${conv(id)}/stop`, { method: "POST" }),
  clear: (id: ConversationId) => call(`${conv(id)}/clear`, { method: "POST" }),
  read: (id: ConversationId) => call(`${conv(id)}/read`, { method: "POST" }),
  connections: () => call<ConnectionsState>("/api/connections"),
  searchApps: (q: string) => call<{ apps: ComposioApp[] }>(`/api/connections/composio/search?q=${encodeURIComponent(q)}`),
  connectApp: (slug: string) => call<{ redirectUrl: string }>("/api/connections/composio/connect", { method: "POST", json: { slug } }),
  disconnectApp: (slug: string) => call("/api/connections/composio/disconnect", { method: "POST", json: { slug } }),
  connectionsChanged: () => call("/api/connections/changed", { method: "POST" }),
  addMcpServer: (input: { name: string; url: string; token?: string; headers?: Record<string, string> }) =>
    call<{ server: McpServer }>("/api/connections/mcp", { method: "POST", json: input }),
  removeMcpServer: (id: string) => call(`/api/connections/mcp/${id}`, { method: "DELETE" }),
  testMcpServer: (id: string) => call<{ tools: number }>(`/api/connections/mcp/${id}/test`, { method: "POST" }),
  skills: () => call<SkillsState>("/api/skills"),
  skill: (id: string) => call<{ skill: Skill }>(`/api/skills/${encodeURIComponent(id)}`),
  files: () => call<{ files: FileEntry[] }>("/api/files"),
  uploadFile: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return call<{ path: string }>("/api/files", { method: "POST", body: form });
  },
  memoryFiles: () => call<{ files: MemoryFileInfo[]; projects: ProjectInfo[] }>("/api/memory"),
  memoryFile: (key: string) => call<{ key: string; path: string; content: string; entries: MemoryEntry[] }>(`/api/memory/file?key=${encodeURIComponent(key)}`),
  saveMemoryFile: (key: string, content: string) => call<{ content: string }>("/api/memory/file", { method: "PUT", json: { key, content } }),
  createProject: (name: string) => call<{ slug: string }>("/api/memory/projects", { method: "POST", json: { name, activate: true } }),
  setActiveProject: (slug: string | null) => call("/api/memory/projects", { method: "PUT", json: { slug } }),
  runs: () => call<{ runs: RunSummary[] }>("/api/runs"),
  run: (id: string) => call<RunDetail>(`/api/runs/${id}`),
  cancelRun: (id: string) => call(`/api/runs/${id}/cancel`, { method: "POST" }),
  cancelTask: (id: string) => call(`/api/tasks/${id}/cancel`, { method: "POST" }),
  retryTask: (id: string) => call(`/api/tasks/${id}/retry`, { method: "POST" }),
  saveRunEvidence: (id: string) => call<{ file: string }>(`/api/runs/${id}/evidence`, { method: "POST" }),
  saveAuditEvidence: () => call<{ file: string }>("/api/approvals/evidence", { method: "POST" }),
  workflows: () => call<{ workflows: WorkflowWithRuns[] }>("/api/workflows"),
  createWorkflow: (input: WorkflowInput) => call<{ workflow: Workflow }>("/api/workflows", { method: "POST", json: input }),
  updateWorkflow: (id: string, patch: Partial<WorkflowInput>) => call<{ workflow: Workflow }>(`/api/workflows/${id}`, { method: "PATCH", json: patch }),
  deleteWorkflow: (id: string) => call(`/api/workflows/${id}`, { method: "DELETE" }),
  runWorkflow: (id: string) => call<{ run: WorkflowRun }>(`/api/workflows/${id}/run`, { method: "POST" }),
  approvals: () => call<ApprovalsState>("/api/approvals"),
  decideApproval: (id: string, approve: boolean) => call<{ approval: ApprovalRecord }>(`/api/approvals/${id}`, { method: "POST", json: { approve } }),
};
