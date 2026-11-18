// Step 15: evidence files for the demonstrations come from what the app recorded, and say LIVE or SIMULATED.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { EVIDENCE_DIR, exportAuditEvidence, exportRunEvidence, scrubForPublishing } from "@/lib/server/evidence";
import { boot, sendMessage } from "@/lib/server/service";
import { listBots, listRuns } from "@/lib/server/db";

beforeAll(async () => {
  await boot();
});

describe("evidence files", () => {
  it("writes a finished run with its timeline, tasks, outputs and the SIMULATED label (mock mode)", async () => {
    const morgan = (await listBots()).find((b) => b.handle === "morgan")!;
    const conversationId = `dm:${morgan.id}`;
    await sendMessage(conversationId, "Research the top 3 competitors of MeetUniversity and check the facts.");
    let run = (await listRuns()).find((r) => r.conversationId === conversationId);
    for (let i = 0; i < 300 && (!run || run.status === "running"); i++) {
      await new Promise((r) => setTimeout(r, 150));
      run = (await listRuns()).find((r) => r.conversationId === conversationId);
    }
    expect(run?.status).toBe("completed");
    const file = await exportRunEvidence(run!.id);
    expect(EVIDENCE_DIR).not.toContain(join("OpenCrewBot", "evidence"));
    const text = readFileSync(join(EVIDENCE_DIR, file), "utf8");
    expect(text).toContain("SIMULATED (mock model");
    expect(text).toContain("## Timeline");
    expect(text).toContain("## Final deliverable");
    expect(text).toContain("Research the request");
  }, 60_000);

  it("removes account identifiers before an evidence file can be published", () => {
    const error = "Request too large for model `openai/gpt-oss-120b` in organization `org_01jygcrthwfrfbn164kyj2twrq` service tier";
    expect(scrubForPublishing(error)).toContain("org_[removed]");
    expect(scrubForPublishing(error)).not.toContain("01jygcrthwfrfbn164kyj2twrq");
  });

  it("writes the approvals and audit log", async () => {
    const text = readFileSync(join(EVIDENCE_DIR, await exportAuditEvidence()), "utf8");
    expect(text).toContain("## Approval requests");
    expect(text).toContain("append-only");
  });
});
