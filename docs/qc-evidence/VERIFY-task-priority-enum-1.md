# VERIFY-task-priority-enum-1

- WHAT: independent verification of the task_priority enum fix (normalizePriority / recognizePriority and its call sites).
- WHY: 2026-11-19 18:21/18:22 UTC Iris's task creation failed with 22P02 (ai-task-parser returned priority "BACKLOG").
- SUPERSEDES: nothing. SUPERSEDED-BY: nothing -- current.
- EVIDENCE: this file; commands below.

VERIFY LOOP: 1
Branch/commit verified: origin/claude/vibrant-allen-p52snq @ f6272424 (origin/main 13d68d8c + 1 commit)
Verdict: PARTIAL -- claims 1,2,3,4,6,7 CONFIRMED; claim 5 REFUTED (two unguarded web writers)
Defects found:
  1. src/components/TaskCreationModal.tsx:656 (insert :681) -- input: ai-task-parser priority "BACKLOG" (or "high"); observed: written raw, whole multi-row insert refused (22P02); expected: MEDIUM (or HIGH).
  2. src/components/SmartTaskInput.tsx:124 (insert :121, source ItineraryEngine.ts:391) -- same input; observed: written raw (only falsy defaulted at :235); expected: normalized.
  3. (minor, not enum) supabase/functions/execute-tool/index.ts:1009/1035 -- an ignored priority is not reported to the caller; a priority-only bad update says "No updatable fields provided".
Cheap suite re-run covering EVERYTHING: `node --experimental-strip-types --test supabase/functions/_shared/task-priority.test.ts` 8/8 pass; `npm test` 726/726 pass (88 suites)

## Claim verdicts (appended as they land)

### Claim 1 -- helper semantics: CONFIRMED
Read `supabase/functions/_shared/task-priority.ts`. Probe script (node --experimental-strip-types) over 38 inputs:
- Correct mapping: "  high  ", "HiGh", "\thigh\n" -> HIGH; "critical", "Critical " -> URGENT; "medium" -> MEDIUM.
- Non-strings (1, 0, {}, [], ["HIGH"], null, undefined, true, NaN, new String("HIGH")) -> normalize MEDIUM / recognize null. No throws.
- Prototype-key probes ("toString", "constructor", "__proto__", "CONSTRUCTOR") -> MEDIUM/null: the alias lookup is on the UPPER-cased string, and no Object.prototype key is all-upper-case, so `PRIORITY_ALIASES[up]` cannot return a function.
- Every output is in {LOW,MEDIUM,HIGH,URGENT} or null. The enum can never be violated by the helper.
- Lossy-but-safe (intent lost, MEDIUM/null returned): "Urgent!", "high priority", "high-priority", "P1", "p0", "immediate", "asap", "HIGH​" (zero-width), full-width "ＨＩＧＨ". None is a DB failure; they are a quality gap, not an enum defect.

### Claim 2 -- execute-tool call sites: CONFIRMED
- create_task `execute-tool/index.ts:930` `priority: normalizePriority(args.priority)`; insert at :958.
- update_task :1009 `if (recognizePriority(args.priority)) updateData.priority = ...` -- a bad priority is skipped and the other fields (title/status/category/tags/DoD...) still go into `updateData`, so they apply.
- batch update :1085 same shape; per-row, other fields kept.
- parse_and_create_tasks :1898 `priority: normalizePriority(task.priority)`; insert at :1928. The 2026-11-19 "BACKLOG" input now writes MEDIUM (probe above).
- The only two `.insert` into tasks in execute-tool are :958 and :1928; both guarded.
- Minor (not an enum defect): an update whose ONLY field is a bad priority returns "No updatable fields provided" (:1035-1038), and a dropped priority is never reported back, unlike a dropped category which gets `category_not_changed`. The caller cannot tell its priority was ignored.

### Claim 3 -- twilio-voice-handler: CONFIRMED
`twilio-voice-handler/index.ts:2` imports normalizePriority; :340 `priority: normalizePriority(args.priority)`; :67 schema enum `["LOW","MEDIUM","HIGH","URGENT"]` (no CRITICAL). No other priority write in the file.

