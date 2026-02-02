
# 2-Way Calendar Sync: Multiple Accounts with Different Purposes

## Understanding Your Requirements

You want to:
1. **Pull calendar items** (meetings, appointments) from one or more Outlook/Google accounts (personal, business, school)
2. **Push task events** to potentially a different calendar account
3. Keep these as separate OAuth connections with distinct purposes
4. Achieve near real-time sync without breaking existing functionality

## Current State

### What Exists Today

| Component | Status | Details |
|-----------|--------|---------|
| `calendar_connections` table | Has `service_type` and `connected_services` columns but **not used** for read vs write distinction |
| OAuth Flow | Single purpose per connection - currently all connections are treated the same |
| Event Sync | `sync_events` action in `calendar-integration-manager` pulls events from ALL active connections |
| Event Creation | Creates events on ALL active calendar connections when tasks are scheduled |
| External Events | Stored in `external_calendar_events` table with `connection_id` reference |

### Database Schema Already Supports This

```text
calendar_connections:
  - service_type: TEXT (exists but unused - values like 'calendar', 'workspace')
  - connected_services: JSONB (exists but unused - can store {read: true, write: false})
```

---

## Solution: Connection Purpose System

### New Concept: Connection Purposes

Each calendar connection will have explicit **purposes**:

| Purpose | Description |
|---------|-------------|
| `READ` | Pull events from this calendar (meetings, appointments) for conflict detection |
| `WRITE` | Push task events/reminders to this calendar |
| `BOTH` | Read and write (current behavior, backward compatible) |

### Architecture

```text
User can have:
├── Work Outlook (READ only) - pulls meetings
├── Personal Outlook (WRITE only) - receives task events
├── School Google (READ only) - pulls class schedule
└── Personal Google (BOTH) - full sync
```

---

## Implementation Plan

### Phase 1: Database & Backend Updates

**1.1 Add Purpose Column to calendar_connections**

Migration to add a `purposes` column:

```sql
ALTER TABLE calendar_connections 
ADD COLUMN purposes TEXT[] DEFAULT ARRAY['READ', 'WRITE'];

-- Migrate existing connections to have both purposes (backward compatible)
UPDATE calendar_connections 
SET purposes = ARRAY['READ', 'WRITE'] 
WHERE purposes IS NULL;
```

**1.2 Update `calendar-token-manager` Edge Function**

Modify the OAuth exchange flow to accept and store the selected purpose:

- `insert_calendar_connection_for_user` RPC will accept `_purposes TEXT[]` parameter
- When re-authenticating, preserve existing purposes unless explicitly changed

**1.3 Update `calendar-integration-manager` Edge Function**

Add purpose-aware logic:

- `sync_events`: Only process connections with `READ` purpose
- `create_event`: Only use connections with `WRITE` purpose
- Add new action: `get_write_connections` - returns connections available for creating events

### Phase 2: Delta Sync for Incoming Changes

**2.1 Create New Edge Function: `calendar-delta-sync`**

This function will poll Microsoft Graph and Google Calendar APIs for changes:

```typescript
// For Outlook
GET https://graph.microsoft.com/v1.0/me/calendarView/delta
  ?startDateTime={lastSyncTime}
  &endDateTime={30daysFromNow}

// For Google
GET https://www.googleapis.com/calendar/v3/calendars/primary/events
  ?syncToken={storedSyncToken}
```

**Key Features:**
- Stores `sync_token` or `deltaLink` in a new column on `calendar_connections`
- Only processes READ-purpose connections
- Detects: created events, updated events, deleted events
- Updates `external_calendar_events` table accordingly

**2.2 Add Sync Token Storage**

```sql
ALTER TABLE calendar_connections 
ADD COLUMN sync_token TEXT;  -- Stores delta token for incremental sync
```

### Phase 3: Outbound Sync (Task to Calendar)

**3.1 Update Event Creation Flow**

