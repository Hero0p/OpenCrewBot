// Opens libSQL clients for the app's tables and Mastra's store. Local files open as before; a hosted
// database (Turso, reached over HTTPS) gets one fix: a request that lands on a connection the server
// already closed is sent once more.
import { createClient, type Client } from "@libsql/client";
import type { DatabaseTarget } from "./config";

/** Error codes meaning "the server closed the connection under us": undici's (Node's fetch) and the OS's. */
const CLOSED_CONNECTION_CODES = new Set(["UND_ERR_SOCKET", "ECONNRESET"]);

/**
 * True when a request failed because the server had closed the connection it was sent on.
 * Other network failures (DNS, connection refused, timeout) mean the server can't be reached at all,
 * and an immediate second try wouldn't help, so they return false.
 * @param error what fetch rejected with; Node puts the reason in `cause` under a "fetch failed" TypeError
 */
export function isClosedConnection(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current !== null && typeof current === "object" && depth < 5; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && CLOSED_CONNECTION_CODES.has(code)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * fetch for the hosted database: a request that fails on a closed connection is sent once more,
 * on a new connection. Any other failure, and a second failure, is thrown as it is.
 *
 * Why: Node's fetch keeps connections open to reuse them. Turso can close one that sat idle (for example
 * while a plan's tasks ran for minutes) just as the app sends on it, and the request fails with
 * "fetch failed ← other side closed (UND_ERR_SOCKET)". Seen on the Render deployment, where it failed
 * a plan's final task.
 *
 * Sending it again is safe here: on a closed connection the request almost never reached the database.
 * If it did, the app's writes are keyed upserts (running one twice leaves the same row), and Mastra's
 * requests after the first in a stream carry a one-time token the database refuses to accept twice.
 * The rare repeat is an extra audit-log line.
 * @param request a standard Request, which is what libSQL's HTTP client passes
 */
export async function fetchWithReconnect(request: Request): Promise<Response> {
  const spare = request.clone(); // a request's body can be sent only once, so keep a copy for the second try
  try {
    return await fetch(request);
  } catch (error) {
    if (!isClosedConnection(error)) throw error;
    console.warn("[opencrewbot] the database closed a connection; sending the request again on a new one.");
    return fetch(spare);
  }
}

/**
 * A libSQL client for a database target. Hosted targets use {@link fetchWithReconnect};
 * a local `file:` target never uses fetch, so the option has no effect there.
 * @param target the URL and token from `resolveDatabases()`
 */
export function openDatabaseClient(target: DatabaseTarget): Client {
  return createClient({ url: target.url, authToken: target.authToken, fetch: fetchWithReconnect });
}
