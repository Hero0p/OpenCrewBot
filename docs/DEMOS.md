# The 7 MeetUniversity demonstrations

How to run each demonstration from the assignment (section 4) with the real pipeline, and how to save its evidence. Nothing here is scripted: each demo is a normal instruction to the app, and the app's own records become the evidence.

**Evidence.** Every run in **Tasks and runs** has **Save as evidence**; the Approval Centre's **Audit log** tab has one too. Each writes a Markdown file into `evidence/` (or `OPENCREWBOT_EVIDENCE_DIR`) with the plan, timeline, every task's output and models, approvals and the result, labelled **LIVE** or **SIMULATED**. Add screenshots next to it.

## Before you record

1. **Model keys.** At least `GEMINI_API_KEY` (the Chief of Staff and the final write-ups need its large free allowance; a 5-task write-up used about 44,000 input tokens). `GROQ_API_KEY` and `OPENROUTER_API_KEY` add fallbacks. Free tiers run out (OpenRouter: 50 free requests a day without credits), so don't rehearse heavily on recording day.
2. **Check Settings** (bottom of the sidebar): the Models button must not say "Mock mode". The home screen says LIVE or SIMULATED.
3. **Integrations** (for demos 4 and 7): `COMPOSIO_API_KEY` must be a *project* API key from platform.composio.dev. Open **Connections**; the "What's working" list must show the apps you need as **LIVE**. Connect GitHub, Notion and Slack there, then switch each on for the agents that need it, in the agent's Details (Kai: GitHub; Sasha: Slack; Maya or Leo: Notion).
4. **Data.** Upload `samples/meetuniversity-sales-SYNTHETIC.csv` in **Skills, tools and files → Files → Upload** (demo 3). It is a synthetic sample, and the analysis must say so.

## Demo 1: Market intelligence

- **Where:** the **Market Intelligence** room (led by Morgan, the Chief of Staff).
- **Say:** `@morgan Research the competitive landscape for MeetUniversity (https://www.meetuniversity.com/): identify competitors, their products, publicly available pricing, target customers and positioning, and the market opportunities for us. Have the facts verified, and give me one consolidated report with a comparison table and sources.`
- **What happens:** Morgan posts the plan (who does what, what runs in parallel). Research and competitor tasks start at the same time, Quinn verifies, and Morgan consolidates. Notices ("✓ Vega finished …") appear in the room.
- **Show:** Tasks and runs → the run: overlapping timeline bars (parallel), each task's transcript (web searches with sources), Quinn's verdicts, the final report.
- **Evidence:** Save as evidence on the run.

## Demo 2: Marketing campaign

- **Where:** the **Marketing Campaign** room.
- **Say:** `@morgan Create a campaign for MeetUniversity's Aspirations product targeting Class 11 students: research the audience and their concerns, develop campaign concepts, prepare a 30-day content calendar, and draft sample posts and one email. Save the calendar as a report.`
- **Optional (live Notion):** add `When I approve it, put the calendar on a Notion page.` The Notion action waits for your approval with its exact inputs.
- **Evidence:** Save as evidence; the calendar report in Files.

## Demo 3: Business analysis

- **Where:** the **Business Analysis** room (Dara: data, Felix: finance).
- **Say:** `@morgan Analyse uploads/meetuniversity-sales-synthetic.csv: find the conversion bottlenecks (leads → counselling → applications → enrolments), compare segments (region, channel, product line), find revenue opportunities, chart the key findings and give recommendations. It's a synthetic sample: say so in the report.`
- **Show:** "Read spreadsheet" and "Ran code" steps (exact calculations over all 360 rows), charts in Files, recommendations.
- **Evidence:** Save as evidence; the charts.

## Demo 4: Development team

- **Where:** the **Dev Team** room (Kai: engineer, Quinn: QA). GitHub is switched on for Kai.
- **Say:** `@kai Inspect the GitHub repository <owner>/<repo> (your fork): read its structure, README and open issues, identify technical issues, prioritise improvements and write a development plan with proposed changes. Then propose creating one GitHub issue for the top item, and wait for my approval.`
- **What happens:** reads (`read_from_app`) run on their own. Creating the issue (`act_in_app`) shows an approval card and a request in the **Approval Centre** with the exact title and body.
- **Show:** approve it (or reject it, to show demo 7 again), then the issue on GitHub.
- **Without Composio:** add GitHub's own MCP server in Connections ("Use GitHub preset" with a personal access token); its read tools run, and its write tools ask.
- **Evidence:** Save as evidence; screenshot of the issue.

