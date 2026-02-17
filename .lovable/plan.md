
# Combined Plan: Unify Code Paths + Fix Push for Chat Responses + Assignment Import

## Summary of Findings

### 1. Push Notification Gap for User-Initiated Chat Responses

The push notification for the AI's response to your question ("What tasks are in educational resources...") was never sent because **user-initiated chat has no push path at all**.

Here is what happens:
- You asked a question at 10:02:07 AM
- At 10:02:33 you left the app (visibility changed to "hidden", presence set to inactive)
- The AI took 42 seconds to respond (arrived at 10:02:50)
- But `useChatAssistant.ts` (frontend) calls `hybrid-assistant-api` directly and stores the response locally -- it never calls `send-chat-message` or `send-push-notification`
- So when you left before the response arrived, there was no mechanism to push it to you

Meanwhile, the 10:00 AM system-initiated message (voicemail fallback) DID push because it flows through `send-chat-message`, which has the presence check and push logic.

**The fix:** When the AI response arrives and the user is no longer active (document hidden), the frontend should fire a push notification so you know the answer came in.

### 2. Code Fragmentation: FIVE Copies of Window/Category Logic

The same `WINDOW_RANGES` and `CATEGORY_WINDOW_MAPPING` constants are duplicated in:

| Location | Type |
|---|---|
| `supabase/functions/_shared/call-context-builder.ts` | Source of truth (server) |
| `supabase/functions/send-chat-message/index.ts` lines 62-78 | Dead copy (USE_SHARED_CONTEXT=true) |
| `src/hooks/useChatAssistant.ts` lines 26-41 | Frontend copy |
| `src/utils/assignmentFetching.ts` | Implicit (date logic without windows) |
| `supabase/functions/execute-tool/index.ts` | Missing entirely (should use it) |

Voice and chat SHOULD point to the same server-side code. The frontend should not have its own copy.

### 3. Assignment Import: Current State

The existing sync system (`AssignmentSyncSettings.tsx`) imports from Google Sheets into `assignments` (EMBA, 1172 records) and `assignments_mit` (21 records), then converts them to tasks via `assignmentSync.ts`. But:

- It only imports future assignments between class weekends (EMBA) or next 2 weeks (MIT)
- No "full import" option for past + future
- No import that targets specific Kanban lanes (Up Next, Ready)
- Deduplication works via `scheduling_context` tags but fetches ALL user tasks to check (slow with 1172 assignments)

---

## Implementation Plan

### Part 1: Fix Push Notification for User-Initiated Chat Responses

**File: `src/hooks/useChatAssistant.ts`** (after line 654, where the assistant response is saved)

After storing the AI response, check if the document is hidden. If so, call `send-push-notification` to alert the user:

```text
After saving assistant message to conversation_messages:
1. Check document.visibilityState === 'hidden'
2. If hidden, invoke send-push-notification:
   - title: "Iris"
   - body: truncated response (first 100 chars)
   - data: { type: 'chat_message', openCommsConsole: true, threadId }
3. If visible, skip (user can see it)
```

This uses the same push function that system-initiated messages use -- same code path, same notification format.

### Part 2: Eliminate Frontend Window Logic Duplication

**File: `src/hooks/useChatAssistant.ts`**

Remove the duplicated `WINDOW_RANGES`, `CATEGORY_WINDOW_MAPPING`, and `detectCurrentWindow()` (lines 25-54). Instead, rely on the enriched `get_tasks` response (from Part 4 below) which will include `current_window` computed server-side.

If any frontend-only window detection is still needed (e.g., for UI hints before a tool call), extract it to a shared utility like `src/lib/timeWindows.ts` that is imported by any file that needs it -- single source for the frontend.

### Part 3: Comment Out Dead Code in send-chat-message

**File: `supabase/functions/send-chat-message/index.ts`**

Comment out (not delete) lines 61-334 -- the duplicated `CATEGORY_WINDOW_MAPPING`, `WINDOW_RANGES`, `getTodaysBriefing`, `getTasksForWindow`, `getTopicsForWindow`, `formatTaskList`, `buildWindowTransitionContext`, `buildCallContext`, and `buildLegacyContext`. These are only used when `USE_SHARED_CONTEXT = false` (currently `true`). Add a comment explaining they are preserved for rollback.

### Part 4: Enrich `get_tasks` with Topic + Window Context

**File: `supabase/functions/execute-tool/index.ts`**

After the main task query returns (around line 524):

1. Collect all returned task IDs
2. Query `task_topic_mappings` joined with `task_topic_index` to get `topic_name` per task
3. Attach `topic_group` to each task (default: "Uncategorized")
4. Compute `current_window` from the user's timezone using `WINDOW_RANGES` imported from `call-context-builder.ts`
5. Call `getTopicGroupsManual` (already imported but unused) for the ranked topic list
6. Return enriched response: `{ tasks, count, current_window, topic_groups }`

Apply the same to `getTodayTasks` (around line 643).

Add `topicGroups: string[]` to `ExtractedFacts` and validate in `validateAiResponse`.

### Part 5: Update Tool Descriptions and Persona

**File: `supabase/functions/_shared/tool-definitions.ts`**

