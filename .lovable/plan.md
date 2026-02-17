

# Final Deduplication + Rollback Safety Plan

## Two Concerns Addressed

### 1. Rollback Safety: The V2 Bypass Pattern

Following your established preference for additive/bypass solutions, here is the rollback strategy:

**Phase 1: Deploy shared-aware code alongside old code (not replacing it)**

- In `send-chat-message/index.ts`, add a `USE_SHARED_CONTEXT = true` flag at the top of the file
- When `true`, it delegates to the shared `call-context-builder.ts`
- When `false`, it falls back to the existing local logic (untouched)
- This means if performance worsens or topics are wrong, you flip one constant to `false` and redeploy -- instant rollback with zero code changes

```text
const USE_SHARED_CONTEXT = true;  // flip to false to rollback

if (USE_SHARED_CONTEXT) {
  // New: delegates to shared module
} else {
  // Old: local logic preserved exactly as-is
}
```

- Same flag pattern for `execute-tool/index.ts` topic groups and scheduled_calls
- Old functions are NOT deleted -- they stay in the file, just bypassed

**Phase 2: After validation in production (you confirm topics make sense across 2-3 check-ins), remove the old code paths**

This means the rollback window is unlimited -- the old code stays until you explicitly approve its removal.

### 2. Window-Appropriate Tasks Leading to Topic Groups

You are correct that the plan was missing this. Here is the actual flow you want:

```text
Current time -> Determine window (e.g. "evening")
    -> Fetch tasks whose category maps to this window (LIFE, PERSONAL, VENTURES, PROF_EDUCATION)
    -> From THOSE tasks, derive topic groups (ranked by recency, priority density, task count)
    -> Present: "Here are your evening topics ranked by importance"
    -> User picks a topic -> drill down with get_tasks_by_topic
```

The shared module (`call-context-builder.ts`) already does this correctly for phone calls via `buildWindowTransitionContext`:
1. Calls `getTasksForWindow()` -- filters tasks by category-to-window mapping
2. Calls `getTopicGroupsFromWindowTasks()` -- derives topics from those window-aligned tasks
3. Falls back to `getTopicGroupsFromAllTasks()` (tier 2) if tier 1 is empty

But the shared module's **custom call path** (lines 505-524) skips all of this -- it just passes raw user context through with no tasks or topics. This is why the voicemail fallback and custom chat check-ins produce random suggestions.

**The fix**: Enhance the shared module's custom call path to also determine the current window and include window-appropriate tasks and topic groups, then have `send-chat-message` use it.

---

## Complete Change List

### File 1: `_shared/call-context-builder.ts` -- Enhance custom call path + add `getTodaysBriefing`

**Add `getTodaysBriefing` export** (~30 lines) so both `send-chat-message` and `twilio-scheduled-call` stop maintaining their own copies.

**Enhance the custom call path** (lines 505-524) to determine the current time window and include window-appropriate tasks and topic groups:

```
// Custom calls: determine current window and include context
case 'custom':
default:
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data: prefs } = await supabase
    .from('user_scheduling_prefs')
    .select('timezone')
    .eq('user_id', userId)
    .maybeSingle();
  const tz = prefs?.timezone || 'America/New_York';
  
  // Determine current window from user's timezone
  const currentHour = parseInt(new Date().toLocaleString('en-US', {
    timeZone: tz, hour: '2-digit', hour12: false
  }), 10);
  
  let currentWindow = 'business_hours';
  if (currentHour < 9) currentWindow = 'morning';
  else if (currentHour >= 17 && currentHour < 19) currentWindow = 'after_work';
  else if (currentHour >= 19 && currentHour < 22) currentWindow = 'evening';
  // weekend detection via day-of-week could be added
  
  // Fetch window-appropriate tasks and derive topic groups
  const windowTasks = await getTasksForWindow(supabase, userId, currentWindow, tz);
  const [tier1, tier2] = await Promise.all([
    getTopicGroupsFromWindowTasks(supabase, userId, currentWindow),
    getTopicGroupsFromAllTasks(supabase, userId)
  ]);
  
  const topicsToShow = tier1.length > 0 ? tier1 : tier2;
  const topicSection = topicsToShow.length > 0
    ? '\n\nACTIVE TOPICS for this time window (ranked by recency and priority):\n' +
      formatTopicGroups(topicsToShow)
    : '';
  const taskSection = windowTasks.length > 0
    ? '\n\nTASKS for current window:\n' + formatTaskList(windowTasks)
    : '';
  
  return `${AGENDA_HEADER}\n
CALL: Custom Scheduled Check-in
WINDOW: ${currentWindow}

[USER CONTEXT]
${userContext}
${taskSection}${topicSection}

