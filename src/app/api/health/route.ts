import { connection } from "next/server";
import { handle } from "@/lib/server/http";

/**
 * For the host's health check (Render). Open without signing in, and says nothing about your data.
 * It boots the app, so a deployment that can't reach its database fails here, visibly.
 */
export async function GET() {
  await connection();
  return handle(async () => ({ ok: true }));
}
