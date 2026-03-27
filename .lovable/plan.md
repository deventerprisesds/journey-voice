

# Fix: External Calendar Events Not Being Pulled Into Scheduling

## Problem

The `calendar-delta-sync` edge function exists and works, but **nothing ever calls it**:
- The nightly builder reads from `external_calendar_events` table to detect busy slots, but that table is empty because no sync has run.
- The frontend never invokes `calendar-delta-sync` — not on page load, not on a timer, not via subscription.
- When you manually add a 1pm event to Outlook/Google, the app has no way to know about it until someone triggers a delta sync.

## Fix

### 1. Nightly builder: invoke `calendar-delta-sync` before scheduling

**File**: `supabase/functions/nightly-schedule-builder/index.ts`

Before the week loop begins (around line 298), invoke `calendar-delta-sync` for the current user to pull in fresh external events:

```ts
// Pull latest external calendar events before scheduling
await supabase.functions.invoke('calendar-delta-sync', {
  body: { user_id: userId }
});
console.log(`[nightly-builder] Delta sync completed for user ${userId}`);
```

This ensures the `external_calendar_events` table is up-to-date before the builder reads busy slots from it.

### 2. Frontend: periodic sync on FocusView and CalendarModule mount

**File**: `src/components/FocusView.tsx`

Add a `useEffect` that calls `calendar-delta-sync` once on mount (and optionally every 15 minutes) when the user has active READ connections:

```ts
useEffect(() => {
  const syncExternalEvents = async () => {
    if (!user?.id) return;
    try {
      await supabase.functions.invoke('calendar-delta-sync', { body: { user_id: user.id } });
    } catch (e) {
      console.warn('Delta sync failed:', e);
    }
  };
  syncExternalEvents();
  const interval = setInterval(syncExternalEvents, 15 * 60 * 1000); // every 15 min
  return () => clearInterval(interval);
}, [user?.id]);
```

**File**: `src/components/CalendarModule.tsx`

Same pattern — invoke delta sync on mount before loading events from the DB.

### 3. FocusView: show external calendar events in Today's Schedule

**File**: `src/components/FocusView.tsx`

Currently `scheduledToday` only shows tasks. Add a query for `external_calendar_events` for today and render them alongside scheduled tasks in the timeline, marked as "External" with a distinct badge. This makes manually-added calendar events visible.

## Files to Change

| File | Change |
|------|--------|
| `supabase/functions/nightly-schedule-builder/index.ts` | Invoke `calendar-delta-sync` before the week loop |
| `src/components/FocusView.tsx` | Periodic delta sync + display external events in today's schedule |
| `src/components/CalendarModule.tsx` | Delta sync on mount before loading events |

## Result

- External calendar events (manually added 1pm meetings, etc.) will be pulled into `external_calendar_events` table automatically
- The nightly builder will see them as busy slots and avoid double-booking
- The Focus View will display them so you can see your full day at a glance

