# Testing evidence

How OpenCrewBot 2.0 was tested, what passed, and where the evidence is. Tested on 2026-11-18 (Windows 11, Node 22.16, Next.js 16.4, Mastra 1.76).

## Automated tests

`pnpm test`: **162 tests in 17 files, all passing** (as of 2026-11-19; 145 in 16 files on 2026-11-18, before the deployment tests). They run in mock mode with a temporary data folder and never read `.env`. `pnpm exec tsc --noEmit`, `pnpm lint` and `pnpm build` also pass.

| Requirement | Where | What is proven |
|---|---|---|
| **Rejected actions never run** | `tests/approval-enforcement.test.ts`, `tests/app-action-approval.test.ts` | In a real Mastra session, a rejected tool's code is never called, and an approved one runs once with the inputs shown. Through the whole app (Demo 7 path), a Slack post waits for approval with its exact inputs; rejected, nothing is posted and the audit log records `approval.rejected` then `tool.not_run`. |
| Permission levels | `tests/permissions.test.ts`, `tests/approval-trail.test.ts` | Ask first, Controlled (pre-approved kinds, daily limit) and Full access. Unclassified tools always ask. Secrets are redacted in previews, and restarts expire pending requests. |
| **Failure recovery** | `tests/engine.test.ts` | Retry with backoff, reassignment to a teammate with the same skill, continuing without a failed task, timeouts, cancel, and restart recovery (a restart doesn't use up an attempt). A failed final write-up posts the unedited results, and Retry reopens the plan. |
| **Loop limits** | `tests/collaboration.test.ts` | A forced A → B → A loop is refused and shown. Chain depth, repeat, per-pair, per-work and token limits hold. A room stops at 8 replies to one message, with 2 hand-offs per pair. Rooms resume after a restart. |
| **Memory** | `tests/memory.test.ts` | Provenance (who, when, why, where), scopes and hand edits. A taught preference reaches the next prompt, and a hand edit replaces it. |
| Planning, Agent Factory, scheduler, integrations, evidence | `tests/planning.test.ts`, `agent-factory`, `scheduler`, `integrations`, `evidence` | Plans checked in code and run end to end. Agents created from a description. Workflows with history, catch-up and failure reports. Reads run while changes ask. Exports labelled LIVE or SIMULATED, with account ids removed. |

## Live tests (real models)

All runs used a copy of the data. The models were free tiers: Gemini 3.5 Flash-Lite, with Groq and OpenRouter as fallbacks.

| Test | Result | Evidence |
|---|---|---|
| An agent asks a teammate to verify a claim (`ask_teammate`) | ✅ Quinn corrected Vega's claim, and Vega changed her answer | chat notices |
| Agent Factory: description → checked draft → create → chat | ✅ 15 s draft; usable at once | – |
| Room in review mode: the fact-checker reviews two answers | ✅ | – |
| Workflow: Run now twice; the second compares with the first | ✅ two reports in Files | report files |
| **Failure recovery:** a task fails → retried → reassigned; **server killed mid-run** → resumed → reassigned again → completed | ✅ | [`evidence/2026-11-18-run-study-abroad-counselling-platforms-research-plan-9d0854af.md`](../evidence/2026-11-18-run-study-abroad-counselling-platforms-research-plan-9d0854af.md) |
| **Demo 7 path:** an agent asks to post to Slack; rejected; never ran | ✅ `approval.requested` → `approval.rejected` → `tool.not_run` | [`evidence/2026-11-18-approvals-and-audit.md`](../evidence/2026-11-18-approvals-and-audit.md) |
| **Dry run, unseen business problem** (a Pune bakery subscription box): the Chief of Staff creates 2 agents and a room, plans, adapts to a new instruction mid-run, and follows a memory edit made mid-run | ✅ | [`evidence/2026-11-18-run-pune-bakery-subscription-box-launch-plan-c8e2e4b4.md`](../evidence/2026-11-18-run-pune-bakery-subscription-box-launch-plan-c8e2e4b4.md) |
| Interruption feeding a waiting task (`feeds`), findings shared between agents, final write-up failed on quota → **Retry** → completed | ✅ | [`evidence/2026-11-18-run-pune-bakery-demand-and-pricing-plan-7539a745.md`](../evidence/2026-11-18-run-pune-bakery-demand-and-pricing-plan-7539a745.md) |
| Room in parallel mode | ✅ three replies started in the same millisecond | – |

Testing found eight bugs, and all are fixed, each with a test. Among them: review credits triggering hand-offs, a restart using up an attempt, no way to feed a waiting task, a final deliverable that was only a link, duplicate agent names, new agents given a model with no quota, and account ids in evidence files.

## Known gaps

- **GitHub, Notion and Slack actions after approval were not run live on 2026-11-18.** The Composio API key in use was rejected (401). The approval gate in front of them was tested live. **On 2026-11-19, with a project API key, a Gmail send ran live on the deployment after approval, and the email arrived** (shown in the demo video). GitHub changes, Slack and Notion are still not run live.
- **Free-tier quotas limit live use:**
  - Gemini 2.5 Flash allows 20 requests a day.
  - OpenRouter's free models allow 50 a day.
  - Groq allows 8,000 tokens a minute, which is less than most agent requests.
  - See the README for model advice.
- **Covered by automated tests only:** room resume after a restart, workflow catch-up, and the 15-minute task timeout.
