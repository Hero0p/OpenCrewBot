/** A mistake in what the person asked for; API routes turn it into a 400. */
export class InputError extends Error {}

/**
 * An error in words, including the reasons it wraps. Node's fetch fails with just "fetch failed"
 * and keeps the real reason in `cause` (DNS lookup failed, connection refused or timed out, TLS),
 * sometimes as an AggregateError of one try per address. Seen on the Render deployment, where
 * every reply said only "fetch failed".
 * @returns e.g. "fetch failed ← connect ETIMEDOUT 142.250.1.95:443 (ETIMEDOUT)"
 */
export function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 5; depth++) {
    if (typeof current !== "object") {
      parts.push(String(current));
      break;
    }
    const e = current as { message?: unknown; code?: unknown; errors?: unknown; cause?: unknown };
    const message = typeof e.message === "string" ? e.message : "";
    const code = typeof e.code === "string" && !message.includes(e.code) ? ` (${e.code})` : "";
    const text = `${message}${code}`.trim();
    if (text && !parts.includes(text)) parts.push(text);
    // An AggregateError (one failed try per address) has no cause of its own: follow its first error.
    current = e.cause ?? (Array.isArray(e.errors) ? e.errors[0] : undefined);
  }
  return parts.join(" ← ") || "unknown error";
}
