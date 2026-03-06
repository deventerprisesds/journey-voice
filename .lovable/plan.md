

# Combined Fix Plan — Final Version

All pending fixes in one implementation. Changes from previous version noted.

---

## Summary of Changes from Previous Plan

- Voicemail threshold stays at 45s (not raised to 120s) — the `answeredBy=unknown` path handles forwarded calls regardless of duration
- `twilio-scheduled-call/index.ts` is ARCHIVED (body commented out with header explaining why), not deleted
- Weekend days confirmed as `[0, 6]` (Sunday=0, Saturday=6) — this is the JavaScript `Date.getDay()` and PostgreSQL `EXTRACT(DOW)` standard

---

## All 13 Changes

### Change 1: SQL Migration — Update `schedule_next_call`, Remove Orphaned Cron

Replace the `schedule_next_call` function to accept `p_days_of_week integer[] DEFAULT NULL`. When provided, it scans from tomorrow up to 7 days to find the next day whose `EXTRACT(DOW)` value is in the array. Also stores `days_of_week` in the notification body JSON so it survives re-queue cycles.

Remove the `recurring-calls-check` cron job that pointed to the now-archived `twilio-scheduled-call`.

### Change 2: `src/services/schedulingService.ts` — Add `daysOfWeek` to Type

Add `daysOfWeek?: number[]` to the `ScheduledCall` interface. `0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat`.

### Change 3: `src/components/VoiceAssistantSettings.tsx` — Defaults, Handler, Chip UI, Backfill

- Add `daysOfWeek` to all `DEFAULT_SCHEDULED_CALLS` entries (weekday calls get `[1,2,3,4,5]`, weekend call gets `[0,6]`)
- Add `handleUpdateCallDaysOfWeek` toggle handler
- New custom calls default to `[1,2,3,4,5]`
- Backfill existing saved calls missing `daysOfWeek` on load (lookup default or fall back to `[1,2,3,4,5]`)
- Add compact 7-chip day selector row (M T W T F S S) inside each call card

### Change 4: `supabase/functions/notification-delivery/index.ts` — Day Guard + New SQL Param

