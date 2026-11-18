// App storage: bots, rooms, and the chat transcript the UI shows. Mastra keeps
// its own store (mastra.db) for each bot's model-facing thread history.
import { createClient, type Client } from "@libsql/client";
import { APP_DB_URL } from "./config";
import { DEFAULT_AUTO_ACTIONS_PER_DAY } from "./permissions";
import type { ApprovalRecord, ApprovalStatus, AuditEntry, AuditEvent, Bot, ChatMessage, ConversationId, Room } from "@/lib/shared/types";

// Cached across hot reloads, together with the file it points at, so a
// changed database path opens a fresh connection instead of reusing one
// bound to a file that has moved.
const g = globalThis as unknown as { __opencrewbotDb?: { url: string; schema?: number; client: Promise<Client> } };

/** Bump when a table is added, so a hot-reloaded server re-runs the CREATE statements. */
const SCHEMA_VERSION = 3;

async function open(): Promise<Client> {
  const db = createClient({ url: APP_DB_URL });
  await db.batch(
    [
      "CREATE TABLE IF NOT EXISTS bots (id TEXT PRIMARY KEY, data TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, data TEXT NOT NULL)",
      `CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        data TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS messages_by_conversation ON messages (conversation_id, created_at)",
      "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, data TEXT NOT NULL)",
      `CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        generation INTEGER NOT NULL DEFAULT 0,
        last_read_at TEXT
      )`,
      // One row per approval request; the full ApprovalRecord is in `data`.
      `CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        tool_call_id TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        status TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        data TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS approvals_by_status ON approvals (status, requested_at)",
      // Append-only: this file has no function that updates or deletes audit rows.
      `CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        event TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        tool_name TEXT,
        tool_call_id TEXT,
        tool_category TEXT,
        detail TEXT
      )`,
      "CREATE INDEX IF NOT EXISTS audit_by_bot_and_time ON audit_log (bot_id, at)",
    ],
    "write",
  );
  return db;
}

export function db(): Promise<Client> {
  const cached = g.__opencrewbotDb;
  if (cached?.url === APP_DB_URL && cached.schema === SCHEMA_VERSION) return cached.client;
  // Close the old connection (an older build cached the bare promise).
  const stale = cached && "client" in cached ? cached.client : (cached as unknown as Promise<Client> | undefined);
  void stale?.then((c) => c.close()).catch(() => {});
  const client = open();
  g.__opencrewbotDb = { url: APP_DB_URL, schema: SCHEMA_VERSION, client };
  return client;
}

// ── settings (small JSON values) ────────────────────────────────────────

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const rows = await (await db()).execute({ sql: "SELECT data FROM settings WHERE key = ?", args: [key] });
  return rows.rows[0] ? (JSON.parse(String(rows.rows[0].data)) as T) : undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await (await db()).execute({
    sql: "INSERT INTO settings (key, data) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data",
    args: [key, JSON.stringify(value)],
  });
}

// ── bots ────────────────────────────────────────────────────────────────

/** Fill in fields added after a bot was saved, so older rows keep working. */
function normalizeBot(raw: Bot): Bot {
  return {
    ...raw,
    connections: raw.connections ?? [],
    preapprovedActions: raw.preapprovedActions ?? [],
    autoActionsPerDay: raw.autoActionsPerDay ?? DEFAULT_AUTO_ACTIONS_PER_DAY,
  };
}

