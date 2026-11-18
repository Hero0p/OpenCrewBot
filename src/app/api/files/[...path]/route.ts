import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { FileAccessError, safeFilePath } from "@/lib/server/files";

/**
 * Serve one file from the Files folder, e.g. a chart for an <img> in chat.
 * Only files inside the Files folder can be reached (safeFilePath). SVGs are served
 * with a policy that blocks scripts, and Markdown/CSV as plain text, so a file can't
 * run code in the app's page.
 */
const CONTENT_TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".csv": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export async function GET(_request: Request, ctx: RouteContext<"/api/files/[...path]">) {
  const { path } = await ctx.params;
  const relativePath = path.map(decodeURIComponent).join("/");
  let absolute: string;
  try {
    absolute = safeFilePath(relativePath);
  } catch (error) {
    const message = error instanceof FileAccessError ? error.message : "Bad path.";
    return Response.json({ error: message }, { status: 400 });
  }
  const contentType = CONTENT_TYPES[extname(absolute).toLowerCase()];
  if (!contentType) return Response.json({ error: "That type of file isn't served." }, { status: 415 });
  try {
    const body = await readFile(absolute);
    return new Response(body, {
      headers: {
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    // Missing or unreadable file: say so instead of a server error.
    return Response.json({ error: `There is no file "${relativePath}".` }, { status: 404 });
  }
}
