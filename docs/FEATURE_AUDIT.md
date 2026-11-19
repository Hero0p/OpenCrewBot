# Feature Audit: original OpenCrewBot vs. OpenCrewBot 2.0

This document records what the original OpenCrewBot already did before we
changed anything, and how each part is being extended. It is updated at the end
of every development step.

- **Original source:** [Studio1-OSS/OpenCrewBot](https://github.com/Studio1-OSS/OpenCrewBot), MIT licence, © 2026 Studio1HQ
- **Audited commit:** `4784e3a` ("Add MIT license")
- **Audit date:** 2026-11-18
- **How it was audited:**
  1. Read all 64 source files in `src/` (about 6,200 lines).
  2. Checked the installed Mastra 1.76 package and its bundled docs.
  3. Ran the original typecheck (`pnpm exec tsc --noEmit`) and lint (`pnpm lint`). Both pass.
  4. Ran the app in mock mode and chatted with a bot.

**Status legend**

| Mark | Meaning |
|---|---|
| ✅ Implemented | Works in the original code |
| 🟡 Partial | Something exists, but it doesn't meet the assignment's requirement |
| 🎭 Mocked | Simulated; no real service behind it |
| ❌ Missing | Not in the original at all |

---

## 1. The original at a glance

| | |
|---|---|
| **What it is** | A chat app where every contact is an AI bot with its own model, tools and memory. Bots can be put together in group rooms. |
| **Stack** | Next.js 16 (App Router), React 19, TypeScript, Tailwind 4 |
| **Agent framework** | [Mastra](https://mastra.ai) 1.76 (`@mastra/core`, Apache-2.0): `Agent` + `AgentController` run the model/tool loop, sessions, tool approvals and "ask the user" pauses |
| **Models** | Nebius Token Factory only (open-source models) |
| **Storage** | libSQL/SQLite: `data/opencrewbot.db` (bots, rooms, messages, settings) and `data/mastra.db` (Mastra's thread history). Memory: `data/workspaces/<botId>/MEMORY.md` |
| **Live updates** | One Server-Sent Events stream (`/api/events`) fed by an in-process event bus (`bus.ts`) |
| **External services** | Tavily (web search), Browserbase (cloud browser), Composio (connected apps), remote MCP servers, Jev by TypeSafe (room routing) |
| **Tests** | None. There is no test script or test files; the README describes manual checks done with the mock model. *(OpenCrewBot 2.0 adds a Vitest suite in Step 3.)* |

### How one message flows through the original code

Knowing this path is the key to extending the app safely.

```
Browser                         Server
───────                         ──────
ChatView: you type "hello"
  └─ POST /api/conversations/dm:<botId>/messages
                                └─ service.sendMessage()          saves your message, publishes it
                                   ├─ direct chat → runtime.runTurn()
                                   └─ room        → rooms.runRoom() decides who answers
                                                     (@mention / Jev / lead / everyone),
                                                     then calls runTurn() for each bot in turn
                                runtime.runTurn()                 queues one turn per (conversation, bot)
                                └─ executeTurn()
                                   ├─ runtimeFor(bot)             builds a Mastra Agent: system prompt
                                   │                               (prompt.ts, includes MEMORY.md),
                                   │                               model ("nebius/<model>" or the mock),
                                   │                               tools (tools.ts + connectors.ts)
                                   ├─ sessionFor()                sets approval policy per tool category
                                   └─ session.sendMessage()       Mastra runs the model ⇄ tool loop
                                      events: text-delta, tool_start, tool_approval_required, tool_end …
                                      └─ TurnFolder.handle()      folds events into one ChatMessage
                                         └─ bus.publish()  ──SSE──▶ store.ts reducer ─▶ UI re-renders
Approve/Deny card clicked
  └─ POST /api/conversations/<id>/approval
                                └─ runtime.respondToApproval() → session.respondToToolApproval()
```

---

## 2. Feature inventory by assignment module

### Module A: Intelligent Chief of Staff
| Requirement | Original status | Evidence | What we add |
|---|---|---|---|
| Agent routing | 🟡 Partial | `rooms.ts` `decideResponders()`: @mention → Jev → room lead → everyone | ✅ **Step 5 + 9:** Morgan, the Chief of Staff, leads the 5 workforce rooms. Quick questions it answers itself; team work becomes a plan (`planning.ts`) |
| Understands requests, breaks them into tasks | ❌ Missing | Atlas (the "Planning" seed bot) only *writes* a plan as chat text; nothing executes it | ✅ **Step 9:** `create_plan` tool: tasks with a brief, expected output, owner (@handle), skill and dependencies, run by the engine |
| Picks agents by capability | 🟡 Partial | Jev picks the best *single responder* from bot descriptions; this is not task assignment | ✅ **Step 9:** the planner sees the team roster with roles and skills; the plan is checked in code (unknown teammate, planner assigned to itself, owner lacking the skill: the error names who has it) |
| Dependencies, parallel tasks | ❌ Missing | Room bots run strictly one after another (`while (queue.length)` loop) | ✅ **Step 8:** `engine.ts` runs every task whose dependencies have ended, up to `OPENCREWBOT_MAX_PARALLEL_TASKS` at once; cycles are rejected |
| Monitoring, failure handling | ❌ Missing | A failed turn just ends with an error message | ✅ **Step 8:** retry with backoff, then hand-off to a teammate with the same skill, timeout, cancel; progress notices in the chat; `plan_status` and `update_plan` for the planner |
| Consolidated final deliverable | ❌ Missing | — | ✅ **Step 8-9:** every run ends with a final task for the planner, in its output format; posted where the run started and saved in run history |

### Module B: Dynamic agent creation
| Requirement | Original status | Evidence | What we add |
|---|---|---|---|
| Create agents without editing code | ✅ Implemented | "New bot" form (`BotForms.tsx`) → stored in the `bots` table | Keep |
| Create agents from natural language | ❌ Missing | Form only | ✅ **Step 11:** Agent Factory (`agent-factory.ts`): a description → a drafted, code-checked agent (skills from the library, model from our tier list, memory on, no browser/planning, at most Controlled) → reviewed in the New bot form → created with stamped starting memory. The Chief of Staff's `create_agent` / `create_room` do it inside a plan (agents start on Ask first) |
| Name, role, persona, model, tools | ✅ Implemented | `Bot` type in `types.ts`: name, title, description, instructions, model, tools | Kept; new **Files and charts** tool switch |
| Memory | ✅ Implemented | Every bot gets its own `MEMORY.md` | Extend (memory layers step) |
| Skills | ❌ Missing | No skills concept | ✅ **Step 5-6:** `Bot.skills` (ids from `skills/`), chosen per bot in the form |
| Permissions | 🟡 Partial | One switch per bot: `approval: "ask" \| "full"` | ✅ Step 4: three levels |
| Expected output format | ❌ Missing | — | ✅ **Step 5:** `Bot.outputFormat`, part of the system prompt |
| Fallback models | ❌ Missing | One model per bot | ✅ Step 2 + **Step 5:** "Automatic" or "Choose my own" ordered list in the bot form |
| A ready-made team | 🟡 Partial | 3 seeded bots (Scout, Quill, Atlas) | ✅ **Step 5:** 10-agent workforce led by a Chief of Staff (`workforce.ts`), seeded once on new and existing installs |

### Module C: Multi-agent collaboration
| Requirement | Original status | Evidence | What we add |
|---|---|---|---|
| Rooms | ✅ Implemented | `rooms` table, `RoomForms.tsx`, one seeded room ("Studio") | ✅ **Step 5:** 5 more rooms, each led by the Chief of Staff (Market Intelligence, Marketing Campaign, Business Analysis, Dev Team, Operations) |
| Delegation between agents | 🟡 Partial | A bot can @mention a teammate in its reply; up to 2 hops (`MAX_HANDOFF_DEPTH = 2`) | 🟡 **Step 9:** the planner delegates as plan tasks. A message that @mentions the planner goes to it alone, and a reply that started or changed a plan creates no @mention hand-offs (seen live: without this, teammates did their task twice, once as a task and once in the room). ✅ **Step 10:** `ask_teammate` with kind `delegate` hands a teammate a piece of work and waits for the result |
| Ask questions / share research / challenge / request verification | ❌ Missing | Only free-text @mentions; no structured message types | ✅ **Step 10:** `ask_teammate` (question, delegate, verify, challenge: the teammate answers in its own `collab:` conversation and the answer returns to the asker) and `share_finding` (intermediate outputs; in a plan, later tasks get them in their brief). Every exchange is posted where the work is visible and on the run's history. Rooms in **review** mode: the fact-checker challenges weak claims and the author defends or revises |
| Parallel collaboration | ❌ Missing | Sequential only | ✅ **Step 8-10:** a plan's independent tasks run at the same time; rooms have a mode: **one by one** (sequential), **in parallel** (the first answers start together) or **with review** |
| Resume after interruption | 🟡 Partial | The transcript survives a restart, but in-flight turns are marked "Interrupted by a server restart" and never resumed (`service.ts` `sweepInterrupted()`) | 🟡 **Step 8:** team runs resume: on start, `recoverRuns()` puts interrupted tasks back in the queue (plain chat turns still don't resume). The planner can change a running plan with `update_plan`. ✅ **Step 10:** rooms resume too: each message being answered is saved after every reply (`room_rounds`), and after a restart the bots still to answer do (`resumeRoomRounds`) |
| Loop prevention | 🟡 Partial | Hop limit of 2 and no duplicate bot in the queue. No turn budget, no cost budget, no cycle detection beyond that | ✅ **Step 8 + 10:** plans: cycle check, at most 8 tasks, one active plan per conversation. Teammate requests (`checkExchange`): chains at most 3 deep, no asking back up the chain, no repeated question, 3 per pair and 12 per piece of work, a token budget (`OPENCREWBOT_COLLAB_TOKEN_BUDGET`). Rooms: 8 replies per message, 2 hand-offs per pair. Tested with a forced loop (`tests/collaboration.test.ts`) |
| Shared room context | 🟡 Partial | Each bot gets the last ≤30 room lines it hasn't seen (`catchUp()`); there is no shared room memory | ✅ **Step 7:** room memory file (`data/memory/rooms/<roomId>.md`) read by every bot in the room and by tasks started there |

### Module D: Autonomous task execution
| Requirement | Original status | Evidence | What we add |
|---|---|---|---|
| Execution engine | ❌ Missing | — (Mastra's built-in `task_*`, `submit_plan` and `subagent` tools are explicitly disabled in `runtime.ts`) | ✅ **Step 8:** `engine.ts`: runs and tasks in SQLite (`runs`, `tasks` tables); every change is saved before the next step, so the database is the truth. Each task is a normal agent turn in its own conversation (`task-runner.ts`), with the agent's tools, skills, memory and permission level |
| Visible task plan | ❌ Missing | — | ✅ **Step 8:** the planner reports the plan step by step in the chat; **Tasks and runs** panel shows every task on a timeline |
| Task ID, agent, dependencies, status, times, outputs, errors, approvals | ❌ Missing | — | ✅ **Step 8:** all on the `Task` record and in the panel; "Needs your approval" when a task's action waits in the Approval Centre |
| Retries / timeouts / recovery | ❌ Missing | — | ✅ **Step 8:** 2 attempts per agent with a 5 s / 20 s wait, then a teammate with the same skill; per-attempt timeout; restart recovery. If the final write-up fails, the task results are posted unedited and retrying the final task reopens the plan |
| Cancellation | 🟡 Partial | **Stop** button aborts the conversation's running turns (`stopConversation()`, "stop epoch") | ✅ **Step 8:** cancel one task (its dependants carry on without it) or the whole run; retry a failed task |
| Execution history | 🟡 Partial | Chat transcripts only | ✅ **Step 8:** past runs in the panel (with each task's transcript), plus a Markdown history file per run in `data/memory/history/` |

### Module E: Persistent memory
| Requirement | Original status | Evidence | What we add |
|---|---|---|---|
| Markdown memory | ✅ Implemented | `memory-files.ts`: one `MEMORY.md` per bot, atomic writes | Kept; `memory-files.ts` is now generic file helpers, `memory-layers.ts` knows the layers |
| Individual agent memory | ✅ Implemented | `memory_add` / `memory_edit` tools | ✅ **Step 7:** same tools, now with a `scope` (`mine`, `user`, `project`, `decisions`, `room`) and a required `why` |
| Shared room memory | ❌ Missing | — | ✅ **Step 7:** `data/memory/rooms/<roomId>.md` |
| Project memory | ❌ Missing | — | ✅ **Step 7:** `data/memory/projects/<slug>.md`, one active project (MeetUniversity seeded), switchable in the Memory Manager |
| User preferences / decisions (shared) | ❌ Missing | Only inside each bot's own file | ✅ **Step 7:** `user.md` and `decisions.md`, read by every bot every turn |
| Historical task context | ❌ Missing | — | ✅ **Step 8:** `data/memory/history/<runId>.md` per run; the planner also sees its last finished plan's result |
| User can read and edit memory | ✅ Implemented | Memory tab in the inspector; `GET/PUT /api/bots/<id>/memory` | ✅ **Step 7:** **Memory Manager** for every file (`/api/memory`, `/api/memory/file`); run history is read-only |
| Survives restart | ✅ Implemented | Plain files on disk; re-read on **every** model call (`prompt.ts` is called per call) | Kept for every layer (the shared files are read in the agent's instructions function) |
| Edits apply immediately | ✅ Implemented | Same reason as above | Kept; the prompt says a hand edit wins over the bot's own memory of a conversation |
| Provenance (what, when, why) | 🟡 Partial | `memory_add` appends the date only: `- note _(2026-11-17)_` | ✅ **Step 7:** every entry is stamped `<!-- by: … \| when: … \| why: … \| in: … -->`; corrections restamp the line; hand edits are stamped "by: you". Stamps are shown in the Memory Manager and stripped from prompts |
| Secret redaction | ✅ Implemented | `redactSecrets()` strips keys/tokens before writing | Keep |

### Module F: Skills and tools
| Requirement | Original status | Evidence | What we add |
|---|---|---|---|
| Reusable skills (8 required) | ❌ Missing | 0 skills | ✅ **Step 6:** 11 skills in `skills/*/SKILL.md` (the 8 required + content calendar, report consolidation, fact-check), each with procedure, output template and quality checks |
| Dynamic skill loading | ❌ Missing | — | ✅ **Step 6:** the prompt lists only skill descriptions; the `load_skill` tool returns the full procedure. Observed live: an agent called `load_skill` first and answered in the skill's output template |
| Tool ecosystem | ✅ Implemented | `tools.ts`: web search / read page / crawl (Tavily), memory, Code Mode, browser, ask-user | ✅ **Step 6:** + `list_files`, `read_spreadsheet`, `make_chart`, `save_report`, `load_skill`; web tools rebuilt on the Tavily SDK with small schemas (see findings 12-13); tool catalog with permission behaviour |
| Code execution sandbox | ✅ Implemented | Code Mode: TypeScript in a QuickJS WebAssembly sandbox, no filesystem/network, 60 s timeout, 128 MB | Reused: code can call `read_spreadsheet` / `make_chart` for exact calculations |
| MCP | ✅ Implemented | Add remote MCP servers by URL + token (`mcp-servers.ts`) | Keep |
| Spreadsheet / chart / report tools | ❌ Missing | — | ✅ **Step 6:** shared Files folder (`files.ts`, `charts.ts`), upload in the UI, safe file serving |

### Module G: Human approval and autonomy
| Requirement | Original status | Evidence | What we add |
|---|---|---|---|
| Three permission levels | 🟡 Partial | Two levels: **Ask first** and **Full access** | ✅ **Step 4:** **Ask first / Controlled / Full access**. Controlled pre-approves kinds of action (app actions, browser actions) up to a limit per 24 hours (`permissions.ts`) |
| Approval before sensitive actions | ✅ Implemented | Mastra pauses the tool call until **Allow once / Deny**; Deny means the tool never runs | Kept. **Proven by test** with a real Mastra session (`tests/approval-enforcement.test.ts`). The model is now told a rejection happened, so it adapts instead of retrying |
| Action preview | 🟡 Partial | The card shows the action name (e.g. "Slack: send message"), not the full payload (message text, recipient) | ✅ **Step 4:** the Approval Centre shows the exact arguments as JSON, with secrets redacted |
| Approval centre | ❌ Missing | Approval cards exist only inline in each chat | ✅ **Step 4:** Waiting / History / Audit log tabs; sidebar badge with the waiting count. Chat cards and the Approval Centre go through the same recorded decision |
| Tool-level permissions | 🟡 Partial | Per *category* (read / edit / execute / mcp / other), not per tool | 🟡 **Step 4:** per kind of action (app actions vs browser actions) per bot, with a daily limit. Per individual app action (e.g. only "create issue") comes with Step 12, when app actions become separate tools |
| Audit log | ❌ Missing | — | ✅ **Step 4:** append-only `audit_log` table: every request, decision, expiry, tool run (with or without asking, or not run) and limit hit |
| Cancellation | ✅ Implemented | Stop button | Kept. Stopping while a request waits now expires the request (logged) |
| Secure credentials | ✅ Implemented | Keys in `.env` (git-ignored), never sent to the browser; Composio holds app OAuth tokens. ⚠️ MCP server tokens are stored unencrypted in the `settings` table | Kept; argument previews and audit text pass through secret redaction |
| Pending approval survives restart | 🟡 Partial | No; approvals live in the Mastra session in memory. After a restart the card is marked denied (fails safe) | 🟡 **Step 4:** still not resumable, but now recorded: on startup every pending request is marked **expired (server restart)** in the database and audit log; its action never ran |
| Unclassified tools | ⚠️ Risk | `toolCategory()` returns `"other"` for unknown tools, and `runtime.ts` **allowed** `"other"` | ✅ **Step 3:** `"other"` now **asks at every permission level**, including full access |
| An approval that doesn't reach the bot | ⚠️ Risk | `respondToApproval` ignored Mastra's `{ accepted: false }` result, so an "Allow" could silently go nowhere | ✅ **Step 4:** checked; the request is marked expired and the error is shown |

### Module H: Integrations
| Requirement | Original status | Evidence | What we add |
|---|---|---|---|
| Integration architecture | ✅ Implemented | Composio (one key, OAuth sign-in per app, 1,000+ apps) + remote MCP servers; per-bot switches | Keep |
| 3 working integrations | 🟡 Partial | Code exists, but the original README says *"Still to verify with live services: Composio sign-in and app actions"* | 🟡 **Step 12:** app actions rebuilt as `find_app_actions` / `read_from_app` (reads run) / `act_in_app` (changes ask, with a summary and the exact inputs), replacing Composio's meta tools, which mixed reads and writes in one tool. **Not yet verified live:** on 2026-11-18 Composio rejected the configured `COMPOSIO_API_KEY` (401 Invalid API key); a project API key is needed. GitHub's official MCP server (preset) is the Composio-free route |
| Live vs mocked labels | ❌ Missing | — | ✅ **Step 12 + 14:** Connections shows each integration as LIVE / NOT CONNECTED / NOT CONFIGURED / NOT WORKING / UNTESTED (`integrations.ts`); mock mode simulates app changes (a SIMULATED report in Files, nothing sent); SIMULATED badges on mock replies, tool steps, runs and workflow runs |

### Module I: Scheduled workflows
| Requirement | Original status | Evidence | What we add |
|---|---|---|---|
| Automation engine, schedules, history, pause/resume, failure reports | ❌ Missing | Listed only as an idea in the README ("Add scheduled routines with Mastra schedules") | ✅ **Step 13:** `scheduler.ts` (cron via the `croner` library): workflows with Run now, pause / resume, history (status, trigger, duration, result, report file, transcript), the previous result handed to each run, catch-up of a run missed while the app was off, failure reports in the agent's chat, runs cut off by a restart marked failed. A workflow run can become a team plan. **Workflows** screen; the Chief of Staff's `schedule_workflow` |

### Module J: Multi-model intelligence
| Requirement | Original status | Evidence | What we add |
|---|---|---|---|
| Multiple providers | ❌ Missing | **Hard-coded to Nebius**: `runtime.ts` line 105 builds `nebius/<model>`; `config.ts` mock mode = "no Nebius key"; `models.ts` only fetches Nebius's catalog | ✅ **Step 2:** Google Gemini, Groq, OpenRouter and Nebius through Mastra's model router. Model ids are `<provider>/<model>`; provider facts live in `shared/providers.ts`, keys in `server/providers.ts`. Existing bots are migrated once to `nebius/…` |
| Model per agent | ✅ Implemented | `bot.model`, changeable from the model picker without restart | Kept; the picker now spans all providers and greys out providers without a key |
| Task-based routing | ❌ Missing | README: "coming soon" | Planned (Chief of Staff step) |
| Fallback models | ❌ Missing | — | ✅ **Step 2:** `server/model-chain.ts`. Each bot has an ordered chain: its model, then `bot.fallbackModels` or (by default) the recommended model of every other provider with a key. Mastra retries each model once, then moves on. A Mastra processor records which model actually answered; the reply shows "fallback for …" |
| Local endpoints | ❌ Missing | — | Planned (optional: Ollama) |
| Token / cost tracking | 🟡 Partial | Tokens and $ cost shown on every reply; no totals per agent, run or day | 🟡 **Step 2:** cost now uses the price of the model that actually answered (list prices from models.dev; free tier billed $0). Totals still planned |
| Mock mode | 🎭 Mocked | A scripted fake model with 4 regex rules (`mock-model.ts`). It calls the real tools, but cannot reason, read memory or plan | 🟡 **Step 2:** on when no provider has a key, or forced with `OPENCREWBOT_MOCK_MODE=true`. Planner support still planned |
| Misconfiguration reporting | ❌ Missing | — | ✅ **Step 2:** a model whose provider has no key fails with a message naming the missing env var; an id without a known provider is rejected (HTTP 400) |

---

## 3. Product interface checklist (assignment section 5)

| Screen | Original status | Where |
|---|---|---|
| Agent workspace | ✅ | Sidebar + chat view + inspector panel |
| Individual agent conversations | ✅ | Direct chats (`dm:<botId>`) |
| Multi-agent rooms | ✅ (basic) | Rooms (`room:<roomId>`) |
| Dynamic agent creation | 🟡 → ✅ (Step 11) | New bot form with **Describe the agent you need → Draft it** (Agent Factory) |
| Memory manager | 🟡 → ✅ (Step 7) | **Memory Manager** panel (brain icon): every layer's file with who/when/why per entry, edit and save, active project picker and new project |
| Skills and tools manager | 🟡 → ✅ (Step 6) | **Skills and tools** panel: skills library (read each procedure, see which bots use it), tool catalog with permission behaviour and key status, Files folder with upload |
| Task execution dashboard | ❌ → ✅ (Step 8) | **Tasks and runs** panel (list icon): new goal, each task's status, owner, attempts, dependencies, duration, output and transcript on a timeline; cancel and retry; tasks waiting for approval |
| Approval centre | 🟡 → ✅ (Step 4) | Approval Centre panel (shield icon): waiting requests with full previews, history, audit log |
| Integration manager | ✅ (+ Step 12) | Connections panel with **What's working**: each integration's real state and which bots use it |
| Model configuration | 🟡 → ✅ (Step 2) | Per-bot model picker across 4 providers, fallback chain shown under it, provider keys listed in Settings |
| Scheduled workflows | ❌ → ✅ (Step 13) | **Workflows** panel (calendar icon) |
| Execution history | 🟡 → ✅ (Step 8) | Past runs in **Tasks and runs** (events, results, transcripts) and one history file per run in the Memory Manager |

## 4. Minimum acceptance criteria (assignment section 7): starting point

| Requirement | Minimum | Original |
|---|---|---|
| Configurable agents | 8 | 3 seeded (Scout, Quill, Atlas); more can be added by hand → **13 (Step 5)** |
| Collaboration rooms | 4 | 1 seeded (Studio) → **6 (Step 5)** |
| Dynamic agent creation | Working | Form only → **✅ (Step 11)** |
| Parallel task execution | Working | ❌ → **✅ (Step 8)** |
| Persistent individual memory | Working | ✅ |
| Shared project memory | Working | ❌ → **✅ (Step 7)** |
| Reusable skills | 8 | 0 → **11 (Step 6)** |
| Working integrations | 3 | Unverified → **🟡 (Step 12):** built; live check blocked by a rejected Composio key. **2026-11-19, with a working key:** Gmail send after approval ran live (email received); GitHub connected; Tavily web search live. Slack and Notion actions not run live |
| Permission levels | 3 | 2 → **3 (Step 4)** |
| Scheduled workflows | Working | ❌ → **✅ (Step 13)** |
| Approval centre | Working | 🟡 inline only → **✅ (Step 4)** |
| Execution history | Working | 🟡 transcripts only → **✅ (Step 8)** |
| Failure recovery | Demonstrated | 🟡 restart marks turns as interrupted; no retry → **✅ (Step 8), seen live on 2026-11-18:** the final write-up hit free-tier quota limits, was retried after 5 s, failed again, and the team's results were posted unedited; **Retry** reopened the plan and it completed on another model. Reassignment, timeout and restart recovery are covered by tests. **Step 16, live:** a task failed, was retried and reassigned; the server was killed mid-run and the run resumed, was reassigned again and completed (`evidence/2026-11-18-run-study-abroad-…-9d0854af.md`) |
| Business demonstrations | 7 | 0 → **prepared (Step 15):** `docs/DEMOS.md` and Save as evidence; to be run and recorded |

---

## 5. Architectural limitations found

1. **Single model provider.** Nebius is wired in at three places (see Module J). *Fixed in Step 2.*
2. **No unit of work bigger than one chat turn.** Everything is a message. There are no tasks, runs or plans to track, retry or resume.
3. **Rooms are sequential.** `runRoom()` awaits each bot before starting the next, so no two bots ever work at the same time.
4. **Approval state lives in memory.** It's lost on restart; this fails safe, but can't be resumed or reviewed later. *Step 4: requests and decisions are now in the database and reviewable; a request pending at restart is marked expired.*
5. **New tools are auto-allowed by default.** `toolCategory()` returns `"other"` for any tool it doesn't recognise, and the session allows `"other"` without asking. Every tool we add must be classified, or the default must change to "ask". *Fixed in Step 3: "other" always asks.*
6. **MCP read-only detection is a name heuristic.** A tool is treated as a safe lookup if its name starts with `get_`, `list_`, `search_` and so on. A badly named destructive tool would run without approval.
7. **Mock mode is all-or-nothing.** It's decided by a single key check, not per provider or per integration.
8. **Memory is per bot only.** There is no shared, room or project memory, and provenance is just a date.
9. **No tests.** Every change has to be verified by hand until we add a test suite. *Step 3: Vitest suite added (`pnpm test`), 36 tests.*
10. **No sign-in.** The app trusts anyone who can reach it. It's safe locally because it listens on `127.0.0.1` only and `proxy.ts` blocks other hosts. **It must not be deployed publicly (e.g. Render) without adding authentication.**
11. **The local disk is the database.** On hosts with temporary disks (Render's free tier) every restart would wipe bots, chats and memory.
12. **Gemini rejected the web search tool.** *Found in Step 2.* Tavily's search tool declares `includeRawContent` as `false | "markdown" | "text"`; Gemini refuses a boolean inside an enum, so every request from a bot with web search failed on Gemini. *Fixed for good in Step 6:* the web tools are now our own small schemas on the Tavily SDK.
13. **Groq rejected tool calls with optional fields.** *Found in Step 6.* Mastra's OpenAI compatibility layer also applies to every Groq model and turns each optional field into "required, may be null"; Groq's server then rejects calls that leave one out ("Tool call validation failed"). Fixed by keeping tool schemas small, plus a retry of the step on malformed tool calls (`modelStepRetry` in `model-chain.ts`). Mid-stream errors like these don't trigger Mastra's model fallback, only a step retry.
14. **Free-tier limits shape model choice.** *Measured in Step 6:* Groq allows 8,000 tokens per minute per model (research turns need 10,000-130,000), Gemini 2.5 Flash's free daily quota ran out after a day of testing, and Gemini 2.5 Flash-Lite often ended multi-step tool runs with an empty reply. Seeded agents therefore use Gemini 2.5 Flash (reasoning roles) and OpenRouter's free Nemotron 3 Ultra (tool-heavy roles), with the others as fallbacks. An empty reply now shows an error instead of a blank message.

## 6. Extend or replace? Decisions

| Part | Decision | Reason |
|---|---|---|
| Mastra `AgentController` harness (`runtime.ts`) | **Keep and extend** | Already handles the agent loop, streaming, approvals, ask-user and stop. Rebuilding it would be both wasted effort and a disqualifier |
| Event bus + SSE (`bus.ts`, `/api/events`) | **Keep** | New features (tasks, approvals, schedules) publish new event types on the same stream |
| `db.ts` storage pattern | **Keep and extend** | Add tables for tasks, runs, approvals, audit log, schedules, usage |
| Markdown memory (`memory-files.ts`) | **Keep and extend** | Add room / project / user / decision files and provenance |
| Tool registry and categories (`tools.ts`) | **Extend** | Add per-tool policy, the third permission level, and safe defaults |
| Composio + MCP connections | **Keep** | Exactly the integration architecture the assignment asks us to extend |
| Model layer (`config.ts`, `models.ts`, model line in `runtime.ts`) | **Extend** | Multi-provider using Mastra's built-in model router; Nebius stays as one provider |
| Jev routing | **Keep as optional** | Auto rooms will fall back to an LLM-based router, so a TypeSafe key isn't required |
| Mock model | **Extend** | Teach it to return plans and task results so the whole pipeline runs offline |
| UI shell (sidebar / chat / inspector / panels) | **Keep and extend** | Add screens for tasks, approvals, workflows, skills, memory and models |
| Execution engine, Chief of Staff, agent factory, skills, scheduler, audit log, tests | **New** | Nothing to extend |
| Mastra scheduled workflows | **Not used (for now)** | They're declared in code and need a `Mastra` instance, which this app doesn't create. Users must create schedules from the UI at runtime, so a small scheduler of our own, backed by the database, fits better |