When a task is scheduled or updated:
1. Check for connections with `WRITE` purpose
2. Create/update events only on those calendars
3. Store the `external_event_id` mapping per connection (since task can exist on multiple calendars)

**3.2 Add `source_task_id` to External Events**

```sql
ALTER TABLE external_calendar_events 
ADD COLUMN source_task_id UUID REFERENCES tasks(id);
```

This links outbound events back to their source tasks for bi-directional updates.

### Phase 4: UI Updates

**4.1 Modify CalendarConnectionModal**

Add a purpose selector when connecting:

```
┌────────────────────────────────────────────────┐
│ Connect Outlook Calendar                       │
├────────────────────────────────────────────────┤
│ Account: work@company.com                      │
│                                                │
│ Use this calendar for:                         │
│ ☑ Reading events (meetings, appointments)     │
│ ☐ Writing task reminders/events               │
│                                                │
│ [Connect]                                      │
└────────────────────────────────────────────────┘
```

**4.2 Update NotificationSettings**

- Show list of connected calendars with their purposes
- Allow changing purpose without re-authenticating
- Indicate which calendar receives task events

**4.3 Add Calendar Selection Dropdown**

When creating Outlook events for reminders:
- Show dropdown of WRITE-purpose connections
- Let user set a "default write calendar" in settings

### Phase 5: Polling Schedule

**5.1 Cron Job for Delta Sync**

Add to `supabase/config.toml`:

```toml
[functions.calendar-delta-sync]
verify_jwt = false
schedule = "*/10 * * * *"  # Every 10 minutes
```

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `supabase/migrations/xxx_add_calendar_purposes.sql` | Create | Add `purposes` and `sync_token` columns |
| `supabase/functions/calendar-token-manager/index.ts` | Modify | Accept purposes during OAuth exchange |
| `supabase/functions/calendar-integration-manager/index.ts` | Modify | Purpose-aware read/write operations |
| `supabase/functions/calendar-delta-sync/index.ts` | Create | New function for polling changes |
| `src/components/CalendarConnectionModal.tsx` | Modify | Add purpose selection UI |
| `src/components/NotificationSettings.tsx` | Modify | Show calendar purposes, allow editing |
| `src/utils/taskScheduling.ts` | Modify | Only use WRITE-purpose connections |
| `supabase/config.toml` | Modify | Add cron schedule for delta sync |

---

## Expected User Flow

### Connecting Multiple Calendars

1. User clicks "Connect Calendar" in Settings
2. Selects provider (Outlook/Google)
3. **New**: Selects purpose (Read, Write, or Both)
4. Completes OAuth flow
5. Connection stored with selected purpose(s)
6. Can repeat for multiple accounts

### Viewing Calendar

1. App fetches events from all READ-purpose connections
2. Events displayed in unified calendar view
3. User can toggle visibility per connected account

### Creating Task Reminders

1. Task is scheduled with a time
2. System checks notification preferences for OUTLOOK_EVENT channel
3. System finds connections with WRITE purpose
4. Creates event on the designated "default write calendar"
5. If changed in Outlook later → delta sync picks up change → updates task (optional)

---

## Edge Cases Handled

| Scenario | Solution |
|----------|----------|
| User deletes calendar event | Delta sync marks `external_calendar_events` as deleted; optionally notify user |
| User updates event time in Outlook | Delta sync updates `external_calendar_events`; can optionally update task |
| Token expires | Existing refresh logic in `calendar-token-manager` handles this |
| Multiple WRITE calendars | Use "default write calendar" preference, or prompt user |
| Conflicting updates | Last-write-wins based on `updated_at` timestamp |

---

## Summary

This plan adds multi-account calendar support with distinct purposes (Read vs Write) by:

1. Adding a `purposes` column to track each connection's role
2. Making sync operations purpose-aware
3. Implementing delta sync polling for near real-time updates from external calendars
4. Updating UI to allow users to select purpose during connection
5. Keeping backward compatibility - existing connections get `[READ, WRITE]` by default