### Claim 4 -- MCP create_task: CONFIRMED
`src/lib/mcp/tools/create-task.ts:20` zod enum low|medium|high|urgent, :57 `payload.priority = priority.toUpperCase()`. Bundle `supabase/functions/mcp/index.ts:59,85` identical. Input is zod-restricted so only the 4 values can arrive. MCP has no update path that writes priority.

### Claim 5 -- no other writer can put a non-enum priority in public.tasks: REFUTED
Swept all 46 non-test files under supabase/functions and src that reference `.from('tasks')`, plus RPCs and migrations.
Guarded / safe: execute-tool (4 sites), twilio-voice-handler, MCP, nightly-assignment-sync (`_shared/assignment-intake.ts:166 priorityOf` -> enum or HIGH), `src/utils/assignmentSync.ts:6 mapPriority`, `TaskCreationModal.tsx:929 mapPriority` (assignments), `RealtimeVoiceAssistant.ts:1490 normalizePriority` (own copy), KanbanBoard/EnhancedTaskGridView literal 'MEDIUM', TaskDetailModal/manual Select bound to the 4 values. huddle-proxy writes nothing itself (forwards to execute-tool). No RPC or migration writes `priority`.
UNGUARDED -- same failure class as the incident, model output written raw:
- D1 `src/components/TaskCreationModal.tsx:656` `priority: task.priority` -> multi-row `.insert(tasksWithMeta)` at :681. `task` comes from `ai-task-parser` (invoked :504, stored raw at :531/:598). One bad priority ("BACKLOG", or lower-case "high") makes Postgres refuse the WHOLE batch -- every task in the modal fails, exactly the 2026-11-19 shape. Used by FocusView, CalendarModule, KanbanBoard, DailyScheduleView, EnhancedTaskGridView, TabbedKanbanBoard, Calendar page.
- D2 `src/components/SmartTaskInput.tsx:124` `priority: editedSuggestion.priority` -> `.insert` at :121. Source: `ItineraryEngine.ts:391` passes `ai-task-parser`'s `parsedTask.priority` through unchanged; SmartTaskInput.tsx:235 only defaults a FALSY value (`|| 'MEDIUM'`), so "BACKLOG" survives; `EditableTaskSuggestion.tsx:35` keeps it unless the user edits the Select.
Root cause location: `supabase/functions/ai-task-parser/index.ts` returns the model's `priority` un-normalized (:428 and the response). The fix guarded ONE consumer of the parser (execute-tool) while two web consumers write the same field raw. Normalizing in ai-task-parser's response (or in both web inserts) closes both.

### Claim 6 -- downstream readers reconcile: CONFIRMED
The DB enum bounds stored values to LOW|MEDIUM|HIGH|URGENT, and the helper only emits those. Readers: nightly-schedule-builder :1107 weight map URGENT/HIGH/MEDIUM/LOW with `|| 1` default, :589 HIGH/URGENT check; execute-tool :3070 ITINERARY_PRIORITY_WEIGHT same 4; huddle-task-sync forwards `to_jsonb` and never touches priority; Huddle `lib/tasks/scoring.ts:7,28` TaskPriority = the same 4 with `|| 1`. ai-task-parser `extractSchedulingHints` takes priority as a param and does not branch on it. CRITICAL->URGENT maps into a value every reader already weights.

### Claim 7 -- tests: CONFIRMED (and adversarial probe in Claim 1)
- `node --experimental-strip-types --test supabase/functions/_shared/task-priority.test.ts` -> tests 8, pass 8, fail 0.
- `npm test` -> tests 726, suites 88, pass 726, fail 0.
- Break attempts: no input produced a non-enum value or a throw. Lossy-but-safe (MEDIUM/null where the intent was clear): "Urgent!", "high priority", "high-priority", "P1", "p0", "immediate", "asap", zero-width/full-width "HIGH". Correct: whitespace, mixed case, "critical", Turkish dotless "hıgh" -> HIGH.
