

# Full Consolidated Plan: Stale Assignments, Scoring, Calendar Sync, Multi-Account & Per-Calendar Toggles

## Problem Summary

1. **Old assignments (Oct 2025) dominate the schedule** — archival only targets `PROF_EDUCATION`, missing `EDUCATION` category; scoring boosts all overdue tasks (+5) instead of penalizing them; shared demo user IDs not used in assignment sync
2. **No manual calendar sync button** — users can't force-pull external events on demand
3. **Single account per provider** — `selectBestConnection` picks one connection; can't add multiple Outlook/Google accounts
4. **No per-calendar pull toggles** — pull is all-or-nothing per connection; users need to toggle individual calendars (Work vs Family)

---

## Fix 1: Archive Stale EDUCATION Tasks + Shared User ID Sync

**File**: `supabase/functions/nightly-assignment-sync/index.ts`

- **Line 49**: Change `.eq('category', 'PROF_EDUCATION')` to `.in('category', ['PROF_EDUCATION', 'EDUCATION'])`
- **Lines 89-95**: Add `DEMO_EMBA_USER_IDS` array and use `.in('user_id', ...)` for the `assignments` table when the user is a demo user (same pattern as `assignmentFetching.ts`)

**Database migration**: One-time cleanup — archive all `EDUCATION` tasks with `due_date < '2026-01-01'` and `status != 'DONE'`

## Fix 2: Fix Scoring — Stop Boosting Stale Overdue Tasks

**File**: `supabase/functions/nightly-schedule-builder/index.ts`

- **Lines 469-470**: Replace `task.due_date <= targetISO` blanket +5 boost with a "due within 7 days" check:
  ```ts
  if (task.due_date) {
    const dueDate = new Date(task.due_date);
    const sevenDaysOut = new Date(targetDate.getTime() + 7*86400000);
    if (dueDate >= targetDate && dueDate <= sevenDaysOut) score += 5;
  }
  ```
- **Lines 479-486**: Increase staleness penalty — tasks overdue 30+ days get `-10`, 14-30 days get `-3`
- **Lines 253-293**: Add EDUCATION archival pass alongside existing stale archival

## Fix 3: Manual Sync Button in FocusView

**File**: `src/components/FocusView.tsx`

Add a "Sync Calendar" button (RefreshCw icon, already imported) next to the existing toolbar buttons. On click:
1. Calls `calendar-delta-sync` with the user's ID
2. Reloads external events from DB
3. Shows toast with count of events synced

## Fix 4: Multi-Account Support in NotificationSettings

**File**: `src/components/NotificationSettings.tsx`

- Replace `outlookConnection` / `googleConnection` (single objects) with `outlookConnections` / `googleConnections` (arrays)
- Remove `selectBestConnection` — render ALL active connections as separate cards
- Each card shows email, push toggle, pull section with per-calendar toggles
- "Add Another Account" OAuth button always visible at bottom of each provider section