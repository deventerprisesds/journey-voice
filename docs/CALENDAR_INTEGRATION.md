# Calendar Integration

> Technical reference for OAuth connections, sync pipelines, and calendar UI.

## Overview

The calendar system connects to Google Calendar and Microsoft Outlook/Office365, providing bi-directional sync between external events and internal tasks. It uses OAuth 2.0 for authorization and delta-polling for incremental updates.

## OAuth Flow

### Connection Sequence

```
User clicks "Connect Google/Outlook"
  → CalendarOAuthManager builds auth URL with scopes
  → Redirect to provider consent screen
  → Provider redirects back with auth code
  → useOAuthCallback extracts code from URL params
  → Calls calendar-token-manager edge function
  → Edge function exchanges code for tokens
  → Upserts calendar_connections record (access_token, refresh_token, expires_at)
  → UI refreshes connection list
```

### Key Components

| Component | Role |
|-----------|------|
| `CalendarOAuthManager` | Renders connect buttons, builds OAuth URLs |
| `CalendarConnectionModal` | Modal wrapper for connection flow |
| `useOAuthCallback` | Hook that detects OAuth redirect and completes exchange |

### Providers

| Provider | Scopes | Token Endpoint |
|----------|--------|----------------|
| Google | `calendar.readonly`, `calendar.events` | `oauth2.googleapis.com/token` |
| Outlook | `Calendars.ReadWrite`, `offline_access` | `login.microsoftonline.com/.../token` |
| Office365 | Same as Outlook (different `provider` label) | Same endpoint |

### Best Connection Strategy

`calendar-token-manager` selects the "best" connection per user using priority:
1. Active + non-expired token
2. Active + has refresh token (can renew)
3. Most recently updated

This avoids duplicate key issues when multiple connections exist for the same provider.

## Sync Pipeline

### Inbound Sync (External → Internal)

**`calendar-delta-sync`** edge function:

1. Fetches the stored `sync_token` (Google) or `deltaLink` (Microsoft) from `calendar_connections`
2. Requests only changed events since last sync
3. Upserts into `external_calendar_events` table
4. Updates `sync_token` / `deltaLink` for next run
5. Falls back to full sync if token is expired/invalid

### Outbound Sync (Internal → External)

When a task is scheduled with `start_time` / `end_time`:
1. `calendar-integration-manager` creates/updates an event in the external calendar
2. Stores `external_event_id` on the task record
3. Links via `source_task_id` in `external_calendar_events` for 2-way updates

### Sync Triggers

- **Manual**: User clicks "Sync Now" in Calendar view
- **On connection**: Initial full sync after OAuth completion
- **Scheduled**: Via `notification-scheduler` cron (if configured)

## Calendar Module UI

### `CalendarModule` Component

Renders a full calendar view with:
- **Day/Week/Month** view modes
- External events overlaid with internal tasks
- Color-coded by source (external = provider color, internal = category color)
- Click-to-create task from empty time slot

### `CalendarSelectionPanel`

- Lists all calendars from connected accounts
- Toggle visibility per calendar via checkboxes
- Preferences stored in `localStorage` keyed by `calendar_id`
- Persists across sessions without DB round-trip

### `DailyScheduleView`

- Hour-by-hour timeline for a single day
- `TimeSlotGrid` renders 30-minute slots
- Tasks and external events positioned by `start_time` / `end_time`
- Drag to reschedule (updates task time fields)

## Smart Calendar Actions

### Re-Organize

Triggered from Calendar toolbar:
1. Queries tasks where `is_scheduled = true` AND `start_time < now()` AND `status != 'DONE'`
2. Sends batch to `smart-calendar-scheduler` with current availability
3. Receives new time slots respecting scheduling rules
4. Updates tasks with new `start_time` / `end_time`

### Fill Gaps

1. Queries unscheduled tasks (`is_scheduled = false`, status in `TODO`/`READY`/`UP_NEXT`)
2. Calculates available slots by subtracting existing events from work hours
3. Assigns tasks to gaps sorted by priority, then `estimate_minutes` fit
4. Uses `batch-calendar-scheduler` for AI-assisted placement

### Busy Slot Detection

`src/lib/timeWindows.ts` provides:
- `getBusySlots(events)` — merges overlapping events into occupied ranges
- `getAvailableSlots(busy, workHours)` — inverts busy into free windows
- Used by both Re-Organize and Fill Gaps flows

## Database Tables

| Table | Purpose |
|-------|---------|
| `calendar_connections` | OAuth tokens, provider info, sync tokens |
| `external_calendar_events` | Cached external events |
| `tasks.external_event_id` | Links task to its external calendar event |
| `tasks.is_scheduled` | Whether task has been placed on calendar |

## Key Files

| File | Role |
|------|------|
| `src/components/CalendarModule.tsx` | Main calendar UI |
| `src/components/CalendarOAuthManager.tsx` | OAuth connection flow |
| `src/components/CalendarSelectionPanel.tsx` | Calendar visibility toggles |
| `src/hooks/useOAuthCallback.tsx` | OAuth redirect handler |
| `src/lib/timeWindows.ts` | Availability calculation |
| `supabase/functions/calendar-token-manager/` | Token exchange + refresh |
| `supabase/functions/calendar-delta-sync/` | Incremental sync |
| `supabase/functions/calendar-integration-manager/` | Outbound event CRUD |

---

*See also: [ARCHITECTURE.md](./ARCHITECTURE.md), [EDGE_FUNCTIONS.md](./EDGE_FUNCTIONS.md), [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)*
