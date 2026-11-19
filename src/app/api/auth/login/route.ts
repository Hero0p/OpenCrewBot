import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, configuredPassword, passwordMatches, sessionToken } from "@/lib/server/access";

/** Failed attempts per address in the last 15 minutes, to slow down password guessing. */
const g = globalThis as unknown as { __opencrewbotLoginFailures?: Map<string, number[]> };
const failures = (g.__opencrewbotLoginFailures ??= new Map());
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 10;

/** Sign in: `{ password }` → sets the session cookie. Wrong passwords are slowed down and, after 10 in 15 minutes, refused. */
export async function POST(request: Request) {
  const password = configuredPassword();
  if (!password) return NextResponse.json({ error: "Sign-in isn't switched on: OPENCREWBOT_PASSWORD isn't set." }, { status: 503 });

  const who = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const recent = (failures.get(who) ?? []).filter((at: number) => Date.now() - at < WINDOW_MS);
  if (recent.length >= MAX_FAILURES) return NextResponse.json({ error: "Too many wrong passwords. Wait 15 minutes and try again." }, { status: 429 });

  const body = (await request.json().catch(() => ({}))) as { password?: unknown };
  if (typeof body.password !== "string" || !passwordMatches(body.password, password)) {
    failures.set(who, [...recent, Date.now()]);
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ error: "Wrong password." }, { status: 401 });
  }
  failures.delete(who);
  const https = request.headers.get("x-forwarded-proto") === "https" || new URL(request.url).protocol === "https:";
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, sessionToken(password), { httpOnly: true, sameSite: "lax", secure: https, path: "/", maxAge: SESSION_MAX_AGE_SECONDS });
  return response;
}
