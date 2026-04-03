

# Combined Plan: Exhaustive Date/Time Fixes + Calendar Sync + Assignment Links + Scheduling Gaps

This plan covers all pending work from both approved plans in a single implementation pass.

---

## A. Exhaustive Date/Time Leak Fixes

Every file still using ad-hoc date logic, replaced with shared timezone helpers.

### Server-side (edge functions)

| File | What to fix |
|------|-------------|
| `nightly-schedule-builder/index.ts` line 509 | `startsWith(targetISO)` → filter using `dayBounds.start`/`dayBounds.end` comparisons |
| `execute-tool/index.ts` lines 74, 1597 | Use `getTodayInTimezone(tz)` instead of `toISOString().split('T')[0]` |
| `ai-task-parser/index.ts` line 408 | Use `getTodayInTimezone(tz)` for past-date validation |
| `send-chat-message/index.ts` line 120 | Use `getTodayInTimezone(tz)` for query filter |
| `call-context-builder.ts` line 137 | Same fix |
| `twilio-voice-handler/index.ts` lines 242, 284 | Use `getTodayInTimezone(tz)` instead of constructing from `toLocaleString` then splitting ISO |

### Client-side (components/hooks)

| File | What to fix |
|------|-------------|
| `TabbedKanbanBoard.tsx` lines 110-111 | Replace `isToday(parseISO(...))` with `getDateInTimezone(x, tz) === getTodayInTimezone(tz)` |
| `CalendarModule.tsx` lines 453, 458, 471, 604 | Replace `isSameDay()` / `isToday()` with timezone-aware helpers |
| `WeeklyAgendaView.tsx` lines 204, 209, 266, 393, 411, 269, 413 | Replace `format(day, 'yyyy-MM-dd')` with `dateToKeyInTimezone(day, tz)` and `isToday()` with timezone-aware check |
| `GanttChart.tsx` lines 113, 239, 330 | Replace `format(date/new Date(), 'yyyy-MM-dd')` comparisons with `dateToKeyInTimezone` |
| `FocusView.tsx` lines 344, 538-544, 786 | Replace `format(today, 'yyyy-MM-dd')` with `dateToKeyInTimezone`; fix clearing bounds to use proper timezone conversion |
| `TaskCreationModal.tsx` line 204 | Replace `format(new Date(), 'yyyy-MM-dd')` with `getTodayInTimezone(tz)` |
| `KanbanBoard.tsx` line 545 | Replace `toISOString().split('T')[0]` with `dateToKeyInTimezone` |
| `ScheduleGenerator.tsx` line 96 | Same replacement |
| `ItineraryEngine.ts` lines 188, 349 | Same replacement |
| `useBatchScheduling.ts` line 56 | Same replacement |

---

## B. Scheduling Gap Fixes (nightly-schedule-builder)

### B1. Flexible capacity aggregation
Currently line 656 checks `windowRemaining[winName] >= duration` per-window. If a task maps to `flexible` (falls back to all active windows), it tries each window individually and skips if none has enough room alone — even if aggregate capacity exists.

**Fix**: When preferred windows equals all active windows (flexible fallback), check total remaining across all windows. If total >= duration, assign the task to the window with the most remaining capacity and deduct.

### B2. Same-day title dedup
Line 587 filters by `scheduledTitles` which only tracks titles from previous days. Multiple DB rows with the same title can all enter the same day's pool.

**Fix**: After scoring, deduplicate by normalized title (lowercase, trimmed), keeping the highest-scored instance.

### B3. Day-of-week context in batch-scheduler prompt
The prompt already has `targetDateStr` (readable date) but no explicit day name or day-specific hints.

**Fix**: Add to the prompt header:
- Day name: e.g., "This is a SUNDAY"
- Consolidation hint: "Group similar-category tasks into contiguous blocks when possible"
- Shifting hint: "If shifting an earlier task by 15-30 minutes creates room for an additional task, prefer the shift"

---

## C. Calendar Sync Staleness Fix

### C1. Stale event cleanup in delta-sync
After a full sync (no sync token), the function fetches all events but never removes local rows whose `external_event_id` is not in the fetched set.

