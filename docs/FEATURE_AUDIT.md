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
| **Tests** | None. There is no test script or test files; the README describes manual checks done with the mock model. |

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
| Agent routing | 🟡 Partial | `rooms.ts` `decideResponders()`: @mention → Jev → room lead → everyone | Planned |
| Understands requests, breaks them into tasks | ❌ Missing | Atlas (the "Planning" seed bot) only *writes* a plan as chat text; nothing executes it | Planned |
| Picks agents by capability | 🟡 Partial | Jev picks the best *single responder* from bot descriptions; this is not task assignment | Planned |
| Dependencies, parallel tasks | ❌ Missing | Room bots run strictly one after another (`while (queue.length)` loop) | Planned |
| Monitoring, failure handling | ❌ Missing | A failed turn just ends with an error message | Planned |
| Consolidated final deliverable | ❌ Missing | — | Planned |

### Module B: Dynamic agent creation
| Requirement | Original status | Evidence | What we add |
|---|---|---|---|
| Create agents without editing code | ✅ Implemented | "New bot" form (`BotForms.tsx`) → stored in the `bots` table | Keep |
| Create agents from natural language | ❌ Missing | Form only | Planned |
| Name, role, persona, model, tools | ✅ Implemented | `Bot` type in `types.ts`: name, title, description, instructions, model, tools | Keep |
| Memory | ✅ Implemented | Every bot gets its own `MEMORY.md` | Extend |
| Skills | ❌ Missing | No skills concept | Planned |
| Permissions | 🟡 Partial | One switch per bot: `approval: "ask" \| "full"` | Planned |
| Expected output format | ❌ Missing | — | Planned |
| Fallback models | ❌ Missing | One model per bot | Planned |

### Module C: Multi-agent collaboration
| Requirement | Original status | Evidence | What we add |
|---|---|---|---|
| Rooms | ✅ Implemented | `rooms` table, `RoomForms.tsx`, one seeded room ("Studio") | Extend (we need 4+) |
| Delegation between agents | 🟡 Partial | A bot can @mention a teammate in its reply; up to 2 hops (`MAX_HANDOFF_DEPTH = 2`) | Planned |
| Ask questions / share research / challenge / request verification | ❌ Missing | Only free-text @mentions; no structured message types | Planned |
| Parallel collaboration | ❌ Missing | Sequential only | Planned |
| Resume after interruption | 🟡 Partial | The transcript survives a restart, but in-flight turns are marked "Interrupted by a server restart" and never resumed (`service.ts` `sweepInterrupted()`) | Planned |
| Loop prevention | 🟡 Partial | Hop limit of 2 and no duplicate bot in the queue. No turn budget, no cost budget, no cycle detection beyond that | Planned |
| Shared room context | 🟡 Partial | Each bot gets the last ≤30 room lines it hasn't seen (`catchUp()`); there is no shared room memory | Planned |