export async function listBots(): Promise<Bot[]> {
  const rows = await (await db()).execute("SELECT data FROM bots");
  return rows.rows
    .map((r) => normalizeBot(JSON.parse(String(r.data)) as Bot))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getBot(id: string): Promise<Bot | null> {
  const rows = await (await db()).execute({ sql: "SELECT data FROM bots WHERE id = ?", args: [id] });
  return rows.rows[0] ? normalizeBot(JSON.parse(String(rows.rows[0].data)) as Bot) : null;
}

export async function saveBot(bot: Bot): Promise<void> {
  await (await db()).execute({
    sql: "INSERT INTO bots (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
    args: [bot.id, JSON.stringify(bot)],
  });
}

export async function deleteBotRow(id: string): Promise<void> {
  await (await db()).execute({ sql: "DELETE FROM bots WHERE id = ?", args: [id] });
}

// ── rooms ───────────────────────────────────────────────────────────────

export async function listRooms(): Promise<Room[]> {
  const rows = await (await db()).execute("SELECT data FROM rooms");
  return rows.rows
    .map((r) => JSON.parse(String(r.data)) as Room)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getRoom(id: string): Promise<Room | null> {
  const rows = await (await db()).execute({ sql: "SELECT data FROM rooms WHERE id = ?", args: [id] });
  return rows.rows[0] ? (JSON.parse(String(rows.rows[0].data)) as Room) : null;
}

export async function saveRoom(room: Room): Promise<void> {
  await (await db()).execute({
    sql: "INSERT INTO rooms (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
    args: [room.id, JSON.stringify(room)],
  });
}

export async function deleteRoomRow(id: string): Promise<void> {
  await (await db()).execute({ sql: "DELETE FROM rooms WHERE id = ?", args: [id] });
}

// ── messages ────────────────────────────────────────────────────────────

export async function saveMessage(message: ChatMessage): Promise<void> {
  await (await db()).execute({
    sql: `INSERT INTO messages (id, conversation_id, created_at, data) VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    args: [message.id, message.conversationId, message.createdAt, JSON.stringify(message)],
  });
}

export async function listMessages(conversationId: ConversationId, limit = 200): Promise<ChatMessage[]> {
  const rows = await (await db()).execute({
    sql: `SELECT data FROM (
            SELECT data, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?
          ) ORDER BY created_at ASC`,
    args: [conversationId, limit],
  });
  return rows.rows.map((r) => JSON.parse(String(r.data)) as ChatMessage);
}

export async function clearMessages(conversationId: ConversationId): Promise<void> {
  await (await db()).execute({ sql: "DELETE FROM messages WHERE conversation_id = ?", args: [conversationId] });
}

/** The newest message per conversation, for sidebar previews. */
export async function lastMessages(): Promise<Map<ConversationId, ChatMessage>> {
  const rows = await (await db()).execute(
    `SELECT m.data FROM messages m
     JOIN (SELECT conversation_id, MAX(created_at) AS latest FROM messages GROUP BY conversation_id) l
       ON m.conversation_id = l.conversation_id AND m.created_at = l.latest`,
  );
  const out = new Map<ConversationId, ChatMessage>();
  for (const r of rows.rows) {
    const m = JSON.parse(String(r.data)) as ChatMessage;
    out.set(m.conversationId, m);
  }
  return out;
}

export async function unreadCounts(): Promise<Map<ConversationId, number>> {
  const rows = await (await db()).execute(
    `SELECT m.conversation_id AS id, COUNT(*) AS n FROM messages m
     LEFT JOIN conversations c ON c.id = m.conversation_id
     WHERE m.created_at > COALESCE(c.last_read_at, '') AND m.data NOT LIKE '%"role":"user"%'
     GROUP BY m.conversation_id`,
  );
  return new Map(rows.rows.map((r) => [String(r.id), Number(r.n)]));
}

export async function markRead(conversationId: ConversationId): Promise<void> {
  await (await db()).execute({
    sql: `INSERT INTO conversations (id, last_read_at) VALUES (?, ?)
          ON CONFLICT(id) DO UPDATE SET last_read_at = excluded.last_read_at`,
    args: [conversationId, new Date().toISOString()],
  });
}

// ── approvals ───────────────────────────────────────────────────────────

export async function saveApproval(record: ApprovalRecord): Promise<void> {
  await (await db()).execute({
    sql: `INSERT INTO approvals (id, tool_call_id, bot_id, conversation_id, status, requested_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data`,
    args: [record.id, record.toolCallId, record.botId, record.conversationId, record.status, record.requestedAt, JSON.stringify(record)],
  });
}

export async function getApproval(id: string): Promise<ApprovalRecord | null> {
  const rows = await (await db()).execute({ sql: "SELECT data FROM approvals WHERE id = ?", args: [id] });
  return rows.rows[0] ? (JSON.parse(String(rows.rows[0].data)) as ApprovalRecord) : null;
}

/** The pending request for one parked tool call, if there is one. */
export async function findPendingApproval(conversationId: ConversationId, botId: string, toolCallId: string): Promise<ApprovalRecord | null> {
  const rows = await (await db()).execute({
    sql: "SELECT data FROM approvals WHERE conversation_id = ? AND bot_id = ? AND tool_call_id = ? AND status = 'pending'",
    args: [conversationId, botId, toolCallId],
  });
  return rows.rows[0] ? (JSON.parse(String(rows.rows[0].data)) as ApprovalRecord) : null;
}

/** Approvals with the given status, newest first. */
export async function listApprovalsByStatus(statuses: ApprovalStatus[], limit = 100): Promise<ApprovalRecord[]> {
  const placeholders = statuses.map(() => "?").join(", ");
  const rows = await (await db()).execute({
    sql: `SELECT data FROM approvals WHERE status IN (${placeholders}) ORDER BY requested_at DESC LIMIT ?`,
    args: [...statuses, limit],
  });
  return rows.rows.map((r) => JSON.parse(String(r.data)) as ApprovalRecord);
}

// ── audit log (append-only) ─────────────────────────────────────────────

export type NewAuditEntry = Omit<AuditEntry, "id" | "at">;

export async function appendAudit(entry: NewAuditEntry): Promise<void> {
  await (await db()).execute({
    sql: `INSERT INTO audit_log (at, event, bot_id, conversation_id, tool_name, tool_call_id, tool_category, detail)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      new Date().toISOString(),
      entry.event,
      entry.botId,
      entry.conversationId,
      entry.toolName ?? null,
      entry.toolCallId ?? null,
      entry.toolCategory ?? null,
      entry.detail ?? null,
    ],
  });
}

/** The newest audit rows first. */
export async function listAudit(limit = 200): Promise<AuditEntry[]> {
  const rows = await (await db()).execute({ sql: "SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", args: [limit] });
  return rows.rows.map((r) => ({
    id: Number(r.id),
    at: String(r.at),
    event: String(r.event) as AuditEvent,
    botId: String(r.bot_id),
    conversationId: String(r.conversation_id),
    toolName: r.tool_name === null ? undefined : String(r.tool_name),
    toolCallId: r.tool_call_id === null ? undefined : String(r.tool_call_id),
    toolCategory: r.tool_category === null ? undefined : String(r.tool_category),
    detail: r.detail === null ? undefined : String(r.detail),
  }));
}

/** How many actions (in the given categories) a bot ran without asking since a point in time. */
export async function countAutoRunsSince(botId: string, categories: readonly string[], sinceIso: string): Promise<number> {
  const placeholders = categories.map(() => "?").join(", ");
  const rows = await (await db()).execute({
    sql: `SELECT COUNT(*) AS n FROM audit_log
          WHERE bot_id = ? AND event = 'tool.ran_auto' AND tool_category IN (${placeholders}) AND at >= ?`,
    args: [botId, ...categories, sinceIso],
  });
  return Number(rows.rows[0]?.n ?? 0);
}

/** Bumped by "Clear chat" so each bot starts a fresh model-side thread. */
export async function conversationGeneration(conversationId: ConversationId): Promise<number> {
  const rows = await (await db()).execute({
    sql: "SELECT generation FROM conversations WHERE id = ?",
    args: [conversationId],
  });
  return rows.rows[0] ? Number(rows.rows[0].generation) : 0;
}

export async function bumpGeneration(conversationId: ConversationId): Promise<number> {
  await (await db()).execute({
    sql: `INSERT INTO conversations (id, generation) VALUES (?, 1)
          ON CONFLICT(id) DO UPDATE SET generation = generation + 1`,
    args: [conversationId],
  });
  return conversationGeneration(conversationId);
}