- Add day-of-week guard after parsing `callConfig`: check current day (in user's timezone) against `callConfig.days_of_week`. If not a match, mark notification as delivered with `failure_reason: 'wrong_day_of_week'`, reschedule for next valid day, and `continue`
- Update `scheduleNextOccurrence` to pass `p_days_of_week: callConfig.days_of_week || null` to `schedule_next_call`

### Change 5: Archive `supabase/functions/twilio-scheduled-call/index.ts`

Comment out the entire function body and add an archive header:

```typescript
// =============================================================================
// ARCHIVED: 2026-02-20
// This function is superseded by notification-delivery (queue-based path).
// All recurring call scheduling now goes through the scheduled_notifications
// table processed by notification-delivery. The recurring-calls-check cron
// job that called this function has been removed.
//
// Kept as reference for day-of-week guard logic and window-transition context
// building that was ported to notification-delivery.
// =============================================================================
// ... entire original body commented out ...
```

### Change 6: `supabase/functions/twilio-voice-handler/index.ts` — Voicemail Fallback Fixes

**6a. Keep threshold at 45s** — no change to line 1487.

**6b. Add `answeredBy=unknown` detection path** — after the existing `isShortCompleted` block, add a check: if `callStatus=completed` AND `answeredBy` is `unknown` or missing AND a `pre_connect_sessions` record exists for this `callSid`, set `isLikelyVoicemail = true`. This catches forwarded/declined calls regardless of duration.

**6c. Dedup check before fallback** — before calling `send-chat-message`, query `conversation_messages` for any assistant message sent in the last 3 minutes for this user. If found, skip the fallback and log `status: 'skipped_duplicate'` to `activity_log`.

**6d. Add `activity_log` writes after fallback** — log `voicemail_fallback` with `status: completed|error|skipped_duplicate` including `callSid`, `callDuration`, `contextLabel`, and response details. This makes fallback results directly queryable.

**6e. Wrap fallback catch block** — add `activity_log` write inside the existing catch so thrown errors are also visible.

### Change 7: `src/components/CommsConsole/VoiceOrb.tsx` — Stop Blinking When Disconnected

Line 104: change `state === 'idle' && 'animate-pulse'` to `state === 'idle' && isConnected && 'animate-pulse'`. The `isConnected` prop already exists but isn't used in this condition.

### Change 8: `src/components/FocusView.tsx` — Fix Task Rollover

Update `isRolledOver` to add a second path: if a task has no `start_time` but has a `due_date` that is before today's start-of-day, it qualifies as rolled over. Import `startOfDay` from date-fns.

### Change 9: `src/components/TaskCreationModal.tsx` — Default to Manual Tab + Mic Button

- When `initialDate` or `initialHour` is provided, default `activeTab` to `'manual'` instead of `'ai'` so the date picker and time grid are immediately visible
- Add a small mic button (Web Speech API) to the AI textarea area — tapping starts `SpeechRecognition`, transcript appends to `aiInput`

### Change 10: `src/components/QuickTaskInput.tsx` — Mic Button

Add a `Mic`/`MicOff` toggle button between the text input and send button. Uses `window.SpeechRecognition || window.webkitSpeechRecognition`. When recording, icon shows `MicOff` with red tint. On result, transcript appends to input state.

### Change 11: `src/utils/RealtimeVoiceAssistant.ts` — Non-blocking Log + Concurrent Session Check

- Make the `logActivity('started', 'token_fetch')` call non-blocking (fire-and-forget with `.catch(() => {})`) to save ~200-400ms from the connect sequence
- Between user ID lookup and token fetch, query `pre_connect_sessions` for an active phone call (within last 5 minutes, with a non-null `call_sid`). If found, emit a `concurrent_session_warning` message event but do NOT block connection

### Change 12: `src/contexts/CommsConsoleContext.tsx` — Concurrent Warning State + Optimistic Connect

- Add `concurrentSessionWarning` boolean state, set to `true` when `concurrent_session_warning` message type received, with `dismissConcurrentWarning` callback
- Set `voiceState` to `'connecting'` immediately when `connectVoice` is called, before the async connect resolves

### Change 13: `src/components/CommsConsole/CommsConsole.tsx` — Warning Banner

Render a dismissible amber alert banner at the top of the main content area when `concurrentSessionWarning` is true, warning that a phone call is active and starting voice mode may interfere.

---

## Execution Order

| Step | File | Deploy? |
|------|------|---------|
| 1 | SQL migration (update `schedule_next_call`, unschedule cron) | DB |
| 2 | `schedulingService.ts` (add `daysOfWeek` type) | No |
| 3 | `VoiceAssistantSettings.tsx` (defaults, handler, chips, backfill) | No |
| 4 | `notification-delivery/index.ts` (day guard + new param) | Deploy |
| 5 | Archive `twilio-scheduled-call/index.ts` (comment out body) | Deploy |
| 6 | `twilio-voice-handler/index.ts` (unknown path, dedup, activity_log) | Deploy |
| 7 | `VoiceOrb.tsx` (gate pulse on isConnected) | No |
| 8 | `FocusView.tsx` (fix isRolledOver) | No |
| 9 | `TaskCreationModal.tsx` (default manual tab + mic) | No |
| 10 | `QuickTaskInput.tsx` (mic button) | No |
| 11 | `RealtimeVoiceAssistant.ts` (non-blocking log + concurrent check) | No |
| 12 | `CommsConsoleContext.tsx` (warning state + optimistic connect) | No |
| 13 | `CommsConsole.tsx` (warning banner) | No |

---

## What Is NOT Changing

- The 45s `isShortCompleted` threshold — stays as-is, the `answeredBy=unknown` path handles forwarded calls without needing a duration change
- `send-chat-message` edge function — the fallback call to it is already correct
- `persona.ts` voicemail instructions — working as designed
- `generate-realtime-token` — OpenAI API call is the bottleneck, not our code
- The `sync_scheduled_calls` trigger — rebuilds queue on settings save automatically
- The `notification-delivery-job` cron — stays as the single active queue processor
- The enabled/disabled toggle logic — already correct