- `get_tasks`: "PRIMARY retrieval tool. Returns tasks with topic_group labels and current time window context."
- `get_today_tasks`: "Alias for get_tasks with time_filter='today'. Prefer get_tasks."
- `get_tasks_by_topic`: "DRILL-DOWN tool. Requires EXACT topic_name from get_tasks results."

**File: `supabase/functions/_shared/persona.ts`** (replace lines 32-36)

Add structured sections: TASK RETRIEVAL (tool selection guidance), TOPIC GROUPS (authoritative structure, never invent names), TIME WINDOWS (context-appropriate suggestions).

**File: `supabase/functions/hybrid-assistant-api/index.ts`** (lines 422-428)

Inject current window and ranked topic groups into the system instructions for every chat request. Update DATA INTEGRITY RULES with topic-specific rules.

**File: `supabase/functions/generate-realtime-token/index.ts`** (lines 50-63)

Replace the hardcoded persona string with the shared `getDefaultIrisPersona()` so in-app voice gets the same instructions.

### Part 6: Fix Chat Fallback Race Condition

**File: `supabase/functions/send-chat-message/index.ts`**

Add deduplication before AI generation (around line 446):
- Query `conversation_messages` for a system-initiated assistant message for the same user within the last 90 seconds
- If found, return early with `{ success: true, deduplicated: true }`

Add retry with backoff: if `hybrid-assistant-api` returns "run is active" error, wait 5 seconds and retry once.

### Part 7: Presence Staleness Guard

**File: `supabase/functions/send-chat-message/index.ts`** (line 587)

Add `last_seen_at` to the presence query. If `is_active` is true but `last_seen_at` is older than 5 minutes, treat as stale and send push anyway.

### Part 8: Assignment Import with Full/Upcoming Modes

**File: `src/components/AssignmentSyncSettings.tsx`**

Add an import mode selector with two options:

- **Upcoming Only** (default): This week + next week's assignments pushed to "Up Next" lane. This is similar to current behavior but targets Up Next specifically.
- **Full Import**: All past + future assignments. Past assignments go to "Ready" (they are overdue). Future assignments go to "Up Next".

**File: `src/utils/assignmentSync.ts`**

Update `createTasksFromAssignments` and `createTasksFromMitAssignments`:

1. Accept an `importMode` parameter: `'upcoming' | 'full'`
2. For `upcoming` mode: filter to assignments with due dates within this week and next week. Set status to `UP_NEXT`.
3. For `full` mode: import all assignments. Set status based on due date:
   - Past due date: `READY` (overdue, needs attention now)
   - Future due date: `UP_NEXT`
4. Improve deduplication: instead of fetching ALL tasks and filtering client-side, query with a filter on `scheduling_context` containing `assignment_id:` or `mit_assignment_id:` to reduce data transfer.
5. Both EMBA and MIT use the same unified import function with a `source` parameter to differentiate.

**File: `src/utils/assignmentFetching.ts`**

Update `fetchPendingAssignments` to accept an `importMode` parameter:
- `upcoming`: current behavior (this week + next week)
- `full`: no date filtering, return all assignments

### Part 9: Persistent Fallback Logging

**File: `supabase/functions/twilio-voice-handler/index.ts`**

Add `activity_log` entries at each voicemail detection decision point so failures are debuggable after edge function logs rotate:
- `voicemail_detection`: duration, answeredBy, isLikelyVoicemail
- `voicemail_session_lookup`: found via call_sid? fallback?
- `voicemail_fallback_result`: success/failure

Add fallback session lookup: if `call_sid` lookup returns null, try finding the session by phone number + 5-minute window.

---

## Files Changed

| File | Changes |
|---|---|
| `src/hooks/useChatAssistant.ts` | Add push notification when AI response arrives and user is away; remove duplicated WINDOW_RANGES |
| `src/lib/timeWindows.ts` | NEW -- shared frontend window detection utility (if needed) |
| `src/components/AssignmentSyncSettings.tsx` | Add Upcoming/Full import mode toggle |
| `src/utils/assignmentSync.ts` | Add importMode parameter; improve deduplication query; set lane based on mode |
| `src/utils/assignmentFetching.ts` | Add importMode parameter for full vs upcoming |
| `supabase/functions/execute-tool/index.ts` | Enrich get_tasks + get_today_tasks with topic groups + window |
| `supabase/functions/_shared/tool-definitions.ts` | Update tool descriptions |
| `supabase/functions/_shared/persona.ts` | Add TASK RETRIEVAL + TOPIC GROUPS + TIME WINDOWS sections |
| `supabase/functions/hybrid-assistant-api/index.ts` | Inject window + topic context; update DATA INTEGRITY RULES |
| `supabase/functions/generate-realtime-token/index.ts` | Replace hardcoded persona with shared function |
| `supabase/functions/send-chat-message/index.ts` | Comment out dead code; add deduplication + retry; add staleness guard |
| `supabase/functions/twilio-voice-handler/index.ts` | Add fallback session lookup + activity_log tracing |

## Deployment

1. Deploy: `execute-tool`, `send-chat-message`, `hybrid-assistant-api`, `generate-realtime-token`, `twilio-voice-handler`
2. Run `sync-assistant-tools` to propagate tool description + persona changes
3. No database changes needed
