# BUILD: planner-and-update-scope

# WHAT:       Build log for two owner-approved journey changes: (A) the nightly planner must not
#             demote IN_REVIEW / DOING (/ BLOCKED), (B) scope execute-tool `update_task` and siblings
#             to the calling user.
# WHY:        A: a note said nightly-schedule-builder overwrites status to 'TODO' (~837/1344/1454).
#             B: `updateTask` filtered only `.eq('id', task_id)`, so any caller holding a task uuid
#             could edit another user's task.
# SUPERSEDES: nothing.
# SUPERSEDED-BY: nothing -- current.
# EVIDENCE:   this file; branch `claude_planner-and-update-scope`, base origin/main 8b7bd07.

Written step by step and pushed after each step, so a restart loses at most one step.

## Step 1: Re-verify A on current main (8b7bd07). RESULT: ALREADY FIXED, no code change

Observation (file `supabase/functions/nightly-schedule-builder/index.ts` @ 8b7bd07):

| what | where | observed |
|---|---|---|
| helper | L29-36 | `WIP_ADVANCED_STATUSES = ['UP_NEXT','DOING','IN_REVIEW']`; `statusAfterSchedule(prev)` returns `prev` when it is in that list, otherwise `'TODO'` |
| status write #1 (Tier-A assignment pass) | L870-875 | `status: statusAfterSchedule(task.status)` |
| status write #2 (main scheduler commit) | L1427-1436 | `status: statusAfterSchedule(preScheduleStatus)` |
| status write #3 (reshuffle retry) | L1540-1548 | `status: statusAfterSchedule(preScheduleStatus)` |
| BLOCKED never a candidate | L690, L990, L1022 | `.not('status','in','("DONE","BLOCKED")')`; L1002 pool is `.in('status',['READY','UP_NEXT','TODO','BACKLOG'])` |
| clear/expire passes | L391, L436, L476, L536 | write only `start_time/end_time/is_scheduled/...`, no `status` |
| called fns | `batch-calendar-scheduler`, `nightly-assignment-sync`, `calendar-integration-manager` | `grep "status: 'TODO'"` and `grep ".update("` return nothing in batch-calendar-scheduler; no TODO write in the others |

The fix came in **d66e57a** (2026-08-06), "nightly-schedule-builder: preserve WIP status when
assigning a time (stop clobbering UP_NEXT)". The line numbers in the note (~837/1344/1454) are from
before that commit, and the file has grown since.

Interpretation: the TODO-demotion of IN_REVIEW/DOING is no longer present on main. BLOCKED cannot
be demoted because it never enters the candidate set. **Per the brief, A: no change.**

Separate finding, outside A's scope and NOT changed: the stale-archive passes (L548-590,
L600-625) select `.not('status','eq','DONE')` and write `status: 'DONE'`, so an IN_REVIEW or
DOING task with pushed_count >= 5 and a due date more than 30 days ago (or a stale education task)
gets auto-archived to DONE. See NEEDS OWNER below.

## Step 2: B, gap survey + caller audit (on 8b7bd07, before any edit)

`supabase/functions/execute-tool/index.ts`, which tool functions filter on the caller:

| tool | fn (line) | receives userId? | task query filtered on user_id? |
|---|---|---|---|
| update_task | `updateTask` L980 | no | **no**, `.eq('id', task_id)` only |
| delete_task | `deleteTask` L963 | yes | yes (the pattern to copy) |
| batch_update_tasks | `batchUpdateTasks` L1041 | yes | yes, L1062 |
| reschedule_task | `rescheduleTask` L1077 | no | **no** (category read + update) |
| schedule_task | `scheduleTask` L1164 | no | **no** (existing-task read + update) |
| unschedule_task | `unscheduleTask` L1669 | no | **no** |
| move_task_to_day | `moveTaskToDay` L3207 | yes | delegates to `rescheduleTask`, **so no** |
| swap_task_order | `swapTaskOrder` L3224 | no | **no** (read of both + 2 updates) |
| set_priority_rank | `setPriorityRank` L3245 | no | **no** |

Callers of execute-tool, and where their `userId` comes from:

| caller | userId source | is it the task owner? |
|---|---|---|
| `huddle-proxy` L198-208 | `resolveUserId(caller.entra_email)`: alias table first, then `profiles.email` | yes, the canonical owner (the same mapping the task-sync uses) |
| journey chat `hybrid-assistant-api` L277-303 | request user, the same id its `get_tasks` lists under | yes |
| journey voice `UnifiedVoiceToolHandler`, `RealtimeVoiceAssistant` L505-507, `useChatAssistant` L477/546 | `supabase.auth.getUser()` | yes |
| phone `twilio-realtime-bridge` via `_shared/tool-executor.ts`, `conversation-relay-handler` | phone/session-resolved user | yes. A null userId is already rejected with 400 by execute-tool's `serve` |
| `twilio-voice-handler` | has its own `executeTool`, does not call execute-tool | n/a |
| nightly / cron | no caller of these tools found (`grep` for the tool names outside execute-tool, tool-definitions and tests) | n/a |

Task ids reach every caller through `get_tasks`, which is `.eq('user_id', userId)` (L626), so an
honest caller only ever holds ids it owns. Conclusion: scoping cannot break any legitimate caller
found, so all seven are scoped.
