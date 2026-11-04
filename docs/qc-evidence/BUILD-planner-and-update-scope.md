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

## Step 3: B implemented (commit "execute-tool: scope single-task mutations to the caller's user_id")

`supabase/functions/execute-tool/index.ts`, the only source file changed:
- dispatch passes `userId` to update_task, reschedule_task, schedule_task, unschedule_task,
  swap_task_order and set_priority_rank (move_task_to_day already received it and now forwards it
  to `rescheduleTask`).
- each fn takes `userId` and adds `.eq('user_id', userId)` to every `public.tasks` query (reads
  included: the reschedule category read, the schedule existing-task read, the swap pair read).
- `.single()` became `.maybeSingle()` on the mutations, with `if (!data) return {success:false,
  error:"Task not found"}`, so an unknown or foreign id gets a clean not-found and not PostgREST's
  coerce error. updateTask's message keeps its old "no task matched id <id> (0 rows updated)" tail.
  swap returns "Task not found: both tasks must exist and belong to you".
- Not changed: scheduling logic, window checks, the status values each tool writes, and tool
  definitions.

## Step 4: Tests + mutation proof

New: `supabase/functions/execute-tool/task-scope.test.ts`. It reads the source, the same approach
as `send-push-notification/sticky.test.ts`, because execute-tool imports from deno.land and node
cannot import it. 35 cases: dispatch passes userId (x9), signature takes userId (x9), every
`.from('tasks')` chain carries `.eq('user_id', userId)` (x8, with a non-vacuity floor), a
"Task not found" branch exists (x7), moveTaskToDay forwards userId, and updateTask is
scoped + maybeSingle + not-found.

Local equivalent of `.github/workflows/checks.yml` (node v22.22.0):

| step | result |
|---|---|
| `npm test` | `# tests 452  # pass 452  # fail 0` |
| `npm run check:symbols` | `103 file(s) checked, 0 NEW undefined symbol(s), 1 known` (pre-existing baseline) |
| `bash scripts/assert-ref-contains-main.test.sh` | `7 passed, 0 failed` |

`mutate.sh` (anchors from files), each restored and checked against HEAD:

| mutation | must-fail test | verdict |
|---|---|---|
| drop user_id filter from updateTask's update | updateTask: every public.tasks query is filtered to the caller | FIRED |
| drop it from setPriorityRank | setPriorityRank: ... | FIRED |
| drop it from swap's 2nd update only | swapTaskOrder: ... | FIRED |
| dispatch `unscheduleTask(supabase, args)` | unschedule_task: dispatch passes ... | FIRED |
| moveTaskToDay fallback without userId | moveTaskToDay reaches rescheduleTask with the caller | FIRED |
| drop it from scheduleTask's existing-task READ | scheduleTask: ... | FIRED |

No live calls were made. Deploy happens on merge to main (edge fns auto-deploy). Not merged, per
the brief. Live status: **implemented, mechanism verified locally, NOT deployed, NOT confirmed live.**

## NEEDS OWNER 👍 (found, NOT changed)

| Today | Becomes | Why | Impact | Reversible? |
|---|---|---|---|---|
| Planner stale-archive (nightly-schedule-builder L548-625) sets `status:'DONE'` on any non-DONE task with pushed_count>=5 and a due date >30 days ago, or a stale EDUCATION task, **including IN_REVIEW / DOING** | Skip IN_REVIEW/DOING (and BLOCKED) in those two archive selects | DONE is supposed to be set only by the user, by hand; this auto-completes work that is awaiting your review | Old in-review/doing work would stay on the board and not vanish into DONE | yes, one filter |
| `schedule_task` always writes `status:'UP_NEXT'` and `unschedule_task` always writes `'BACKLOG'` (execute-tool) | Keep IN_REVIEW/DOING/BLOCKED, like the planner's `statusAfterSchedule` | Same demotion problem as A, but on the agent/chat path rather than nightly | An agent scheduling or unscheduling an in-review card would stop knocking it back a lane | yes |
| execute-tool takes `userId` from the request BODY and accepts the public anon key | Derive the user from the JWT, or require the service role / proxy token | B stops honest callers and stray ids from reaching other users' rows, but a caller that lies about `userId` still can | Client callers would have to send a user JWT; needs a contract change across chat/voice | yes, but multi-file |
| reschedule/schedule window check reads prefs with `(await supabase.auth.getUser()).data.user?.id \|\| ''` on a service-role client, so it is always `''` and the user's own windows are never used | Use `userId` | The per-user category windows are silently ignored today; only defaults apply | Date-only reschedules may start being blocked or allowed differently | yes |
| dispatch for `reschedule_task` / `schedule_task` does not pass `context.timezone`, so both default to America/New_York | Pass `context.timezone` | Times land wrong for non-ET users | Changes the times written for non-ET users | yes |
