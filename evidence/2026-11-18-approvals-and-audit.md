# Evidence: approvals and audit log

Exported 2026-11-18 16:17:13 UTC. The audit log is append-only: the app has no code that edits or deletes its rows.

## Approval requests

| Requested | Agent | Action | Decision | Decided by | Exact inputs |
| --- | --- | --- | --- | --- | --- |
| 2026-11-18 16:16:43 | Sasha | Slack: send message: Post the announcement about MeetUniversity January intake counselling to the #general channel on Slack. | **rejected** | you | `{   "action": "SLACK_SEND_MESSAGE",   "summary": "Post the announcement about MeetUniversity January intake counselling to the #general channel on Slack.",   "arguments": {     "text": "MeetUniversity January intake counselling is open: book a free session.",     "channel": "general"   } }` |

## Audit log (newest first)

| When | Event | Agent | Tool | Detail |
| --- | --- | --- | --- | --- |
| 2026-11-18 16:16:57 | tool.not_run | Sasha | act_in_app | did not run |
| 2026-11-18 16:16:57 | approval.rejected | Sasha | act_in_app | by you |
| 2026-11-18 16:16:43 | approval.requested | Sasha | act_in_app | Slack: send message: Post the announcement about MeetUniversity January intake counselling to the #general channel on Slack. |
| 2026-11-18 16:15:05 | tool.ran_auto | Morgan | save_report | succeeded |
| 2026-11-18 16:14:12 | tool.ran_auto | Morgan | load_skill | succeeded |
| 2026-11-18 16:14:00 | tool.ran_auto | Quinn | execute_typescript | succeeded |
| 2026-11-18 16:13:53 | tool.ran_auto | Quinn | execute_typescript | succeeded |
| 2026-11-18 16:13:48 | tool.ran_auto | Quinn | execute_typescript | succeeded |
| 2026-11-18 16:13:43 | tool.ran_auto | Quinn | execute_typescript | succeeded |
| 2026-11-18 16:13:41 | tool.ran_auto | Quinn | execute_typescript | succeeded |
| 2026-11-18 16:13:37 | tool.ran_auto | Quinn | load_skill | succeeded |
| 2026-11-18 16:13:30 | tool.ran_auto | Maya | save_report | succeeded |
| 2026-11-18 16:12:26 | tool.ran_auto | Maya | memory_add | succeeded |
| 2026-11-18 16:12:19 | tool.ran_auto | Maya | web_search | succeeded |
| 2026-11-18 16:12:08 | tool.ran_auto | Maya | web_search | succeeded |
| 2026-11-18 16:11:58 | tool.ran_auto | Maya | web_search | succeeded |
| 2026-11-18 16:11:49 | tool.ran_auto | Maya | web_search | succeeded |
| 2026-11-18 16:11:38 | tool.ran_auto | Maya | load_skill | succeeded |
| 2026-11-18 16:10:51 | tool.ran_auto | Iris | web_search | succeeded |
| 2026-11-18 16:10:46 | tool.ran_auto | Iris | web_search | succeeded |
| 2026-11-18 16:10:40 | tool.ran_auto | Iris | web_search | succeeded |
| 2026-11-18 16:10:38 | tool.ran_auto | Iris | load_skill | succeeded |
| 2026-11-18 16:09:46 | tool.ran_auto | Iris | web_search | succeeded |
| 2026-11-18 16:09:40 | tool.ran_auto | Iris | web_search | succeeded |
| 2026-11-18 16:09:35 | tool.ran_auto | Iris | load_skill | succeeded |
| 2026-11-18 16:09:21 | tool.ran_auto | Morgan | create_plan | succeeded |
| 2026-11-18 16:08:46 | tool.ran_auto | Iris | web_search | succeeded |
| 2026-11-18 16:08:41 | tool.ran_auto | Iris | web_search | succeeded |
| 2026-11-18 16:08:19 | tool.ran_auto | Iris | web_search | succeeded |
| 2026-11-18 16:08:15 | tool.ran_auto | Iris | web_search | succeeded |
| 2026-11-18 16:07:07 | tool.ran_auto | Quinn | execute_typescript | succeeded |
| 2026-11-18 16:06:49 | tool.ran_auto | Quinn | load_skill | succeeded |
| 2026-11-18 16:06:37 | tool.ran_auto | Vega | web_search | succeeded |
| 2026-11-18 16:06:31 | tool.ran_auto | Iris | web_search | succeeded |
| 2026-11-18 16:06:06 | tool.ran_auto | Iris | web_search | succeeded |
| 2026-11-18 16:05:16 | tool.ran_auto | Quinn | execute_typescript | succeeded |
| 2026-11-18 16:05:00 | tool.ran_auto | Quinn | load_skill | succeeded |
| 2026-11-18 16:04:49 | tool.ran_auto | Vega | web_search | succeeded |
| 2026-11-18 16:04:27 | tool.ran_auto | Iris | web_search | succeeded |
| 2026-11-18 16:02:44 | tool.ran_auto | Vega | ask_teammate | succeeded |
| 2026-11-18 16:02:38 | tool.ran_auto | Quinn | execute_typescript | succeeded |
| 2026-11-18 16:02:25 | tool.ran_auto | Quinn | load_skill | succeeded |
| 2026-11-18 15:58:59 | tool.ran_auto | Vega | web_search | succeeded |
| 2026-11-18 15:57:53 | tool.ran_auto | Vega | web_search | succeeded |
| 2026-11-18 15:57:44 | tool.ran_auto | Vega | web_search | succeeded |
| 2026-11-18 06:37:26 | tool.ran_auto | Dara | save_report | succeeded |
| 2026-11-18 06:36:48 | tool.ran_auto | Dara | make_chart | succeeded |
| 2026-11-18 06:36:45 | tool.ran_auto | Dara | make_chart | succeeded |
| 2026-11-18 06:36:32 | tool.ran_auto | Dara | make_chart | succeeded |
| 2026-11-18 06:36:29 | tool.ran_auto | Dara | make_chart | succeeded |
| 2026-11-18 06:36:16 | tool.ran_auto | Dara | execute_typescript | succeeded |
| 2026-11-18 06:35:52 | tool.ran_auto | Dara | read_spreadsheet | succeeded |
| 2026-11-18 06:35:50 | tool.ran_auto | Dara | list_files | succeeded |
| 2026-11-18 06:35:47 | tool.ran_auto | Dara | load_skill | succeeded |

A rejected request shows **rejected** above and `approval.rejected` in the log, followed by `tool.not_run` for its tool, never `tool.ran_approved` or `tool.ran_auto`: its code never ran.