### Module D: Autonomous task execution
| Requirement | Original status | Evidence | What we add |
|---|---|---|---|
| Execution engine | ❌ Missing | — (Mastra's built-in `task_*`, `submit_plan` and `subagent` tools are explicitly disabled in `runtime.ts`) | Planned |
| Visible task plan | ❌ Missing | — | Planned |
| Task ID, agent, dependencies, status, times, outputs, errors, approvals | ❌ Missing | — | Planned |
| Retries / timeouts / recovery | ❌ Missing | — | Planned |
| Cancellation | 🟡 Partial | **Stop** button aborts the conversation's running turns (`stopConversation()`, "stop epoch") | Extend |
| Execution history | 🟡 Partial | Chat transcripts only | Planned |

### Module E: Persistent memory
| Requirement | Original status | Evidence | What we add |
|---|---|---|---|
| Markdown memory | ✅ Implemented | `memory-files.ts`: one `MEMORY.md` per bot, atomic writes | Keep |
| Individual agent memory | ✅ Implemented | `memory_add` / `memory_edit` tools | Keep |
| Shared room memory | ❌ Missing | — | Planned |
| Project memory | ❌ Missing | — | Planned |
| User preferences / decisions (shared) | ❌ Missing | Only inside each bot's own file | Planned |
| Historical task context | ❌ Missing | — | Planned |
| User can read and edit memory | ✅ Implemented | Memory tab in the inspector; `GET/PUT /api/bots/<id>/memory` | Extend to all memory files |
| Survives restart | ✅ Implemented | Plain files on disk; re-read on **every** model call (`prompt.ts` is called per call) | Keep |
| Edits apply immediately | ✅ Implemented | Same reason as above | Keep |
| Provenance (what, when, why) | 🟡 Partial | `memory_add` appends the date only: `- note _(2026-11-17)_` | Planned |
| Secret redaction | ✅ Implemented | `redactSecrets()` strips keys/tokens before writing | Keep |

### Module F: Skills and tools
| Requirement | Original status | Evidence | What we add |
|---|---|---|---|
| Reusable skills (8 required) | ❌ Missing | 0 skills | Planned |
| Dynamic skill loading | ❌ Missing | — | Planned |
| Tool ecosystem | ✅ Implemented | `tools.ts`: web search / read page / crawl (Tavily), memory, Code Mode, browser, ask-user | Extend |
| Code execution sandbox | ✅ Implemented | Code Mode: TypeScript in a QuickJS WebAssembly sandbox, no filesystem/network, 60 s timeout, 128 MB | Reuse for calculations |
| MCP | ✅ Implemented | Add remote MCP servers by URL + token (`mcp-servers.ts`) | Keep |
| Spreadsheet / chart / report tools | ❌ Missing | — | Planned |

### Module G: Human approval and autonomy
| Requirement | Original status | Evidence | What we add |
|---|---|---|---|
| Three permission levels | 🟡 Partial | Two levels: **Ask first** and **Full access** | Add **Controlled Access** |
| Approval before sensitive actions | ✅ Implemented | Mastra pauses the tool call until **Allow once / Deny**; Deny means the tool never runs | Keep |
| Action preview | 🟡 Partial | The card shows the action name (e.g. "Slack: send message"), not the full payload (message text, recipient) | Planned |
| Approval centre | ❌ Missing | Approval cards exist only inline in each chat | Planned |
| Tool-level permissions | 🟡 Partial | Per *category* (read / edit / execute / mcp / other), not per tool | Planned |
| Audit log | ❌ Missing | — | Planned |
| Cancellation | ✅ Implemented | Stop button | Keep |
| Secure credentials | ✅ Implemented | Keys in `.env` (git-ignored), never sent to the browser; Composio holds app OAuth tokens. ⚠️ MCP server tokens are stored unencrypted in the `settings` table | Note in limitations |
| Pending approval survives restart | 🟡 Partial | No; approvals live in the Mastra session in memory. After a restart the card is marked denied (fails safe) | Planned |

### Module H: Integrations
| Requirement | Original status | Evidence | What we add |
|---|---|---|---|
| Integration architecture | ✅ Implemented | Composio (one key, OAuth sign-in per app, 1,000+ apps) + remote MCP servers; per-bot switches | Keep |
| 3 working integrations | 🟡 Partial | Code exists, but the original README says *"Still to verify with live services: Composio sign-in and app actions"* | Verify GitHub, Notion, Slack live |
| Live vs mocked labels | ❌ Missing | — | Planned |

### Module I: Scheduled workflows
| Requirement | Original status | Evidence | What we add |
|---|---|---|---|
| Automation engine, schedules, history, pause/resume, failure reports | ❌ Missing | Listed only as an idea in the README ("Add scheduled routines with Mastra schedules") | Planned |

### Module J: Multi-model intelligence
| Requirement | Original status | Evidence | What we add |
|---|---|---|---|
| Multiple providers | ❌ Missing | **Hard-coded to Nebius**: `runtime.ts` line 105 builds `nebius/<model>`; `config.ts` mock mode = "no Nebius key"; `models.ts` only fetches Nebius's catalog | Planned |
| Model per agent | ✅ Implemented | `bot.model`, changeable from the model picker without restart | Keep |
| Task-based routing | ❌ Missing | README: "coming soon" | Planned |
| Fallback models | ❌ Missing | — | Planned |
| Local endpoints | ❌ Missing | — | Planned |
| Token / cost tracking | 🟡 Partial | Tokens and $ cost shown on every reply; no totals per agent, run or day | Planned |
| Mock mode | 🎭 Mocked | A scripted fake model with 4 regex rules (`mock-model.ts`). It calls the real tools, but cannot reason, read memory or plan | Extend so the planner also works offline |

---

## 3. Product interface checklist (assignment section 5)

| Screen | Original status | Where |
|---|---|---|
| Agent workspace | ✅ | Sidebar + chat view + inspector panel |
| Individual agent conversations | ✅ | Direct chats (`dm:<botId>`) |
| Multi-agent rooms | ✅ (basic) | Rooms (`room:<roomId>`) |
| Dynamic agent creation | 🟡 | "New bot" form only |
| Memory manager | 🟡 | One bot's Memory tab at a time |
| Skills and tools manager | 🟡 | 5 tool switches per bot; no skills |
| Task execution dashboard | ❌ | — |
| Approval centre | 🟡 | Inline chat cards only |
| Integration manager | ✅ | Connections panel (Composio apps + MCP servers) |
| Model configuration | 🟡 | Per-bot model picker, Nebius models only |
| Scheduled workflows | ❌ | — |
| Execution history | 🟡 | Chat transcripts only |

## 4. Minimum acceptance criteria (assignment section 7): starting point

| Requirement | Minimum | Original |
|---|---|---|
| Configurable agents | 8 | 3 seeded (Scout, Quill, Atlas); more can be added by hand |
| Collaboration rooms | 4 | 1 seeded (Studio) |
| Dynamic agent creation | Working | Form only |
| Parallel task execution | Working | ❌ |
| Persistent individual memory | Working | ✅ |
| Shared project memory | Working | ❌ |
| Reusable skills | 8 | 0 |
| Working integrations | 3 | Unverified |
| Permission levels | 3 | 2 |
| Scheduled workflows | Working | ❌ |
| Approval centre | Working | 🟡 inline only |
| Execution history | Working | 🟡 transcripts only |
| Failure recovery | Demonstrated | 🟡 restart marks turns as interrupted; no retry |
| Business demonstrations | 7 | 0 |

---

## 5. Architectural limitations found

1. **Single model provider.** Nebius is wired in at three places (see Module J).
2. **No unit of work bigger than one chat turn.** Everything is a message. There are no tasks, runs or plans to track, retry or resume.
3. **Rooms are sequential.** `runRoom()` awaits each bot before starting the next, so no two bots ever work at the same time.
4. **Approval state lives in memory.** It's lost on restart; this fails safe, but can't be resumed or reviewed later.
5. **New tools are auto-allowed by default.** `toolCategory()` returns `"other"` for any tool it doesn't recognise, and the session allows `"other"` without asking. Every tool we add must be classified, or the default must change to "ask".
6. **MCP read-only detection is a name heuristic.** A tool is treated as a safe lookup if its name starts with `get_`, `list_`, `search_` and so on. A badly named destructive tool would run without approval.
7. **Mock mode is all-or-nothing.** It's decided by a single key check, not per provider or per integration.
8. **Memory is per bot only.** There is no shared, room or project memory, and provenance is just a date.
9. **No tests.** Every change has to be verified by hand until we add a test suite.
10. **No sign-in.** The app trusts anyone who can reach it. It's safe locally because it listens on `127.0.0.1` only and `proxy.ts` blocks other hosts. **It must not be deployed publicly (e.g. Render) without adding authentication.**
11. **The local disk is the database.** On hosts with temporary disks (Render's free tier) every restart would wipe bots, chats and memory.

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
