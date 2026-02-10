
# Refactor: Window-Specific Call Scripts with Task-Driven Topic Groups

## Status: ✅ IMPLEMENTED

All changes applied to `supabase/functions/twilio-scheduled-call/index.ts`.

### What was done

1. **Replaced `getTopicsForWindow`** with `getTopicGroupsFromWindowTasks` and `getTopicGroupsFromAllTasks` — topic groups are now built from actual window-aligned tasks via JOIN through `task_topic_mappings` → `task_topic_index`, ranked by recency, priority density, and task count.

2. **Replaced `buildBranch1Context` and `buildBranch2Context`** with a single `buildWindowContext` function that switches on window and produces per-window agenda queues with the exact conversation flows from the spec.

3. **Updated `buildWindowTransitionContext`** to fetch both tier 1 (window-aligned) and tier 2 (all tasks) topic groups, detect weekend day name, and pass everything to `buildWindowContext`.

4. **Updated `buildCallContext`** to map legacy call types (`morning_standup` → `morning`, `midday_checkin` → `business_hours`, `eod_wrapup` → `after_work`) through the same window logic. Custom calls remain unchanged.

5. **Added `AGENDA_HEADER`** convention — every context string instructs the AI to treat items as a queue in priority order, drive naturally, and not read verbatim.

### Per-window flows implemented

- **6 AM Morning Kickstart**: Confirm/adjust tasks or brief nudge (no topic jog)
- **9 AM Business Hours**: "Which one to start with?" or two-tier topic jog
- **5 PM Daily Wrap**: Phase 1 status wrapup + Phase 2 after-work tasks or topic jog
- **7 PM Evening**: Confirm/adjust or two-tier topic jog (evening tone)
- **Weekend 10 AM**: Saturday/Sunday detection, LIFE-focused topic jog

### What did NOT change

- `getTasksForWindow`, `CATEGORY_WINDOW_MAPPING`, `WINDOW_RANGES`
- `formatTaskList` helper (preserved, plus new `formatTopicGroups`)
- All tool definitions, execute-tool, bridge files, agenda manager
- Pre-caching flow, processRecurringCalls, serve handler
