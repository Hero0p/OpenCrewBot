<div align="center">

<img src="docs/logo.svg" alt="OpenCrewBot mascot" width="96" height="96">

# OpenCrewBot

### Your own team of AI bots, in one chat app.

**An open-source alternative to Grok Bot, on open models. Each bot has its own model, tools, memory and cloud browser.**

Built with [Mastra](https://mastra.ai) and [Nebius Token Factory](https://tokenfactory.nebius.com) · [Get started](#get-started) · [Overview](#overview) · [Architecture](#architecture) · [Features](#features) · [Data and privacy](#data-and-privacy)

![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![Mastra](https://img.shields.io/badge/harness-Mastra-6d28d9)
![Nebius Token Factory](https://img.shields.io/badge/models-Nebius%20Token%20Factory-e0ff4f?labelColor=0b0b0b)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Built by Studio1 team](https://img.shields.io/badge/built%20by-Studio1%20team-ff6b1a)](https://studio1hq.com)

Run OpenCrewBot on your own machine. Bring a Nebius Token Factory key for the models, and optionally Tavily, Browserbase and Jev keys for search, browsing and room routing. With no keys at all, it runs in mock mode so you can try the whole interface first.

</div>

---

<div align="center">

<table><tr><td>

<img src="docs/screenshots/hero.png" alt="OpenCrewBot: a chat with Scout, a research bot, showing a web search, a sourced answer and a memory save, with the bot's details panel open" width="900">

</td></tr></table>

</div>

_Ask, search, answer, remember. Scout searches the web with Tavily, answers with its sources, and saves a decision to its own `MEMORY.md`. Staged example content; the interface is real._

## Overview

OpenCrewBot treats AI as a messaging app. Every contact in the sidebar is a bot with its own persona, its own open-source model, its own tools and its own memory. Talk to one bot directly, or put several in a room and let them split the work.

**A starting point, not a hosted product.** You run the app and bring your own keys. It's early: the [Features](#features) section says what's included and what has been verified so far.

### Bots

Give each bot a name, a role, instructions, a model and a set of tools. Each reply shows its tokens and cost.

**Choose the model from the bot's Details.** **Change** opens a model sheet with three suggested picks (fastest, best all-rounder, strongest) and every model from the providers you have keys for (Google Gemini, Groq, OpenRouter and Nebius Token Factory), with search, context size, tool support and price. A new model applies from the bot's next reply, with no restart. **If the model fails** (rate limit, outage), the bot falls back to another provider that has a key, and the reply shows which model answered.

The details panel keeps a short summary of the bot, with the full editor one click away. Changes apply from the bot's next reply.

**Create an agent by describing it (Agent Factory).** In **New bot**, write what you need in plain words ("a pricing analyst called Priya who compares study-abroad counselling fees in India and gives me a sourced table") and press **Draft it**. Every field fills in for you to review: name, role, instructions, model, tools, skills, starting memory, permission level and output format.

The draft is checked in code:
- only skills from the library;
- a model from OpenCrewBot's own list for the kind of work;
- memory always on, and no browser or planning;
- at most Controlled access.

**Create** saves it, and you can chat with it straight away. Its starting memory is stamped "by: you · in: Agent Factory". The Chief of Staff can do the same with its `create_agent` tool when nobody on the team fits a task (those agents start on Ask first), and can put agents in a new room with `create_room`. In mock mode, the draft comes from keyword rules and says so.

### Rooms

Put bots in a room and talk to all of them at once. @mention a bot to choose who answers, or `@everyone`. With no mention, an **Auto** room asks [Jev](https://typesafe.ai), TypeSafe's decision model, to pick the best bot in a few hundred milliseconds. If Jev isn't sure, the room's lead answers. A bot can @mention a teammate to hand work on, up to two hops.

<div align="center">

<table><tr><td>

<img src="docs/screenshots/room.png" alt="The Studio room: Atlas, picked by Jev with 91% confidence, plans a launch and hands research to Scout and drafting to Quill" width="900">

</td></tr></table>

</div>

_One message, three bots. Jev picks Atlas to answer, Atlas hands research to Scout and drafting to Quill. Staged example content._

**How the bots answering one message work together** is set per room:
- **One by one**: each sees the answers before it.
- **In parallel**: all start at the same time.
- **With review**: after the answers, the room's fact-checker reviews them and @mentions whoever made a weak claim, who then defends or revises it.

**Agents work with each other**, in rooms, plans and chats, through two tools:
- `ask_teammate`: a *question*, a piece of work to *delegate*, a claim to *verify*, or a conclusion to *challenge*. The teammate answers in its own conversation, and the answer comes back to the asker.
- `share_finding`: posts an intermediate result. In a team plan, every task that starts later gets it in its brief.

Every exchange is shown where the work is ("💬 Vega asked for verification from Quinn", "↩ Quinn answered Vega") and in the plan's history.

**Loops are stopped in code:**
- A chain of requests is at most 3 agents deep, and nobody can ask back someone already waiting on them.
- The same question is asked once.
- Two agents get 3 exchanges per piece of work and the team 12, within a token budget (`OPENCREWBOT_COLLAB_TOKEN_BUDGET`).
- A room message leads to at most 8 replies, with at most 2 hand-offs between the same two bots.

A message being answered is saved after every reply, so after a restart the bots still to answer do ("↻ Picking up after a restart").

### Team plans (Chief of Staff)

Give a bot the **Plan team work** tool (Morgan, the Chief of Staff, has it) and ask it for something bigger than one answer. It writes a plan with `create_plan`: tasks, an owner for each by @handle, the skill each needs, and which tasks need another's result. The plan is checked in code before anything starts (unknown teammates, missing skills, loops), then the **execution engine** runs it:

- Tasks whose inputs are ready run **at the same time** (up to `OPENCREWBOT_MAX_PARALLEL_TASKS`, default 3); a task that needs another's result waits for it and gets it in its brief.
- A failed task is **retried** after a short wait, then **handed to another agent with the same skill**, and only then marked failed. The rest of the plan carries on.
- A task that runs longer than `OPENCREWBOT_TASK_TIMEOUT_MINUTES` (default 15) is stopped. You can cancel a task or the whole run, or retry a failed task.
- The planner writes the **final deliverable** from every task's result, and it's posted in the chat where you asked. Progress notices ("✓ Vega finished …") appear there as the work happens. If the final write-up itself fails (for example, every model in the planner's chain is out of free quota), you still get each task's result, unedited, and **Retry** on the final task reopens the plan to write it once a model is available again.
- In a room, a message that @mentions the planner goes to the planner alone, even if it names other teammates: they get their parts as tasks instead of also answering in the room.
- If you change your mind halfway ("also cover pricing", "drop the survey"), the planner uses `update_plan` to cancel and add tasks without starting over.
- A server restart doesn't lose the plan: interrupted tasks go back in the queue on the next start.

**Give the planner a model with a large allowance.** The final write-up reads every task's result: in a 5-task test on November 18, 2026 it used about 44,000 input tokens. Gemini handles that on its free tier; Groq's free tier (8,000 tokens per minute) can't, so it only helps the planner as a fallback for short replies.

Open **Tasks and runs** (list icon in the sidebar) to start a goal, watch each task's status, owner, attempts and timing on a timeline, open a task's own transcript, approve actions a task is waiting on, and read past runs. Each task runs in its own conversation (`task:<id>`), so its approvals appear in the Approval Centre like any other.

### Memory

Memory is plain Markdown files you can read and edit, in five layers:

| Layer | File | Who reads it |
| --- | --- | --- |
| **Your preferences** | `data/memory/user.md` | Every bot, every turn |
| **Team decisions** | `data/memory/decisions.md` (latest entries) | Every bot |
| **Project** | `data/memory/projects/<project>.md` (the active project) | Every bot |
| **Room** | `data/memory/rooms/<roomId>.md` | Bots working in that room, and tasks started there |
| **Agent** | `data/workspaces/<botId>/MEMORY.md` | That bot only |

Team runs also leave an **execution history** file per run in `data/memory/history/`. A bot writes with `memory_add` (choosing the layer and saying why) and fixes a line with `memory_edit`. Every entry carries a small hidden stamp saying who wrote it, when, why and where (`<!-- by: Maya | when: … | why: … | in: … -->`); the stamps are shown in the **Memory Manager** (brain icon in the sidebar) and left out of the prompts. In the Memory Manager you can read and edit every file, pick the active project or create one. When you edit a file by hand, the bots follow the file. Anything that looks like a password, token or key is redacted before it's written.

<div align="center">

<table><tr><td>

<img src="docs/screenshots/memory.png" alt="Scout's Memory tab showing its MEMORY.md, with notes about the person and decisions" width="900">

</td></tr></table>

</div>

_A bot's Memory tab is its own file (the agent layer). The panel refreshes live when the bot writes to it._

### Ask before acting

Each bot has one of three **permission levels**. Lookups (search, reading pages) and the bot's own memory never ask.

| Level | Actions in apps, MCP servers and the browser |
| --- | --- |
| **Ask first** | Every action waits for your OK. |
| **Controlled** | The kinds of action you pre-approve (app actions, browser actions) run on their own, up to a daily limit (any 24 hours); everything else asks. |
| **Full access** | Acts without asking. |

A tool that hasn't been classified always asks, at every level. When a bot needs approval, the request appears as a card in the chat **and** in the **Approval Centre** (shield icon in the sidebar), with the exact details it would run with. **Approve** runs it once; **Reject** means it never runs, and the bot is told so and adapts. Requests that can no longer be decided (server restart, Stop) expire, and their actions never run. The Approval Centre also keeps the decision **history** and an append-only **audit log** of every tool call, approval and decision. Bots can also pause to ask you a question, with suggested answers as buttons, and resume when you reply.

<div align="center">

<table><tr><td>

<img src="docs/screenshots/approval.png" alt="Quill asks to open tokenfactory.nebius.com in its browser and waits for Allow once or Deny" width="900">

</td></tr></table>

</div>

_Nothing happens until you choose. Staged example content._

### Tools

| Tool | What it does | Powered by |
| --- | --- | --- |
| Web search | Search, read pages and crawl sites, with sources shown under the answer | [Tavily](https://tavily.com) SDK (`@tavily/core`), with small tool schemas every model provider accepts |
| Memory | Add and fix notes in a memory layer (the bot's own file, your preferences, the project, team decisions, the room) | Local files |
| Plan team work | `create_plan`, `update_plan`, `plan_status`: break a request into tasks for teammates and run them through the execution engine | `engine.ts`, `planning.ts` |
| Code mode | The model writes one TypeScript function that calls several tools at once, so multi-step questions take one round trip | Mastra Code Mode, in a QuickJS (WebAssembly) sandbox |
| Browser | A real cloud browser for pages that need clicks, forms or JavaScript. Watch it live from the chat and click in to take over | [Browserbase](https://www.browserbase.com) via Mastra `AgentBrowser` |
| Ask me | Pause and ask you a question with a card in chat | Mastra `ask_user` |
| Files and charts | List files, read CSV spreadsheets (column summaries over every row), draw bar/line charts, save Markdown reports, all inside the shared Files folder | Local files (`data/files`), Papa Parse |
| Skills | Load the step-by-step procedure of one of the bot's skills when a task matches | `skills/*/SKILL.md` |

**Skills.** A skill is a tested procedure for one kind of work (market research, competitor analysis, financial modelling, presentations, email drafting, code review, data analysis, lead generation, content calendars, report consolidation, fact-checking). Each bot's prompt lists only its skills' descriptions; the bot calls `load_skill` to get the full procedure when a task matches, which keeps prompts short as the library grows. Browse them, the tool catalog and the Files folder in **Skills and tools** (book icon in the sidebar).

### Connections

Give bots access to Slack, GitHub, Gmail, Notion and the rest of your tools. Open **Connections** from the plug icon in the sidebar:

- **Apps via [Composio](https://composio.dev).** Click **Connect**, sign in on the app's own page, and come back. Composio handles each app's sign-in and tokens, with 1,000+ apps available through search.
- **Your own MCP servers.** Add any remote MCP server by URL and token. There's a preset for GitHub's official server (`https://api.githubcopilot.com/mcp/`, with a personal access token). **Add and test** connects straight away and reports how many tools it offers.

Then switch each connection on for the bots that should have it, in the bot's Details. Lookups run on their own; anything that changes something (sending a message, opening an issue) shows an approval card first, unless the bot has full access. Tokens stay on the server.

**What's working** at the top of Connections shows each integration's real state, and the bots that use it:

| Badge | Meaning |
| --- | --- |
| **LIVE** | Connected (Composio), or tested OK since the app started (MCP) |
| **NOT CONNECTED** | Composio is set up, but you haven't signed in to this app yet |
| **NOT CONFIGURED** | No `COMPOSIO_API_KEY` |
| **NOT WORKING** | Composio rejected the key (the message says how to fix it), or the server's last test failed |
| **UNTESTED** | An MCP server that hasn't been tested since the app started |

Bots use connected apps through three tools whose permissions are decided **per action**:
- `find_app_actions` finds the action that does what's needed.
- `read_from_app` runs anything that only reads (GET, LIST, SEARCH, FETCH…) on its own, and refuses an action that changes something.
- `act_in_app` (create, post, send) asks first, per the bot's permission level, showing the bot's plain-words summary and the exact inputs.

**In mock mode, app changes are SIMULATED:** they're written to a "SIMULATED …" report in Files and never sent, and a SIMULATED badge marks them in the chat.

### Workflows (scheduled)

Open **Workflows** (calendar icon) to schedule work that repeats: a weekly competitor check, a monthly report, a daily summary. Or ask the Chief of Staff ("check our competitors every Monday at 09:00"), who uses `schedule_workflow`.

A workflow has three parts:
- an instruction;
- the agent who runs it (usually the Chief of Staff, who can turn it into a team plan);
- a schedule: a preset or a cron expression, at most every 5 minutes.

Each run saves its status, trigger, duration, result, report file and transcript, and gets the previous run's result, so it can say what changed. You can **Run now**, **Pause** and **Resume**. A run that was due while the app was off runs once when it starts again ("catch-up"). A failed run is reported in the agent's chat and shown red in the history.

### Start here, and LIVE vs SIMULATED

The home screen (house icon):
- explains the app in three steps;
- says whether answers are **LIVE** (real models) or **SIMULATED** (mock model);
- offers ready-made MeetUniversity goals that go to the Chief of Staff.

Simulated output is badged everywhere it appears: bot replies, tool steps, team runs and workflow runs.

### Evidence for demonstrations

**Save as evidence** writes a Markdown file into `evidence/` (`OPENCREWBOT_EVIDENCE_DIR`). It's on a finished run (Tasks and runs) and on the Approval Centre's audit log. Each file records the plan, timeline, every task's output, models and tool steps, the approvals and the result, labelled LIVE or SIMULATED. `docs/DEMOS.md` walks through the seven MeetUniversity demonstrations.

## Architecture

### Mastra runs the bots

OpenCrewBot doesn't build its own agent loop. Each bot gets a Mastra [`AgentController`](https://mastra.ai/docs/harness/agent-controller), and each conversation gets its own session. Mastra handles the model calls, thread history, tool approvals and question pauses. OpenCrewBot folds the controller's events into chat messages and streams them to the browser over one SSE connection.

![Diagram](/public/image.png)

All keys stay on the server. Without any model provider key (or with `OPENCREWBOT_MOCK_MODE=true`), bots run on a scripted mock model that streams replies and calls the real tools, so every part of the interface can be tried before you connect anything.

## Get started

Use **Node.js 22.13 or newer** (developed on 24) and **pnpm**:

```sh
git clone https://github.com/Studio1-OSS/OpenCrewBot.git
cd OpenCrewBot
pnpm install
cp .env.example .env
pnpm dev
```

Open **http://localhost:3000**. On first run OpenCrewBot creates the original three bots (Scout for research, Quill for writing, Atlas for planning) and a room called Studio, plus a **10-agent workforce** led by Morgan, the Chief of Staff, and 5 collaboration rooms (Market Intelligence, Marketing Campaign, Business Analysis, Dev Team, Operations). Existing installs get the workforce once on their next start; their own bots are left as they are.

Add your keys to `.env`, then restart `pnpm dev`. Every key is optional:

| Variable | What it turns on |
| --- | --- |
| `GEMINI_API_KEY` | Google Gemini models ([get a key](https://aistudio.google.com/apikey)). `GOOGLE_GENERATIVE_AI_API_KEY` also works. |
| `GROQ_API_KEY` | Fast open models on [Groq](https://console.groq.com/keys). |
| `OPENROUTER_API_KEY` | [OpenRouter](https://openrouter.ai/keys), including its free `:free` models. |
| `NEBIUS_API_KEY` | Open-source models from [Nebius Token Factory](https://tokenfactory.nebius.com). |
| `OPENCREWBOT_DEFAULT_MODEL` | Optional. The model new bots start with, e.g. `google/gemini-2.5-flash`. Default: the first provider above that has a key. |
| `OPENCREWBOT_MOCK_MODE` | Optional. `true` forces the scripted mock model even when keys are set. Without any model key, mock mode is on anyway. |
| `TAVILY_API_KEY` | Web search, page reading and site crawls. |
| `BROWSERBASE_API_KEY` | Cloud browsers for bots with the Browser tool. |
| `BROWSERBASE_PROJECT_ID` | Optional. Inferred from the key when empty. |
| `BROWSERBASE_SESSION_MINUTES` | Optional cap on one browser session (default 15). |
| `COMPOSIO_API_KEY` | Connected apps (Slack, GitHub, Gmail, Notion and more) through [Composio](https://platform.composio.dev). |
| `TYPESAFE_API_KEY` | Jev routing in Auto rooms. Without it, the room's lead answers. |
| `JEV_MODEL` | Jev model id (default `jev-latest`). |
| `OPENCREWBOT_DATA_DIR` | Where data lives (default `./data`). |
| `OPENCREWBOT_MAX_PARALLEL_TASKS` | Optional. How many team-plan tasks run at the same time, across all runs (default 3; free-tier rate limits are why it's small). |
| `OPENCREWBOT_TASK_TIMEOUT_MINUTES` | Optional. How long one attempt of a task may run before it's stopped (default 15; waiting for your approval counts). |
| `OPENCREWBOT_COLLAB_TOKEN_BUDGET` | Optional. How many tokens teammates' answers (`ask_teammate`) may use on one piece of work (default 200,000). |
| `OPENCREWBOT_EVIDENCE_DIR` | Optional. Where **Save as evidence** writes (default `./evidence`). |
| `OPENCREWBOT_SKILLS_DIR` | Where the skills library lives (default `./skills`). |
| `OPENCREWBOT_ALLOWED_HOSTS` | Extra host names the API answers to, comma-separated. Only for deliberate setups behind your own sign-in. |

**No keys yet?** Try these in a bot's chat in mock mode:

- `remember that I like short answers` calls the memory tool and writes to `MEMORY.md`.
- `ask me something` shows a question card and resumes when you answer.
- `open https://example.com` shows an approval card first, in a bot with the Browser tool on.
- `search for Nebius Token Factory` runs a real Tavily search once `TAVILY_API_KEY` is set.
- Any request to Morgan creates a small team plan; its tasks return results clearly labelled **SIMULATED**, and the final deliverable is posted back, so you can watch the engine and the Tasks and runs panel work.

## Data and privacy

Bots, rooms, the chat transcript, and team runs and their tasks are stored in SQLite at `data/opencrewbot.db`. Mastra keeps each bot's model-side thread history in `data/mastra.db`. Each bot's memory is `data/workspaces/<botId>/MEMORY.md`; shared memory (preferences, decisions, projects, rooms, run history) is in `data/memory/`. Nothing leaves your machine except calls to the services you configure:

- **Your model providers** (Google, Groq, OpenRouter, Nebius: whichever a bot's model and fallbacks use) receive each bot's system prompt (including its `MEMORY.md` and the shared memory it reads), the conversation, and tool results. Free tiers may use this data to improve their products; check each provider's terms.
- **Tavily** receives search queries and the URLs a bot reads or crawls.
- **Browserbase** runs the cloud browser, so it sees the pages a bot visits and anything typed into them. Sessions are released when a bot is reset or deleted, and expire after `BROWSERBASE_SESSION_MINUTES`.
- **Jev** receives the room name, member names and descriptions, the last few room messages and the new message, when an Auto room has no @mention.
- **Composio** holds the sign-ins for apps you connect, and receives the actions a bot runs in them.
- **Your MCP servers** receive the tool calls a bot makes to them. Their URLs and tokens are stored in `data/opencrewbot.db`.

OpenCrewBot sends no telemetry of its own. Review the privacy policy and retention settings of each service you connect.

It assumes one local owner and has no sign-in. To keep it that way, `pnpm dev` and `pnpm start` listen on `127.0.0.1` only, and the API refuses requests from other websites and requests addressed to any host but `localhost`. Don't expose it to the internet as-is.

## Features

| Area | Included |
| --- | --- |
| Bots | Name, role, instructions, color, model, tools and approval level per bot; pin, search, unread counts, live typing status |
| Models | Model sheet with suggested picks, search and the live Token Factory catalog; switch without a restart; tokens and cost on every reply |
| Connections | Composio apps with one-click sign-in, your own MCP servers (GitHub preset), per-bot access, approval for actions |
| Chat | Streaming Markdown, reasoning, tool steps with sources, Stop, and messages queued while a bot is busy |
| Rooms | @mentions, `@everyone`, Auto routing with Jev, Lead and Everyone modes, bot-to-bot hand-offs |
| Memory | Five layers (your preferences, team decisions, project, room, agent) plus run history; who/when/why on every entry; Memory Manager to read and edit them; secret redaction |
| Team plans | Chief of Staff plans with checked owners and skills; parallel tasks, retry, hand-off to a teammate with the same skill, timeout, cancel, change of plan, restart recovery; Tasks and runs panel with a timeline |
| Collaboration | Ask a teammate (question, delegate, verify, challenge) and share findings; room modes (one by one, in parallel, with review); loop limits and budgets; rooms resume after a restart |
| Agent Factory | Describe an agent in plain words, review the checked draft, create it; the Chief of Staff can create agents and rooms |
| Integrations | Per-action permissions for app actions (reads run, changes ask); LIVE / NOT CONNECTED / NOT CONFIGURED / NOT WORKING / UNTESTED badges; SIMULATED changes in mock mode |
| Workflows | Scheduled instructions with Run now, pause / resume, history, reports, comparison with the previous run, catch-up after downtime, failure reports |
| Evidence | Save a run or the audit log as a Markdown evidence file, labelled LIVE or SIMULATED |
| Approvals | Allow once / Deny cards for browser actions, plus ask-you question cards that resume the run |
| Browser | Browserbase session per bot, embedded live view with takeover, release on reset |
| Code mode | Multi-tool TypeScript in a QuickJS sandbox with no filesystem or network access |
| Mock mode | A scripted model that exercises the real tools, approvals and streaming without any keys |

**What's been verified.** On October 13 and 14, 2026, these were tested locally with the mock model: streaming, tool calls, memory writes, approvals (Allow, Deny, and Stop while waiting), question cards, room @mentions and hand-offs, restart recovery, and the production build. The Browserbase path was tested by driving a local Chrome over the same CDP connection. MCP servers were tested against DeepWiki's public server (add, test, and loading its tools into a bot). The live model list comes from Token Factory, and Mastra's router was checked to accept every model on it. **Still to verify with live services:** Composio sign-in and app actions, Browserbase sessions, Jev routing, and how reliably each open model calls tools.

**OpenCrewBot 2.0, November 18, 2026, with live free-tier models (Gemini, Groq, OpenRouter):** a Chief of Staff plan in a direct chat (research → fact-check → final report); a plan started in a room with two tasks running at the same time, changed mid-run with `update_plan`; the final write-up failing on quota, its retry, the unedited fallback, and the plan reopened and completed on another model; a preference taught to one agent, remembered by another after a restart, and a hand edit in the Memory Manager followed on the next reply. The Tasks and runs panel and the Memory Manager were checked in a browser. Reassignment to a teammate with the same skill, timeouts and restart recovery mid-run are covered by automated tests, not yet seen live.

**Steps 10-15 (collaboration, Agent Factory, integrations, workflows, Start here, evidence)** are covered by automated tests (138 in total), most of them with the mock model running the real pipeline, and the new screens were checked in a browser. **Step 16 (November 18, 2026) ran them live** on free-tier models: teammate verification, the Agent Factory, review and parallel rooms, workflows, failure recovery with a server killed mid-run, a rejected app action that never ran, and a dry run of an unseen business problem. See `docs/TESTING_EVIDENCE.md`. GitHub, Notion and Slack actions after approval are still unverified: Composio rejected the configured key.

**Free-tier quotas decide what you can demo.** Measured on November 18, 2026:
- Gemini 2.5 Flash's free tier allows **20 requests a day**.
- OpenRouter's free models allow 50 a day.
- Groq allows 8,000 tokens a minute, less than most agent requests.

Gemini's lite models (`gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-flash-lite-latest`) have separate quotas and ran the live tests well. Spread your agents across them in each agent's Details.

### Extending it

- Let bots delegate to each other in direct chats with Mastra subagents.
- Let Jev pick the model for each message (fast for simple asks, strong for hard ones). It's shown as "coming soon" in the model sheet.
- Let you talk to bots from Slack or Discord with Mastra Channels.
- Add sign-in and multiple users before deploying it anywhere shared.
- Add voice: speak to a bot and have it read replies aloud.

## Project layout

- `src/lib/server/runtime.ts`: the harness glue. One `AgentController` per bot, one session per conversation, events folded into chat messages.
- `src/lib/server/tools.ts`: which tools a bot gets, their approval categories, and how each looks in chat.
- `src/lib/server/rooms.ts` and `jev.ts`: room routing, catch-up context and hand-offs.
- `src/lib/server/memory-files.ts`: plain file helpers for memory: atomic writes, appends, one-line edits and redaction.
- `src/lib/server/memory-layers.ts`: the memory layers (which file each is), who/when/why stamps, projects, and the shared memory each bot reads.
- `src/lib/server/engine.ts`: the execution engine: a run's task graph, parallel waves, retry, reassignment, timeout, cancel, change of plan and restart recovery.
- `src/lib/server/task-runner.ts`: how the engine runs one task (an agent turn in the task's own conversation) and writes run history.
- `src/lib/server/planning.ts`: the Chief of Staff's tools (`create_plan`, `update_plan`, `plan_status`, `create_agent`, `create_room`, `schedule_workflow`) and what a planner sees about its team.
- `src/lib/server/collaboration.ts`: `ask_teammate` and `share_finding`, and the loop guards (`checkExchange`).
- `src/lib/server/rooms.ts`: room routing, modes, reply budget, hand-off limits and resuming after a restart.
- `src/lib/server/agent-factory.ts`: drafting and checking an agent from a description.
- `src/lib/server/app-actions.ts` and `integrations.ts`: the per-action app tools (reads run, changes ask) and each integration's real state.
- `src/lib/server/scheduler.ts` and `src/lib/shared/schedules.ts`: workflows, the scheduler loop, catch-up and run history.
- `src/lib/server/evidence.ts`: evidence files for the demonstrations.
- `docs/DEMOS.md`: how to run and record the seven MeetUniversity demonstrations.
- `src/lib/server/browserbase.ts`: creates, announces and releases each bot's Browserbase session.
- `src/lib/shared/providers.ts`: the model providers (names, env vars, recommended models) and model-id helpers.
- `src/lib/server/providers.ts`: which providers have a key, and the default model.
- `src/lib/server/model-chain.ts`: the ordered list of models a bot tries (its model, then fallbacks), and the reporter that records which model answered.
- `src/lib/server/models.ts`: the model picker's catalog and prices.
- `src/lib/server/mock-model.ts`: the scripted model used without any provider key.
- `src/lib/server/workforce.ts`: the starting workforce: 10 agents (role, instructions, skills, tools, permission level, output format, model tier) and 5 rooms.
- `skills/<id>/SKILL.md`: the skills library (11 skills). Plain Markdown with a short YAML header; edit or add one without touching code.
- `src/lib/server/skills.ts`: reads the skills library; `load_skill` in `tools.ts` hands a bot one skill's procedure.
- `src/lib/server/files.ts` and `charts.ts`: the shared Files folder (uploads, reports, charts), CSV reading, and SVG charts.
- `samples/`: a **synthetic** sales spreadsheet and the seeded generator that makes it.
- `src/lib/server/permissions.ts`: the three permission levels, turned into one policy per tool category for Mastra to enforce.
- `src/lib/server/approvals.ts`: the approval and audit trail (requests, decisions, tool runs, the daily limit count).
- `src/components/ApprovalCentre.tsx`: waiting requests, decision history and the audit log.
- `src/components/RunsPanel.tsx` and `MemoryPanel.tsx`: Tasks and runs (timeline, task transcripts, history) and the Memory Manager.
- `tests/`: automated tests (`pnpm test`), including a real Mastra session proving rejected actions never run.
- `src/components/`: the chat interface. `src/lib/client/store.ts` folds server events into state.

## Contributing

Issues and pull requests are welcome. Describe the workflow a change enables, run `pnpm exec tsc --noEmit`, `pnpm lint` and `pnpm test`, and say whether you tested it against live services or the mock model.

## License

[MIT](LICENSE) © 2026 Studio1HQ
