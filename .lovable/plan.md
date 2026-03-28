

# Combined Stabilization Plan

## Issues Addressed

1. Tasks disappear from Agenda and Weekly views after rollover (no `start_time`)
2. Past days in weekly view empty out — no history
3. Outlook "von" account: 181/199 events titled "Untitled Event" (recurring occurrences)
4. Generic source labels ("calendar", "Google") instead of account email + calendar name
5. Items scheduled outside time windows causing overnight alerts
6. Need toggle to optionally hide recurring calendar events

---

## Phase 1 — Stop the Bleeding

### A. Time Window Enforcement
**Files**: `supabase/functions/execute-tool/index.ts`, `supabase/functions/smart-calendar-scheduler/index.ts`

- Before writing `start_time`, validate against user's configured time windows
- Reject or defer scheduling outside allowed windows
- Log violations to `activity_log`

### B. Fix Recurring Event Titles in Delta Sync
**File**: `supabase/functions/calendar-delta-sync/index.ts`

- Add `seriesMasterId` to Outlook `$select` params
- After collecting events, identify those missing `subject` with a `seriesMasterId`
- Batch-fetch unique series masters via `GET /me/events/{masterId}?$select=subject`
- Map occurrence titles from master; cache within run
- Never downgrade an existing non-empty title to "Untitled Event"
- Fix sync token persistence (currently always `null`) — log RPC success/failure
- Add diagnostic logging: events fetched, subjects missing, masters fetched, titles resolved

### C. Migration: Add columns + clear bad data
```sql
-- Add is_recurring flag
ALTER TABLE external_calendar_events ADD COLUMN IF NOT EXISTS is_recurring boolean DEFAULT false;

-- Clear untitled events from von connection and reset sync token
DELETE FROM external_calendar_events
WHERE connection_id = 'bb04653a-9fa9-4b23-8ab4-00a85b07665b'
  AND title = 'Untitled Event';

UPDATE calendar_connections
SET sync_token = NULL
WHERE id = 'bb04653a-9fa9-4b23-8ab4-00a85b07665b';
```

---

## Phase 2 — History and Agenda Restoration

### A. Use `task_schedule_history` for Past Days
**Files**: `src/components/WeeklyAgendaView.tsx`, `src/components/FocusView.tsx`

- Query `task_schedule_history` for the displayed week, join with `tasks` for title/category/priority
- Render past days using stored `start_time` from history records
- Completed items: checkmark + strikethrough overlay
- Rolled-over items: rollover icon + `pushed_count` badge
- Slightly muted opacity to distinguish from live items
- Keep existing `start_time` guard for today and future days (no change)

### B. Today's Backlog (Today Only)
**File**: `src/components/WeeklyAgendaView.tsx`

- At bottom of today's card only, show tasks where `!start_time && (status = READY || UP_NEXT || due_date = today)`
- Compact list, no time, sorted by priority
- Do NOT add backlog to past days — history covers those

### C. Timezone Fix for Agenda/Meetings Tabs
**File**: `src/components/WeeklyAgendaView.tsx`

- Replace `format(parseISO(...), 'h:mm a')` with `toLocaleTimeString('en-US', { timeZone: userTimezone, ... })`
- Apply in both AgendaTab event cards and MeetingsTab event cards

---

## Phase 3 — Source Labels and Traceability

### A. Store Account Email in Connection Metadata
**File**: `supabase/functions/calendar-delta-sync/index.ts`

- After successful sync, if `metadata` lacks account email, fetch `/me` (Microsoft) or `/userinfo` (Google)
- Save `userPrincipalName` / email + available calendar names to `calendar_connections.metadata`

### B. Display Real Source Labels
**Files**: `src/components/WeeklyAgendaView.tsx`, `src/components/FocusView.tsx`, `src/components/CalendarModule.tsx`, `src/components/DailyScheduleView.tsx`

- Join external events with their connection's metadata
- Render source badge as: email + calendar name (e.g., "von.ellis@enterpriseds.io · Family Calendar")
- Replace generic "calendar" / "Google" / "office365" badges

### C. Store Real Calendar ID per Event
**File**: `supabase/functions/calendar-delta-sync/index.ts`

- Replace hardcoded `calendar_id: 'primary'` with actual calendar ID from the event payload

---

## Phase 4 — Recurring Events Toggle

### A. Populate `is_recurring` During Sync
**File**: `supabase/functions/calendar-delta-sync/index.ts`

- Microsoft: `is_recurring = true` when `seriesMasterId` is present
- Google: `is_recurring = true` when `recurringEventId` is present

### B. Per-Connection Toggle
**File**: `src/components/NotificationSettings.tsx`

- Add "Show recurring events" switch under each connection card
- Persist `show_recurring_events` (default `true`) in `calendar_connections.metadata`

### C. Filter at Display Time
**Files**: `WeeklyAgendaView.tsx`, `FocusView.tsx`, `CalendarModule.tsx`, `DailyScheduleView.tsx`

- Load connection metadata alongside events
- When `show_recurring_events === false`, exclude events where `is_recurring = true`

---

## Implementation Order

1. Migration (columns + clear bad data)
2. Time window enforcement in scheduling functions
3. Delta sync fixes (titles, sync token, `is_recurring`, account email, calendar ID)
4. History integration in WeeklyAgendaView + FocusView
5. Source labels across all views
6. Recurring events toggle in settings + display filtering

## Files Summary

| File | Changes |
|------|---------|
| `supabase/functions/calendar-delta-sync/index.ts` | Series master fetch, anti-downgrade, sync token fix, `is_recurring`, account email, real calendar ID, logging |
| `supabase/functions/execute-tool/index.ts` | Time window validation before scheduling |
| `supabase/functions/smart-calendar-scheduler/index.ts` | Time window validation |
| `src/components/WeeklyAgendaView.tsx` | History query for past days, today backlog, timezone fix, source labels, recurring filter |
| `src/components/FocusView.tsx` | History in weekly strip, source labels, recurring filter |
| `src/components/CalendarModule.tsx` | Source labels, recurring filter |
| `src/components/DailyScheduleView.tsx` | Source labels, recurring filter |
| `src/components/NotificationSettings.tsx` | Recurring events toggle, persist to metadata |
| SQL migration | `is_recurring` column, clear untitled events, reset sync token |

