// Who may use the app (Step 17: deployment).
//
// The app has one owner. Locally nothing changes: on localhost with no password set, it's yours,
// as before. Anywhere else (a deployment such as Render) it must not be open to whoever finds the
// URL, because bots hold your API keys and can act in your apps. So:
//   - with OPENCREWBOT_PASSWORD set, every page and API call needs a signed-in session cookie;
//   - served on another host WITHOUT a password, the app refuses to serve and says what to set
//     (misconfiguration fails loudly).
// The session cookie holds an HMAC of the password: it survives restarts, needs no session table,
// and every session ends when you change the password.
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "opencrewbot_session";
/** How long a sign-in lasts. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** These work without signing in: the sign-in page and its API, and the host's health check. */
const OPEN_PATHS = ["/login", "/api/auth/login", "/api/health"];

const digest = (key: string, text: string) => createHmac("sha256", key).update(text).digest();

/** The value of a valid session cookie for this password. */
export function sessionToken(password: string): string {
  return digest(password, "opencrewbot-session-v1").toString("hex");
}

/** Compare in constant time (both sides hashed to the same length first), so timing reveals nothing. */
function sameSecret(a: string, b: string): boolean {
  return timingSafeEqual(digest("opencrewbot-compare", a), digest("opencrewbot-compare", b));
}

export function passwordMatches(given: string, password: string): boolean {
  return sameSecret(given, password);
}

export function validSession(cookie: string | undefined, password: string): boolean {
  return Boolean(cookie) && sameSecret(cookie!, sessionToken(password));
}

export type AccessDecision =
  | { allow: true }
  | { allow: false; status: 401; reason: string; toLogin: boolean }
  | { allow: false; status: 503; reason: string };

/**
 * Decide whether a request may go through.
 * @param input.pathname - the request path
 * @param input.localHost - the request is addressed to localhost
 * @param input.password - OPENCREWBOT_PASSWORD, if set
 * @param input.session - the session cookie, if any
 */
export function decideAccess(input: { pathname: string; localHost: boolean; password?: string; session?: string }): AccessDecision {
  const { pathname, localHost, password, session } = input;
  if (OPEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return { allow: true };
  if (!password) {
    if (localHost) return { allow: true };
    return { allow: false, status: 503, reason: "OpenCrewBot is being served on a public address without a password. Set OPENCREWBOT_PASSWORD (in your host's environment settings) and restart." };
  }
  if (validSession(session, password)) return { allow: true };
  return { allow: false, status: 401, reason: "Sign in first.", toLogin: !pathname.startsWith("/api/") };
}

/** The password, decided in one place (empty counts as not set). */
export function configuredPassword(): string | undefined {
  return process.env.OPENCREWBOT_PASSWORD?.trim() || undefined;
}
