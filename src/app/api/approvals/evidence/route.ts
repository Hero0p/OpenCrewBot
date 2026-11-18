import { handle } from "@/lib/server/http";
import { exportAuditEvidence } from "@/lib/server/evidence";

/** Save the approval history and the audit log as an evidence file in the evidence folder. */
export async function POST() {
  return handle(async () => ({ file: await exportAuditEvidence() }));
}
