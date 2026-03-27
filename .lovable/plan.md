

# Full 7-Item Implementation Plan

## Status Recap
The approved plan had 7 items. Here's where each stands and what will be done:

---

## Item 1: FocusView Weekend Window Swap
**Status**: Not yet implemented

**File**: `src/components/FocusView.tsx`
- Add a `weekends` entry to `timeWindowStyles` (after line 87) with a distinct icon/label/colors
- Where the timeline groups tasks by window, detect if today is Saturday/Sunday via `today.getDay()` and use only the `weekends` window instead of the four weekday windows
- The `weekends` window config is already in `config.timeWindows` from user settings

---

## Item 2: QuickTaskInput — Add Tracing, Fix Response Property, Default Status
**Status**: Not yet implemented. This is the "just says it works" problem.

**Root cause confirmed**: 
- Line 78 reads `data.result?.createdTasks` but the response returns `data.result?.tasks` (confirmed at execute-tool line 1325)
- If auto-scheduling fails silently, tasks get `BACKLOG` status and are invisible in FocusView
- No tracing exists to see what happened server-side

**File**: `src/components/QuickTaskInput.tsx`
- Fix `data.result?.createdTasks` → `data.result?.tasks` (line 78)
- Add `default_status: 'UP_NEXT'` to the args passed to execute-tool so tasks appear in Focus View even if scheduling fails
- Add comprehensive tracing via `logToErrorLog` from `directLog.ts`:
  - Log before calling execute-tool: input text, user ID, timezone
  - Log the full response: `data.success`, `data.result`, `data.error`, `data.message`
  - Log any exception details
  - This ensures when you test and it doesn't work, the `error_log` table has the exact request/response data

**File**: `supabase/functions/execute-tool/index.ts`
- In `parseAndCreateTasks`, accept `args.default_status` and use it in the status fallback (line 1127):
  ```
  status: task.status || args.default_status || ((normalizedStartTime || normalizedDueDate) ? 'UP_NEXT' : 'BACKLOG')
  ```

---

## Item 3: SmartTaskInput Property Mismatch Fix
**Status**: Not yet implemented

**File**: `src/components/SmartTaskInput.tsx`
- Line 240: `lastSuggestion.taskSuggestion` is always undefined because `ItineraryEngine.findOptimalTimeSlot()` returns `{ parsedTask, scheduledSlot, aiReasoning, busySlots }`
- Change condition to check `lastSuggestion.parsedTask`
- Map `parsedTask` + `scheduledSlot` into the `TaskSuggestion` shape that `EditableTaskSuggestion` expects:
  ```typescript
  suggestion={{
    title: lastSuggestion.parsedTask.title,
    priority: lastSuggestion.parsedTask.priority,
    category: lastSuggestion.parsedTask.category,
    estimate_minutes: lastSuggestion.parsedTask.estimate_minutes,
    scheduledStart: lastSuggestion.scheduledSlot?.start,
    aiReasoning: lastSuggestion.aiReasoning,
    description: lastSuggestion.parsedTask.description
  }}
  ```

---

## Item 4: Voice Connection Monitoring
**Status**: Not yet implemented

**File**: `src/utils/RealtimeVoiceAssistant.ts`
- After line 674 (`this.pc = new RTCPeerConnection()`), add ICE monitoring:
  ```typescript
  this.pc.oniceconnectionstatechange = () => {
    const state = this.pc?.iceConnectionState;
    console.log('[ICE] Connection state:', state);
    if (state === 'disconnected') {
      this.onMessage({ type: 'connection.degraded' });
    }
    if (state === 'failed') {
      this.onMessage({ type: 'connection.failed' });
      this.disconnect();
    }
  };
  this.pc.onconnectionstatechange = () => {
    console.log('[WebRTC] Connection state:', this.pc?.connectionState);
  };
  ```

---

## Item 5: Calendar Connections Tab in Settings
**Status**: Not yet implemented

**File**: `src/pages/Settings.tsx`
- Add `Calendar` icon import from lucide-react
- Add `{ value: 'calendars', label: 'Calendars', icon: Calendar }` to `tabConfig`
- Import `CalendarConnectionModal` and `CalendarSelectionPanel`
- Add `TabsContent` for `calendars` tab rendering both components
- This reuses existing components — no new components needed

---

## Item 6: Nightly Schedule Builder — Weekly Planning + Rollover to Slots
**Status**: Not yet implemented

**File**: `supabase/functions/nightly-schedule-builder/index.ts`
- **Rollover fix** (lines 194-214): Instead of setting `status: 'UP_NEXT'` and clearing times, keep tasks as `is_scheduled: false` with `status` unchanged so they flow into the candidate pool for immediate rescheduling
- **Weekly iteration**: After rollover, loop through remaining days of the current week (today → Sunday). For each day, compute window capacity and call `batch-calendar-scheduler` with that day's date. Track scheduled IDs to prevent double-scheduling.

---

## Item 7: Nightly Assignment Sync (New Edge Function)
**Status**: Not yet implemented

**New file**: `supabase/functions/nightly-assignment-sync/index.ts`
- Query `assignments` (EMBA) and `assignments_mit` tables for items due within 14 days
- For each: check if a task with matching `assignment_id` exists → skip if so
- Create task with `category: 'PROF_EDUCATION'`, `estimate_minutes: 90`, `status: 'TODO'`
- Archive overdue: if `due_date < today` and matching task is not DONE → set `status: 'DONE'` with metadata note
- Return created/archived IDs

**File**: `supabase/functions/nightly-schedule-builder/index.ts`
- Add a step before candidate scoring that calls `nightly-assignment-sync`

---

## Execution Order
1. QuickTaskInput tracing + fix (Item 2) — most urgent, enables debugging
2. SmartTaskInput property fix (Item 3)
3. FocusView weekend swap (Item 1)
4. Calendar Settings tab (Item 5)
5. Voice ICE monitoring (Item 4)
6. AI task parser user-config loading (part of Item 2 server-side)
7. Nightly assignment sync function (Item 7)
8. Nightly builder weekly planning (Item 6)

Each item tracked as a task, tested before moving to next.

