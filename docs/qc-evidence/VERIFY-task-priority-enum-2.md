# VERIFY-task-priority-enum-2
# WHAT:       Independent verifier loop 2 of the task_priority enum fix (claims 1-7, focus claim 5 + D3).
# WHY:        Loop 1 PARTIAL: D1/D2 (web inserts used raw parser priority). Fix commit 5b686754.
# SUPERSEDES: VERIFY-task-priority-enum-1.md (loop 1).  SUPERSEDED-BY: nothing -- current.
# EVIDENCE:   commands and outputs below.

VERIFY LOOP: 2
Branch/commit verified: claude/vibrant-allen-p52snq @ 5b686754 (merged into claude_verify-task-priority-enum as 05625f93)
Verdict: CONFIRMED (claims 1-7) | MERGE-PENDING-UAT (web insert paths) | D3 open
Defects found: 2 -- D3 (open, misleading success on mixed update), D4 (minor duplicate normalizer). Detail at bottom.
Cheap suite re-run covering EVERYTHING:
- `node --experimental-strip-types --test supabase/functions/_shared/task-priority.test.ts` -> tests 9, pass 9, fail 0
- `npm test` -> tests 727, suites 88, pass 727, fail 0

## Claims

### Claim 5 -- no writer can store a non-enum tasks.priority -- CONFIRMED (full re-sweep)
Method: grep of every `.from('tasks')` followed by insert/upsert/update in `supabase/functions` and `src`,
plus every `priority:` / `priority =` assignment in `supabase/functions`, plus `INSERT INTO tasks` /
`UPDATE tasks` in `supabase/migrations/*.sql` (zero SQL writers of priority found).
- D1 FIXED: `src/components/TaskCreationModal.tsx:657` `priority: normalizePriority(task.priority)` inside
  `tasksWithMeta`, which is the only object inserted at :683. The modal has no other tasks insert
  (`insertDemoTasks` is imported but never called in the file).
- D2 FIXED: `src/components/SmartTaskInput.tsx:126` insert and :236 display both `normalizePriority(...)`.
- Source fix: `supabase/functions/ai-task-parser/index.ts:388` normalises every parsed task; every response
  path (:497, :520, :561, :713, :728) spreads the normalised `tasks` array, so no path returns the raw value.
  Consumers of ai-task-parser: execute-tool parse_and_create (also normalises at :1898),
  TaskCreationModal, `src/utils/ItineraryEngine.ts:360` (feeds SmartTaskInput; ItineraryEngine itself
  inserts only `itineraries`/`itinerary_items`, not tasks).
- Other writers, each checked: execute-tool :930 create (normalize), :1009/:1085 updates (recognize-only),
  :1898 parse_and_create (normalize); twilio-voice-handler :340 (normalize); edge MCP `mcp/index.ts:59,85`
  and web MCP `src/lib/mcp/tools/create-task.ts:20,57` (zod enum low..urgent, then upper-cased);
  `_shared/assignment-intake.ts:166` priorityOf (own enum check, default HIGH); `_shared/work-sessions.ts:546`
  copies a DB parent's priority (already valid); create-test-task/create-quick-test-task literals;
  `src/utils/RealtimeVoiceAssistant.ts:1490` private normalizer (enum check, default MEDIUM) used at
  :1647 insert and :1735 update; `src/utils/assignmentSync.ts:6` mapPriority (enum check);
  TaskDetailModal Select offers only LOW/MEDIUM/HIGH/URGENT; KanbanBoard/EnhancedTaskGridView literal MEDIUM.
  `sync-google-sheets` / `sync-mit-sheets` write LOWER-case priority, but into `assignments`, not `tasks`
  (assignmentSync.ts/assignment-intake.ts upper-case it on the way to tasks).
- Web import resolution: same `../../supabase/functions/_shared/*.ts` shape already used at RUNTIME by
  `WeeklyAgendaView.tsx:26`, `ItineraryEngine.ts:2`, `taskScheduling.ts:6`, `SchedulingSettings.tsx:22`;
  `tsconfig.app.json:3` has `allowImportingTsExtensions: true`. Probe: Node resolving that exact relative
  specifier from `src/components/` imported the module and returned
  BACKLOG->MEDIUM, backlog->MEDIUM, high->HIGH, " Urgent "->URGENT, critical->URGENT, undefined/null/42/""->MEDIUM, DONE->MEDIUM.
  NOT RUN: a Vite build -- node_modules is absent in this sandbox (the parent checkout has none either).