## Demo 5: Autonomous routine

- **Where:** **Workflows** (calendar icon).
- **Do:** "Use the competitor-monitor example" → Who runs it: Morgan → When: "Every 5 minutes (for a demo)" → Schedule it. Or ask Morgan: `Set up a weekly workflow that checks our main competitors every Monday at 09:00 and reports what changed.` (his `schedule_workflow` tool).
- **Show:** **Run now** (or wait for the schedule), then a second run. Open the **Execution history**: trigger, status, duration, the **Result**, the **Report file**, and the **Transcript**. The second run's instruction contains the first run's result and reports what changed. **Pause** and **Resume**. Stop the app past a due time and start it again: a "catch-up" run.
- **Evidence:** the report files in Files; screenshot of the history. Set the schedule back to weekly afterwards (every 5 minutes uses quota).

## Demo 6: Memory

1. DM **Maya**: `Please remember for the whole team: I always want marketing copy in British English, and never use the word "leverage".`
2. **Memory** (brain icon) → Your preferences: the lines, with "by: Maya · when · why · in: chat with Maya".
3. **Restart the app** (stop `pnpm dev` and start it again).
4. DM a *different* agent, e.g. **Felix**: `What do you know about how I like marketing copy?` He knows.
5. Edit **Your preferences** in the Memory Manager: add `Sign off every piece of marketing copy with "— Team MU".` and Save (stamped "by: you").
6. Ask **Felix** for a one-line tagline: it ends with "— Team MU".

## Demo 7: Human intervention

- **Where:** DM **Sasha** (Growth, on Ask first) with Slack switched on.
- **Say:** `Post this to the #general channel on Slack: "MeetUniversity's January intake counselling is open: book a free session."`
- **What happens:** an approval card shows **Slack: send message** with Sasha's summary and the exact inputs. The same request is in the Approval Centre.
- **Do:** **Reject**. Sasha says it didn't run.
- **Show:**
  - the Approval Centre: **History**: rejected; **Audit log**: `approval.rejected` then "not run" for the tool, and no "ran" entry;
  - the Slack channel: empty.
- **Automated proof:** `pnpm test tests/approval-enforcement.test.ts`: a rejected tool's code never runs, in a real Mastra session.
- **Evidence:** Audit log → Save as evidence; screenshot of the empty channel.
- **Without Slack:** in mock mode, app changes are simulated. An approved one writes a "SIMULATED …" report to Files, and a rejected one writes nothing.

## Failure recovery (acceptance criterion)

- **Retry and reassignment:**
  1. In Vega's Details, set the model to one that will fail (e.g. `groq/not-a-real-model`).
  2. Under "If it fails", choose "Choose my own" with no fallbacks.
  3. Start demo 1. Vega's task fails, is retried after 5 s, then is **reassigned** to a teammate with the same skill ("↻ reassigned from Vega to Iris").
  4. Restore Vega's model afterwards.
- **Final write-up fails** (e.g. on quota): you still get every task's result, unedited. **Retry** on the final task reopens the plan.
- **Restart mid-run:** stop the app while a plan runs and start it again. The run continues ("picked up"), and rooms finish answering ("↻ Picking up after a restart").

## Interruption and change of plan

While a plan runs, send `@morgan Also add a short pricing comparison, and make the recommendation wait for it.` Morgan calls `update_plan`: the new task joins the running plan, a task that hasn't started can wait for it (its `feeds`; "… now wait for …" in the run's history), and the final write-up waits for it.

## Rehearsing the final evaluation (an unseen business problem)

Ask Morgan for something no seeded agent covers, e.g. `A chain of bakeries in Pune wants a subscription box. Create the agents you need and a room for them, plan the market research, pricing and a launch email, and ask me before sending anything.`

Expect:
- `create_agent` (new agents, on Ask first, with starting memory);
- `create_room`;
- a plan, with parallel tasks;
- approval for anything external;
- your interruption handled with `update_plan`.

Edit an agent's memory mid-run in the Memory Manager: the next task follows the edit.
