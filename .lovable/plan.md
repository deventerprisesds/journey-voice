
# Combined Stabilization Plan — IMPLEMENTED

## Completed

### Phase 1 — Migration + Window Enforcement
- ✅ Added `is_recurring` boolean column to `external_calendar_events`
- ✅ Cleared 181 "Untitled Event" records from von connection
- ✅ Reset sync token for von connection to trigger clean re-sync
- ✅ Window validation already existed in `execute-tool` (scheduleTask + rescheduleTask) and `smart-calendar-scheduler`
- ✅ Fixed missing `validateTaskWindow` import in `smart-calendar-scheduler`

### Phase 2 — Fix Delta Sync Titles + is_recurring
- ✅ Added `seriesMasterId` to Outlook `$select` params
- ✅ Batch-fetch series masters for occurrences missing `subject`
- ✅ Anti-downgrade: never overwrite existing non-empty title with "Untitled Event"
- ✅ Sync token persistence: now logs RPC success/failure
- ✅ Populate `is_recurring` for both Outlook (seriesMasterId) and Google (recurringEventId)
- ✅ Store real calendar_id from event payload instead of hardcoded 'primary'
- ✅ Enhanced diagnostic logging

### Phase 3 — History + Agenda Restoration
- ✅ Query `task_schedule_history` for past days in WeeklyAgendaView
- ✅ Render past days with history records (completed ✓, rolled-over ↩ markers)
- ✅ Past day tasks shown with muted opacity to distinguish from live items
- ✅ Live tasks only shown for today and future days
- ✅ Timezone-aware time formatting using `formatTimeInTimezone` throughout

### Phase 4 — Source Labels + Recurring Toggle
- ✅ External event badges show `provider_account_email` from connection
- ✅ Calendar ID displayed via `humanizeCalendarId`
- ✅ "Show recurring events" toggle added per connection in NotificationSettings
- ✅ Recurring events filtered at display time based on connection metadata
- ✅ MeetingsTab now receives and uses `userTimezone` for timezone-aware formatting

## Remaining (deferred)
- Schedule history preservation in `nightly-schedule-builder` (already partially implemented)
- FocusView weekly strip history integration
- CalendarModule + DailyScheduleView source labels and recurring filter
