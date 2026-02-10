
# Refactor: Window-Specific Call Scripts with Task-Driven Topic Groups

## Summary

Replace the generic `buildBranch1Context`, `buildBranch2Context`, and `buildCallContext` in `supabase/functions/twilio-scheduled-call/index.ts` with per-window call flows that match the original spec. Topic groups are built from actual window-aligned tasks (not static `window_affinity`), with a "look across the entire board?" fallback.

The AI receives these as queued agenda items with accept order -- not verbatim scripts. The AI drives the conversation naturally.

## Single File Changed

`supabase/functions/twilio-scheduled-call/index.ts`

## Changes

### 1. Replace `getTopicsForWindow` (lines 141-160) with two new functions

**`getTopicGroupsFromWindowTasks(supabase, userId, window)`**
- Query open tasks (not BLOCKED, not DONE, not test) whose category maps to the current window via `CATEGORY_WINDOW_MAPPING`
- JOIN `task_topic_mappings` on `task_id` then JOIN `task_topic_index` on `topic_id`
- GROUP BY topic, count tasks per topic, count tasks updated in last 14 days (recency), count HIGH/URGENT tasks (priority density)
- ORDER BY recency DESC, priority_density DESC, task_count DESC
- LIMIT 5

**`getTopicGroupsFromAllTasks(supabase, userId)`**
- Same query but no category-window filter -- all open tasks
- Same grouping, ranking, limit
- Used as the "across the entire board" fallback

### 2. Replace `buildBranch1Context` (lines 230-273) and `buildBranch2Context` (lines 276-327)

Replace with a single `buildWindowContext` function that switches on `window` and produces per-window agenda items. Each window's context tells the AI the accept order (what to cover and in what sequence) but explicitly instructs it to drive the conversation naturally -- not repeat text verbatim.

#### 6:00 AM -- Morning Kickstart

**Tasks exist:** Agenda queue:
1. Greet user
2. Remind them of morning tasks (provided as data)
3. Ask: confirm, adjust, or skip
4. If confirm: acknowledge, mention callback later. Close.
5. If adjust: capture edits via tools (reschedule_task, update_task). Confirm. Close.

**No tasks:** Agenda queue:
1. Greet user
2. Brief nudge -- day is starting, will call back in a few hours. Close.
3. No topic jog. Keep lightweight.

#### 9:00 AM -- Business Hours Execution

**Tasks exist:** Agenda queue:
1. Greet user
2. Handle any tangent, then return to plan
3. Present business-hours tasks (provided as data)
4. Ask which one to start with
5. If they pick one: mark in progress via update_task

**No tasks -- Topic Jog (two tiers):**
1. Greet user
2. Present window-aligned topic groups (tier 1 data provided)
3. Ask if they want to work on any
4. If yes: use get_tasks to drill into that topic, help select, use parse_and_create_tasks to schedule
5. If tier 1 was empty: ask "I don't see any potential items for business hours. Do you want to look for items across the entire board?"
6. If yes to broadening: present tier 2 topic groups (all-tasks data provided). Same drill-down flow.
7. If no: acknowledge, mention next check-in. Close.

#### 5:00 PM -- Daily Wrap + After-Work (Two Phases)

**Phase 1 -- Status Wrapup:** Agenda queue:
1. Greet user
2. Ask about completed tasks to mark done
3. Ask about blocked tasks or items to reschedule
4. Update statuses via tools

**Phase 2 Branch 1 (after-work tasks exist):**
5. Present after-work tasks (provided as data)
6. Ask: keep as-is, adjust, or skip

**Phase 2 Branch 2 (no after-work tasks) -- Topic Jog:**
5. Present window-aligned topic groups (tier 1)
6. If empty: "I don't see any potential items for after work. Do you want to look for items across the entire board?"
7. Same drill-down flow as 9 AM

Close: confirm updates captured.

#### 7:00 PM -- Evening Work Items

**Tasks exist:** Agenda queue:
1. Greet user warmly (evening tone)
2. Present evening tasks (provided as data)
3. Ask: confirm, adjust, or skip

**No tasks -- Topic Jog (two tiers):**
1. Greet user
2. Present evening-aligned topic groups (tier 1)
3. If empty: "I don't see any potential items for this evening. Do you want to look for items across the entire board?"
4. Same drill-down and scheduling flow

Close: wish them a good evening.

#### Weekend 10:00 AM -- Saturday/Sunday

Detect current day name (Saturday or Sunday) and reference it.

**Tasks exist:** Agenda queue:
1. Greet user (weekend tone)
2. Present weekend tasks for today (provided as data), referencing the day by name
3. Ask: confirm, adjust, or skip

**No tasks -- Topic Jog (two tiers, LIFE focus):**
1. Greet user
2. Present weekend/LIFE-aligned topic groups (tier 1)
3. If empty: "I don't see any potential items for today. Do you want to look for items across the entire board?"
4. Same drill-down and scheduling flow

Close: enjoy the weekend.

### 3. Update `buildWindowTransitionContext` (lines 178-227)

- Call the new `getTopicGroupsFromWindowTasks` instead of `getTopicsForWindow`
- Also call `getTopicGroupsFromAllTasks` as the tier 2 fallback data
- Pass both tier 1 and tier 2 topic data into `buildWindowContext`
- Add weekend day detection (Saturday vs Sunday)

### 4. Replace `buildCallContext` switch cases (lines 345-403)

The `morning_standup`, `midday_checkin`, `eod_wrapup` cases currently use generic 6-step numbered agendas. Replace them to route through window detection the same way window-transition calls do. The `[WINDOW:xxx]` marker already exists in `call.context` for window calls; for legacy call types without the marker, map them: `morning_standup` to `morning`, `midday_checkin` to `business_hours`, `eod_wrapup` to `after_work`. Custom calls remain unchanged.

### 5. Context Format Convention

Every context string will include a header block instructing the AI:

```
IMPORTANT: The items below are your agenda queue in priority order.
Cover them in sequence but drive the conversation naturally.
Do NOT read these items verbatim -- use your own words.
Use your available tools for any changes the user requests.
```

This ensures the AI treats the agenda as a queue to work through, not a script to recite.

## What Does NOT Change

- `getTasksForWindow` (lines 88-138) -- still used for branch 1 task filtering
- `CATEGORY_WINDOW_MAPPING` and `WINDOW_RANGES` constants
- `formatTaskList` helper
- All tool definitions (`_shared/tool-definitions.ts`)
- `execute-tool/index.ts`
- Bridge files (Supabase/Cloudflare)
- Agenda manager / agenda wrapper
- Pre-caching flow (buildCallContext runs once, result passed to bridge)
- `processRecurringCalls` and the serve handler

## No New Dependencies

No new edge functions, no database migrations, no new tools. Full reuse of existing `parse_and_create_tasks`, `update_task`, `reschedule_task`, `get_tasks`, and `schedule_task`.