Start with a friendly greeting addressing the user context.
Then present the topic groups and ask which the user wants to explore.
Use get_tasks_by_topic to drill into their selection.`;
```

This ensures that ALL call types -- including custom/voicemail fallback -- get window-appropriate tasks leading to ranked topic groups.

### File 2: `send-chat-message/index.ts` -- Use shared module with rollback flag

**Add rollback flag** at top:
```
const USE_SHARED_CONTEXT = true;
```

**Keep all existing local functions** (lines 57-329) untouched.

**Modify `buildCallContext` call** (line 443) to conditionally use shared:
```
let contextualInstructions: string;
if (USE_SHARED_CONTEXT) {
  // Import shared module
  const { buildCallContext: sharedBuildCallContext } = await import('../_shared/call-context-builder.ts');
  contextualInstructions = await sharedBuildCallContext(
    { callType: callType, context: generateFromContext.context },
    userId,
    supabaseUrl,
    supabaseServiceKey
  );
} else {
  // Legacy local path (preserved for rollback)
  contextualInstructions = await buildCallContext(callType, generateFromContext.context, userId, supabase);
}
```

This is the minimum change -- one conditional branch at the call site. All old code stays.

### File 3: `execute-tool/index.ts` -- Fix `fetchTopicGroups` + `scheduled_calls`

**`fetchTopicGroups` (lines 1822-1829)**: Replace simple `task_count DESC` with the shared `getTopicGroupsManual` function which ranks by recency, priority density, and task count. With rollback flag:

```
const USE_SHARED_TOPICS = true;

const fetchTopicGroups = async () => {
  if (USE_SHARED_TOPICS) {
    const { getTopicGroupsManual } = await import('../_shared/call-context-builder.ts');
    return getTopicGroupsManual(supabase, userId, null);
  }
  // Legacy fallback
  const { data } = await supabase
    .from('task_topic_index')
    .select('topic_name, summary, task_count, category_affinity, updated_at')
    .eq('user_id', userId)
    .order('task_count', { ascending: false });
  return data || [];
};
```

**`scheduled_calls` section (lines 1890-1893)**: Add `fetchPendingNotifications()`:

```
} else if (section === 'scheduled_calls') {
  const [prefs, pending] = await Promise.all([
    fetchScheduledCalls(),
    fetchPendingNotifications()
  ]);
  results.scheduled_calls = prefs?.scheduled_calls || [];
  results.timezone = prefs?.timezone || 'America/New_York';
  
  const pendingCalls = (pending || []).filter(
    (n: any) => n.notification_type === 'scheduled_call'
  );
  results.upcoming_scheduled_calls = pendingCalls.map((n: any) => ({
    name: n.title,
    scheduled_for: n.scheduled_for,
  }));
  if (pendingCalls.length > 0) {
    results.next_upcoming_call = {
      name: pendingCalls[0].title,
      scheduled_for: pendingCalls[0].scheduled_for,
    };
  }
}
```

### File 4: `twilio-scheduled-call/index.ts` -- Replace local `getTodaysBriefing`

Add import, remove local copy (lines 35-67), replace usage with shared version. With rollback safety: the function already imports from the shared module (line 3), so this is low-risk.

### File 5: `classify-task-topic/index.ts` -- Import shared constant

Replace local `CATEGORY_WINDOW_MAPPING` (lines 14-21) with import from shared. Lowest-risk change since the values are identical.

---

## Deployment Sequence

1. Deploy `_shared/call-context-builder.ts` changes (enhanced custom path + getTodaysBriefing export)
2. Deploy `classify-task-topic` (constant import -- lowest risk, validates shared imports work)
3. Deploy `execute-tool` (topic ranking + scheduled_calls fix)
4. Deploy `twilio-scheduled-call` (getTodaysBriefing import)
5. Deploy `send-chat-message` (the big one -- delegates to shared module)

Each step is independently testable. If any step causes issues, the rollback flag is flipped for that function only.

## Validation

After deployment, trigger a chat check-in at the current time window and verify:
- Topics are ranked by recency and priority, not random
- Topics correspond to categories appropriate for the current window
- Custom calls include task and topic context
- `get_my_config(scheduled_calls)` returns actual pending calls from the notification queue

## Summary

| File | Risk | Rollback | Lines Changed |
|------|------|----------|---------------|
| `_shared/call-context-builder.ts` | Low | N/A (additive) | +50 |
| `classify-task-topic/index.ts` | Minimal | Revert import | -7, +1 |
| `execute-tool/index.ts` | Low | Flag | ~20 |
| `twilio-scheduled-call/index.ts` | Low | Revert import | -35, +3 |
| `send-chat-message/index.ts` | Medium | Flag (old code preserved) | +15 |

Functions to redeploy: `send-chat-message`, `execute-tool`, `twilio-scheduled-call`, `classify-task-topic`

