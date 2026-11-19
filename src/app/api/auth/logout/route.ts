import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/server/access";

/** Sign out on this browser. */
export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
