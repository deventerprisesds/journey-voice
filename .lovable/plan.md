

# Revised Stabilization Plan — Item 6 Corrected

## Summary of Issues

1. **WeeklyAgendaView timezone mismatch** — uses hardcoded defaults instead of user config; tasks after 1pm disappear
2. **External events missing from Agenda tab and DailyScheduleView** — only tasks render
3. **Generic provider badges** — shows "calendar" or "Google" instead of account email + calendar name
4. **Weekly history destroyed on rollover** — past days empty out, no way to see completed/rolled items
5. **Rollover erases schedule evidence** — `start_time` cleared with no history record
6. **Tasks scheduled outside time windows** — `execute-tool` (`scheduleTask`, `rescheduleTask`) and `smart-calendar-scheduler` write `is_scheduled: true` with any time the AI suggests. **No `validateTaskWindow` call exists in these paths.** Only `batch-calendar-scheduler` validates. This is the root cause of overnight scheduling — the scheduling engine places tasks at invalid times, and alerts follow naturally.

## Corrected Item 6: Enforce Window Validation at Every Scheduling Write Path

### Root Cause (verified in code)

| Scheduling path | Has `validateTaskWindow`? |
|---|---|
| `batch-calendar-scheduler` (line 500) | YES — rejects violations |
| `nightly-schedule-builder` → calls batch | YES (inherited) |
| `execute-tool/scheduleTask` (line 942) | **NO** — writes any time |
| `execute-tool/rescheduleTask` (line 860) | **NO** — writes any time |
| `smart-calendar-scheduler` | **NO** — AI suggests, no post-validation |

### Fix

Add `validateTaskWindow` to all three unguarded paths:

**`execute-tool/index.ts`** — In both `scheduleTask` and `rescheduleTask`:
- Import `resolveConfig` and `validateTaskWindow` from `_shared/scheduling-defaults.ts`
- After normalizing `start_time`, load user config from `user_scheduling_prefs`
- Call `validateTaskWindow(normalizedStartTime, task.category, timeWindows, categoryMappings, timezone)`
- If `!valid`: return an error message telling the AI the time violates window constraints, listing allowed windows — do NOT silently write the invalid time
- The AI can then retry with a corrected time

**`smart-calendar-scheduler/index.ts`** — After the AI returns a suggested time:
- Import and call `validateTaskWindow` on the suggestion
- If invalid, reject with an explanation of allowed windows for that category
- Already has config loaded; just needs the validation call

### What This Fixes

Tasks will no longer be placed at 2am, 4am, or any time outside the user's configured windows. The overnight alerts stop because the scheduling itself is prevented, not just the notification.

## Items 1-5 (Unchanged from Previous Plan)

1. **Fix WeeklyAgendaView timezone/config** — load `user_scheduling_prefs` instead of `DEFAULT_SCHEDULING_CONFIG`; use timezone-aware day grouping and window detection matching `TimeSlotGrid`
2. **External events in all views** — pass `externalEvents` into AgendaTab day buckets and DailyScheduleView's `TimeSlotGrid`; include in counts and empty-state logic
3. **Traceable source labels** — replace generic badges with `provider_account_email` + humanized `calendar_id`; treat `office365` as `outlook` everywhere
4. **Preserve weekly history** — write schedule snapshots to `schedule_history` before rollover clears `start_time`; render past days with completion/rollover markers in FocusView weekly strip
5. **Fix rollover bookkeeping** — record prior slot + pushed_count in history before clearing; keep completed tasks visible in retrospective view

## Files to Change

| File | Change |
|------|--------|
| `supabase/functions/execute-tool/index.ts` | Add `validateTaskWindow` to `scheduleTask` and `rescheduleTask`; reject invalid window placements with error message |
| `supabase/functions/smart-calendar-scheduler/index.ts` | Add post-AI `validateTaskWindow` check on suggested time |
| `src/components/WeeklyAgendaView.tsx` | Load user config/timezone; merge external events into Agenda tab; traceable source labels |
| `src/components/DailyScheduleView.tsx` | Fetch and pass external events to TimeSlotGrid |
| `src/components/FocusView.tsx` | Source labels (email + calendar); `office365` = `outlook`; history-aware weekly view |
| `supabase/functions/nightly-schedule-builder/index.ts` | Write to `schedule_history` before clearing rolled-over tasks |

## Implementation Order

1. Window validation in `execute-tool` + `smart-calendar-scheduler` (stops the bleeding)
2. WeeklyAgendaView timezone/config fix
3. External events in Agenda tab + DailyScheduleView
4. Source labels across all views
5. Schedule history preservation + weekly retrospective UI