- Minor, not a defect against claim 5: `RealtimeVoiceAssistant.ts:1490` is a second, divergent copy of the rule
  (no CRITICAL->URGENT alias; calls `.toUpperCase()` on any truthy value, so a non-string throws rather than
  defaulting). It cannot store a bad value; it is a duplicate of the shared helper.

### Guard P-9 (new in 5b686754) -- mutation-proved with mutate.sh
- Mutation A: `ai-task-parser/index.ts` `priority: normalizePriority(rawTask?.priority) };` -> `priority: rawTask?.priority };`
  -> `FIRED (control EQUIVALENT)`; restored, matches HEAD.
- Mutation B: `TaskCreationModal.tsx` `priority: normalizePriority(task.priority),` -> `priority: task.priority,`
  -> `FIRED (control EQUIVALENT)`; restored, matches HEAD.
- SmartTaskInput mutation NOT RUN (same regex shape as B; time budget).
- Note: P-9 is a source-text regex guard. It proves the call is present, not that the value reaches the insert;
  the reach was established by reading (claim 5 above).

### Claims 1-4, 6, 7 -- re-confirmed: CONFIRMED
- 1 helper: probe output above; `recognizePriority` null for non-enum, `normalizePriority` MEDIUM default, CRITICAL alias.
- 2 execute-tool writes: :930 normalize, :1009 recognize, :1085 recognize, :1898 normalize (read this loop).
- 3 twilio-voice-handler :340 normalize; tool schema :67 enum.
- 4 MCP create_task upper-case: edge `mcp/index.ts:85`, web `src/lib/mcp/tools/create-task.ts:57`.
- 6 downstream readers compare upper-case enum literals (call-context-builder, notification-scheduler,
  nightly-schedule-builder, send-chat-message); parser now hands batch-calendar-scheduler a normalised value
  (`extractSchedulingHints` takes priority but does not read it -- no behaviour change there).
- 7 suites: 9/9 and 727/727 (header).

### D3 (loop 1) -- update with only a bad priority -- STILL OPEN, and it CAN mislead in one shape
Read `execute-tool/index.ts:1000-1060` (updateTask) and `:1072-1109` (batchUpdateTasks):
| input | result returned to the agent | misleading? |
|---|---|---|
| `{task_id, priority:"BACKLOG"}` | `success:false, error:"No updatable fields provided"` | told it FAILED, but not why (category has its own message at :1036; priority has none) |
| `{task_id, title:"x", priority:"BACKLOG"}` | `success:true, result:{task}` -- title changed, priority silently unchanged, no `priority_not_changed` flag (category gets `category_not_changed` at :1060) | YES -- success with no signal the priority was dropped; an agent can report "priority set" |
| batch entry `{task_id, priority:"high priority"}` | entry lands in `failed` as "no fields to update"; top-level `success:true`, "Updated N of M" | partially -- only the count shows it |
| batch entry `{task_id, tags:[..], priority:"BACKLOG"}` | counted as updated; priority silently dropped | YES |
Realistic trigger: the update_task schema offers the enum (`_shared/tool-definitions.ts:89`), so an off-enum value
needs the model to ignore it (the 2026-11-19 BACKLOG came from free-form parser JSON, not a tool arg). Lower
likelihood than D1/D2, but not zero ("high priority", "P1", "BACKLOG" in a status-confused call).
No bad value is ever STORED, so claim 5 holds; D3 is an honesty-of-result defect, not an enum failure.

## Verdict
Verdict: CONFIRMED for claims 1-7 at 5b686754 (D1, D2 fixed). MERGE-PENDING-UAT for the two web insert paths
(TaskCreationModal, SmartTaskInput): mechanism proven by reading + module probe; no browser run, no Vite build
(node_modules absent). D3 open (non-blocking, pre-existing).

Defects found:
1. D3 (open, from loop 1) `supabase/functions/execute-tool/index.ts:1009` + `:1060` -- input `{task_id,title:"x",priority:"BACKLOG"}`:
   observed `success:true` with priority silently unchanged and no flag; expected a `priority_not_changed`
   marker (mirroring `category_not_changed`) and, for priority-only, an error naming the priority. Same at `:1085` (batch).
2. D4 (minor) `src/utils/RealtimeVoiceAssistant.ts:1490` -- divergent private copy of the rule: input "CRITICAL" ->
   MEDIUM (shared helper gives URGENT); a truthy non-string throws at `.toUpperCase()`. Cannot store a bad value.
