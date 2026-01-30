# Comprehensive Timezone Fix + Drag-to-Reschedule Schedule Grid

## Status: ✅ IMPLEMENTED

### Problem Summary (RESOLVED)

The backend had excellent timezone utilities (`supabase/functions/_shared/timezone.ts`) but the frontend was using browser-local methods (`.getHours()`, `.setHours()`) instead of the user's configured timezone from `user_scheduling_prefs`. This caused the 3-hour offset observed (10 AM displayed as 7:00).

---

### Architecture: Store UTC, Display in User's Timezone

```text
┌─────────────────────────────────────────────────────────────────┐
│                         DATABASE (UTC)                          │
│   start_time: 2026-01-31T15:00:00Z  (UTC timestamp)            │
└─────────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┴─────────────────────┐
         ▼                                          ▼
┌─────────────────────┐                    ┌─────────────────────┐
│   WRITE (Frontend)  │                    │   READ (Frontend)   │
│                     │                    │                     │
│ User enters "10 AM" │                    │ Display: "10:00 AM" │
│         +           │                    │         +           │
│ localTimeToUtcISO() │                    │ formatTimeInTimezone()
│         ↓           │                    │ getTimePartsInTimezone()
│ → 15:00:00Z (UTC)   │                    │ (user's timezone)   │
└─────────────────────┘                    └─────────────────────┘
```

---

## Implementation Summary

### Part 1: Extended `src/lib/date.ts` ✅

Added timezone-aware utilities mirroring backend patterns:

| Function | Purpose | Usage |
|----------|---------|-------|
| `getTimePartsInTimezone(iso, tz)` | Extract hour/minute in user's timezone | Grid positioning, time window matching |
| `getDateInTimezone(iso, tz)` | Get YYYY-MM-DD in user's timezone | Date filtering (isSameDay equivalent) |
| `localTimeToUtcISO(dateStr, timeStr, tz)` | Convert user input to UTC | Task creation, rescheduling |
| `isSameDateInTimezone(iso, dateStr, tz)` | Check if ISO falls on a date in tz | Task filtering for "today" |
| `getDefaultTimezone()` | Get browser timezone as fallback | Default when user hasn't set timezone |

### Part 2: Fixed `src/components/TimeSlotGrid.tsx` ✅

**Changes:**
- Added `userTimezone` and `onTaskReschedule` props
- Replaced all browser-local `getHours()`/`getMinutes()` with `getTimePartsInTimezone()`
- Replaced all `isSameDay()` comparisons with `getDateInTimezone()` equality checks
- Updated time display to use `formatTimeInTimezone()`
- **Added drag-to-reschedule functionality** using `@hello-pangea/dnd`:
  - Tasks are now `Draggable` with grip handles
  - 15-minute slots are `Droppable` zones
  - Duration is preserved when dragging to new time slot
  - Visual feedback during drag operations

### Part 3: Fixed `src/components/DailyScheduleView.tsx` ✅

**Changes:**
- Added `handleTaskReschedule` function for Supabase updates
- Passed `userTimezone={schedulingConfig?.timezone}` to TimeSlotGrid
- Passed `onTaskReschedule={handleTaskReschedule}` for drag-drop support
- Updated `formatTime` to use timezone-aware formatting

### Part 4: Fixed `src/components/FocusView.tsx` ✅

**Changes:**
- Imported and used `getTimePartsInTimezone` and `localTimeToUtcISO`
- Fixed `getTimeWindowForTask` to use timezone-aware time extraction
- Fixed `scheduleTaskAtTime` to use timezone-aware UTC conversion
- Fixed `getDropSlotsForWindow` to use timezone-aware time labels

### Part 5: Fixed `src/services/schedulingService.ts` ✅

**Changes:**
- Added optional `timezone` parameter to `isTimeSlotAllowed()`
- Added optional `timezone` parameter to `getAvailableTimeSlots()`
- Uses `getTimePartsInTimezone()` when timezone is provided

---

## Drag-to-Reschedule Feature

| Action | Result |
|--------|--------|
| Click task | Opens task detail modal (existing behavior) |
| Hover task | Shows grip handle and checkbox |
| Drag task (via grip) | Visual drag preview follows cursor |
| Drop on different time slot | Task moves to new time (duration preserved) |
| Drop outside grid | Cancels drag |

---

## Technical Notes

1. **Default Timezone**: Falls back to `Intl.DateTimeFormat().resolvedOptions().timeZone` when user hasn't set timezone in `user_scheduling_prefs`

2. **UTC Storage**: All times remain stored as UTC in the database - this is the correct pattern

3. **Backward Compatibility**: All functions accept optional timezone parameter - existing code without timezone continues to work

4. **DST Handling**: Uses `Intl.DateTimeFormat` which handles DST automatically

---

## Files Modified

| File | Changes |
|------|---------|
| `src/lib/date.ts` | Added 6 new timezone-aware functions |
| `src/components/TimeSlotGrid.tsx` | Timezone props, fixed positioning, added DnD |
| `src/components/DailyScheduleView.tsx` | Pass timezone, add reschedule handler |
| `src/components/FocusView.tsx` | Fixed time window matching and scheduling |
| `src/services/schedulingService.ts` | Added timezone params to window functions |

