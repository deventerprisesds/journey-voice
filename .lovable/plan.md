

# Combined Plan: Data Cleanup + Unimplemented Fixes from Previous Plan

## What's Missing

The data cleanup plan only covered the SQL migration. These items from the previous plan were never implemented:

### 1. FocusView — External events still duplicate time slots
Lines 977-990 only mark **task** slots as occupied. External events are rendered into the timeline but never mark their time ranges, so both an event card AND an empty open slot appear at the same time.

**Fix**: After the task loop (line 990), iterate `externalEvents` in the current window and add their time ranges to `occupiedSlots`.

### 2. FocusView — External event cards still use dark green `bg-accent/50`
Line 1146 still uses `bg-accent/50` which causes poor contrast on dark backgrounds.

**Fix**: Replace with provider-specific light backgrounds:
- Google: `bg-blue-50 dark:bg-blue-950/30`
- Outlook: `bg-cyan-50 dark:bg-cyan-950/30`

### 3. WeeklyAgendaView — No weekend time window
`timeWindowStyles` (line 31-66) has no `weekends` entry. `getTimeWindowForTask` (line 102-113) doesn't check day-of-week for weekends. Weekend tasks fall to `unscheduled` which is never rendered (line 201 only iterates `timeWindowStyles` keys).

**Fix**:
- Add `weekends` to `timeWindowStyles` (teal-themed, Calendar icon, "Weekend" label)
- In `getTimeWindowForTask`: check `day.getDay()` — if 0 or 6, return `'weekends'`
- In line 201 rendering: for weekend days, only show the `weekends` window; for weekdays, show the 4 existing windows
- Render `unscheduled` bucket as a fallback section with muted styling

### 4. Data cleanup migration
- `DELETE FROM external_calendar_events` (all rows for user)
- `UPDATE calendar_connections SET sync_token = NULL WHERE is_active = true`

This forces a full re-sync with the corrected title and calendar_id logic already deployed.

## Files to Change

| File | Change |
|------|--------|
| `src/components/FocusView.tsx` | (a) External events mark occupied slots (b) Lighter provider-specific card backgrounds |
| `src/components/WeeklyAgendaView.tsx` | (a) Add `weekends` window style (b) Weekend detection in `getTimeWindowForTask` (c) Dynamic window list per day type (d) Render unscheduled bucket |
| SQL migration | Clear stale events + reset sync tokens |

