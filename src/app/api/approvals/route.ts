import { connection } from "next/server";
import type { ApprovalsState } from "@/lib/shared/types";
import { handle } from "@/lib/server/http";
import { listApprovalsByStatus, listAudit } from "@/lib/server/db";

/** Everything the Approval Centre shows: requests waiting for you, recent decisions, and the audit log. */
export async function GET() {
  await connection();
  return handle(async (): Promise<ApprovalsState> => {
    const [pending, history, audit] = await Promise.all([
      listApprovalsByStatus(["pending"]),
      listApprovalsByStatus(["approved", "rejected", "expired"], 100),
      listAudit(300),
    ]);
    return { pending, history, audit };
  });
}
