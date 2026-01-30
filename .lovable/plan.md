

## Comprehensive Timezone Fix + Drag-to-Reschedule Schedule Grid

### Problem Summary

Your backend has excellent timezone utilities (`supabase/functions/_shared/timezone.ts`) but the frontend uses browser-local methods (`.getHours()`, `.setHours()`) instead of the user's configured timezone from `user_scheduling_prefs`. This causes the 3-hour offset you saw (10 AM displayed as 7:00).

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

### Part 1: Extend `src/lib/date.ts` (Mirror Backend)

Add these functions from the backend pattern:

| Function | Purpose | Usage |
|----------|---------|-------|
| `getTimePartsInTimezone(iso, tz)` | Extract hour/minute in user's timezone | Grid positioning, time window matching |
| `getDateInTimezone(iso, tz)` | Get YYYY-MM-DD in user's timezone | Date filtering (isSameDay equivalent) |
| `localTimeToUtcISO(dateStr, timeStr, tz)` | Convert user input to UTC | Task creation, rescheduling |
| `isSameDateInTimezone(iso, dateStr, tz)` | Check if ISO falls on a date in tz | Task filtering for "today" |

---

### Part 2: Fix `src/components/TimeSlotGrid.tsx` (Critical)

**Current Problems:**
- Line 125-126: `taskStart.getHours()` - browser-local
- Line 233-234: `s.getHours() * 60 + s.getMinutes()` - browser-local positioning
- Line 492: `format(parseISO(...), 'h:mm')` - browser-local display

**Changes:**
1. Add props: `userTimezone?: string`, `onTaskReschedule?: (taskId, newStart, newEnd) => Promise<void>`
2. Import from `@/lib/date`: `getTimePartsInTimezone`, `formatTimeInTimezone`
3. Replace position calculation:
   ```typescript
   // Before
   startMin: clampToDay(s.getHours() * 60 + s.getMinutes())
   
   // After
   const { hour, minute } = getTimePartsInTimezone(t.start_time!, userTimezone);
   startMin: clampToDay(hour * 60 + minute)
   ```
4. Replace time display:
   ```typescript
   // Before
   {format(parseISO(t.start_time), 'h:mm')}
   
   // After
   {formatTimeInTimezone(t.start_time!, userTimezone)}
   ```

**Add Drag-to-Reschedule:**
- Wrap task overlays in `Draggable` from `@hello-pangea/dnd`
- Create invisible drop zones over time slots
- On drop: calculate new start/end times preserving duration, call `onTaskReschedule`
- Mobile: Apply hold-to-drag pattern (touch-action: pan-y) to prevent accidental moves

---

### Part 3: Fix `src/components/DailyScheduleView.tsx`

**Current Problems:**
- Line 127-130: `setHours(9, 0, 0, 0)` for default scheduling - browser-local
- Line 183-185: `formatTime` uses `format(parseISO(...))` - browser-local

**Changes:**
1. Pass `userTimezone={schedulingConfig?.timezone}` to `TimeSlotGrid`
2. Add `handleTaskReschedule` function:
   ```typescript
   const handleTaskReschedule = async (taskId: string, newStart: string, newEnd: string) => {
     const { error } = await supabase.from('tasks').update({
       start_time: newStart,
       end_time: newEnd,
       is_scheduled: true,
       updated_at: new Date().toISOString()
     }).eq('id', taskId);
     
     if (!error) {
       toast.success('Task rescheduled');
       onTaskUpdate();
     }
   };
   ```
3. Pass `onTaskReschedule={handleTaskReschedule}` to grid
4. Fix default scheduling to use `localTimeToUtcISO()`

---

### Part 4: Fix `src/components/FocusView.tsx`

**Current Problems:**
- Line 151: `parseISO(task.start_time).getHours()` for time window matching

**Changes:**
1. Load user's timezone from scheduling config (already available via `useBatchScheduling`)
2. Replace with:
   ```typescript
   const { hour: taskHour } = getTimePartsInTimezone(task.start_time, userTimezone);
   ```
3. Fix `scheduleTaskAtTime` (line 189) to use `localTimeToUtcISO()`

---

### Part 5: Fix `src/services/schedulingService.ts`

**Current Problems:**
- Line 411-412: `date.getDay()` and `date.getHours()` for window matching

**Changes:**
1. Add optional `timezone?: string` parameter to `isWithinTimeWindow()`
2. Add optional `timezone?: string` parameter to `getAvailableTimeSlots()`
3. Use `getTimePartsInTimezone()` when timezone is provided:
   ```typescript
   const { hour } = timezone 
     ? getTimePartsInTimezone(date.toISOString(), timezone)
     : { hour: date.getHours() };
   ```

---

### Part 6: Fix `src/components/TaskCreationModal.tsx`

**Current Problems:**
- Line 883-884: `fromHHMMToISO()` uses browser-local via native Date.setHours()

**Changes:**
1. Update `fromHHMMToISO()` in `src/lib/date.ts` to accept optional timezone
2. Or, use the new `localTimeToUtcISO()` directly in the modal
3. Load user's timezone from config and pass to time conversions

---

### Part 7: Other Risk Points (Lower Priority)

| File | Line | Issue | Fix |
|------|------|-------|-----|
| `CalendarModule.tsx` | Time slot click | Browser-local | Use `localTimeToUtcISO()` |
| `EditableTaskSuggestion.tsx` | Alternative times | Browser-local | Pass timezone |
| `ItineraryEngine.ts` | Working hours | Browser-local | Pass timezone through |
| `RealtimeVoiceAssistant.ts` | Greeting time | Browser-local (backup code) | Lower priority |

---

### Files to Modify

| File | Priority | Changes |
|------|----------|---------|
| `src/lib/date.ts` | P0 | Add 4 new timezone-aware functions |
| `src/components/TimeSlotGrid.tsx` | P0 | Add timezone prop, fix positioning, add DnD |
| `src/components/DailyScheduleView.tsx` | P0 | Pass timezone, add reschedule handler |
| `src/components/FocusView.tsx` | P1 | Fix time window matching |
| `src/services/schedulingService.ts` | P1 | Add timezone param to window functions |
| `src/components/TaskCreationModal.tsx` | P1 | Fix time input conversion |

---

### Drag-to-Reschedule Visual Behavior

| Action | Result |
|--------|--------|
| Click task | Opens task detail modal (existing) |
| Hold + Drag task | Visual drag preview follows cursor |
| Drop on different time slot | Task moves to new time (duration preserved) |
| Drop outside grid | Cancels drag |
| Mobile: Quick tap | Opens detail, no drag |
| Mobile: Hold 200ms+ | Enables drag mode |

---

### Technical Notes

1. **Default Timezone**: If user hasn't set timezone in `user_scheduling_prefs`, fall back to `Intl.DateTimeFormat().resolvedOptions().timeZone` (browser timezone)

2. **UTC Storage**: All times remain stored as UTC in the database - this is correct

3. **DnD Integration**: TimeSlotGrid will wrap the existing overlay layer in `DragDropContext`, with each 15-minute slot being a `Droppable` area

4. **Duration Preservation**: When dragging, the task's duration (end_time - start_time) is preserved - only the start position changes

