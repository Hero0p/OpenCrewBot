import { handle } from "@/lib/server/http";
import { testServer } from "@/lib/server/mcp-servers";
import { recordServerTest } from "@/lib/server/integrations";

/** Test an MCP server; the result becomes its LIVE / ERROR badge in Connections. */
export async function POST(_request: Request, ctx: RouteContext<"/api/connections/mcp/[id]/test">) {
  const { id } = await ctx.params;
  return handle(async () => {
    try {
      const result = await testServer(id);
      recordServerTest(id, { ok: true, tools: result.tools });
      return result;
    } catch (error) {
      recordServerTest(id, { ok: false, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  });
}