**Fix** in `calendar-delta-sync/index.ts`:
- After upserting events from a full sync, query all `external_calendar_events` for that `connection_id`, compare against fetched IDs, and delete orphans
- After every sync, delete past events where `end_time < now() - 48h` to prevent accumulation

### C2. Realtime subscription in FocusView
No realtime subscription exists for `external_calendar_events`. Events only refresh on mount or every 15 minutes.

**Fix**: Add a Supabase realtime channel subscription on `external_calendar_events` filtered by `user_id`. On INSERT/UPDATE/DELETE, refresh the events state.

### C3. Provider metadata in type and views
`ExternalCalendarEvent` type has no `provider` field. Most views don't join `calendar_connections`.

**Fix**:
- Add optional `calendar_connections?: { provider: string; provider_account_email?: string }` to `ExternalCalendarEvent` type
- Update `DailyScheduleView.tsx` and `CalendarModule.tsx` to join `calendar_connections!connection_id(provider, provider_account_email)` in their event queries
- Update `TimeSlotGrid.tsx` to use provider-aware styling (blue for Google, teal for Outlook) instead of hardcoded purple

---

## D. Assignment Hyperlinks

`assignmentFetching.ts` maps assignment rows to `Task` objects but omits `assignment_url` in all three mapping blocks (lines 36-51, 121-136, 162-177). The `Task` type already has `assignment_url` and UI components already render clickable links when it's present.

**Fix**: Add `assignment_url: assignment.assignment_url || undefined` to all three mapping blocks.

---

## Files Changed Summary

| File | Changes |
|------|---------|
| `supabase/functions/nightly-schedule-builder/index.ts` | Fix line 509 busy slot filter; flexible capacity aggregation; same-day title dedup |
| `supabase/functions/batch-calendar-scheduler/index.ts` | Add day name, consolidation/shifting hints to prompt |
| `supabase/functions/execute-tool/index.ts` | Fix lines 74, 1597 timezone |
| `supabase/functions/ai-task-parser/index.ts` | Fix line 408 timezone |
| `supabase/functions/send-chat-message/index.ts` | Fix line 120 timezone |
| `supabase/functions/_shared/call-context-builder.ts` | Fix line 137 timezone |
| `supabase/functions/twilio-voice-handler/index.ts` | Fix lines 242, 284 timezone |
| `supabase/functions/calendar-delta-sync/index.ts` | Add stale event cleanup after full sync; 48h past-event purge |
| `src/types/task.ts` | Add `calendar_connections` to `ExternalCalendarEvent` |
| `src/utils/assignmentFetching.ts` | Add `assignment_url` to all three mapping blocks |
| `src/components/TabbedKanbanBoard.tsx` | Replace `isToday()` with timezone-aware |
| `src/components/CalendarModule.tsx` | Replace `isSameDay()`/`isToday()`; join `calendar_connections` in query |
| `src/components/DailyScheduleView.tsx` | Replace `isSameDay()`; join `calendar_connections` in query |
| `src/components/WeeklyAgendaView.tsx` | Replace `format()`/`isToday()` with timezone-aware helpers |
| `src/components/GanttChart.tsx` | Replace `format()` comparisons |
| `src/components/FocusView.tsx` | Fix `format()` date keys; fix clearing bounds; add realtime subscription for events |
| `src/components/TaskCreationModal.tsx` | Replace `format(new Date(), 'yyyy-MM-dd')` |
| `src/components/KanbanBoard.tsx` | Replace `toISOString().split('T')[0]` |
| `src/components/ScheduleGenerator.tsx` | Replace `toISOString().split('T')[0]` |
| `src/components/TimeSlotGrid.tsx` | Provider-aware styling |
| `src/utils/ItineraryEngine.ts` | Replace `toISOString().split('T')[0]` |
| `src/hooks/useBatchScheduling.ts` | Replace `toISOString().split('T')[0]` |
| `docs/SCHEDULING_SYSTEM_MAP.md` | Document all fixes and anti-patterns found |

