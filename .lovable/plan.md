# Self-Debugging Chat + Presence + Realtime System

## Status: ✅ IMPLEMENTED - Awaiting User Test

---

## What Was Built

### 1. Activity Logger Utility (`src/utils/activityLogger.ts`) ✅
- REST-based logging directly to `activity_log` table
- Only logs for dev user (`a3378f93-d655-4913-b2fa-ca5b1d8020f1`)
- Fire-and-forget (never blocks UI)
- Includes session_id, user_id, stage, metadata

### 2. Presence Tracking (`src/hooks/usePresenceTracking.ts`) ✅
- Comprehensive logging at every step
- **Heartbeat every 30 seconds** (keeps presence fresh)
- **pagehide listener** (critical for iOS background detection)
- **focus/blur listeners** (more reliable than visibilitychange alone)
- Logs: `presence_update` with stages: compute, upsert_start, upsert_success, upsert_error, unmount

### 3. Realtime Subscription Logging (`src/contexts/CommsConsoleContext.tsx`) ✅
- Tracks subscription lifecycle: setup → subscribing → subscribed/error
- **5-second watchdog** logs timeout if not subscribed
- Logs message receipt with messageId, role, content preview
- Logs duplicate skips, cleanup

### 4. ChatInterface Realtime (`src/hooks/useChatAssistant.ts`) ✅
- Added Realtime subscription (was missing!)
- Same logging pattern as CommsConsoleContext
- Ensures system-initiated messages appear in ChatInterface sheet

### 5. Edge Function Step Logging (`supabase/functions/send-chat-message`) ✅
- Logs every stage:
  - `request_received`
  - `assistant_resolved`
  - `thread_resolved`
  - `message_stored`
  - `presence_checked` (with isActive, activeContext values)
  - `push_send` / `push_sent` / `push_skipped`
  - `complete`
  - `exception` (on error)

---

## How to Debug

### Query: See full timeline for your user
```sql
SELECT created_at, activity_type, status, stage, error_message, error_code,
       metadata::text
FROM activity_log 
WHERE user_id = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1'
ORDER BY created_at DESC
LIMIT 50;
```

### Query: Presence events only
```sql
SELECT created_at, stage, status, error_message,
       metadata->>'isActive' as is_active,
       metadata->>'context' as context,
       metadata->>'trigger' as trigger
FROM activity_log 
WHERE user_id = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1'
  AND activity_type = 'presence_update'
ORDER BY created_at DESC
LIMIT 20;
```

### Query: Realtime subscription events
```sql
SELECT created_at, stage, status, error_message,
       metadata->>'threadId' as thread_id,
       metadata->>'status' as realtime_status,
       metadata->>'elapsedMs' as elapsed_ms
FROM activity_log 
WHERE user_id = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1'
  AND activity_type = 'realtime_subscribe'
ORDER BY created_at DESC
LIMIT 20;
```

### Query: Check if presence row exists
```sql
SELECT * FROM user_presence 
WHERE user_id = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1';
```

---

## Test Result from Edge Function (2026-02-04 21:42:28)

**Edge function logging verified working:**
```
21:42:25 | chat_send | started   | request_received
21:42:26 | chat_send | completed | assistant_resolved
21:42:26 | chat_send | completed | thread_resolved  
21:42:26 | chat_send | completed | message_stored (messageId: 2d03c431...)
21:42:26 | chat_send | completed | presence_checked (isActive: null, context: null)
21:42:27 | chat_send | started   | push_send
21:42:27 | chat_send | completed | push_sent (delivered: 2, failed: 0)
21:42:28 | chat_send | completed | complete
```

**Key finding:** `presence_checked` shows `isActive: null` because `user_presence` table has no row for the user - confirming the frontend presence upsert is failing.

---

## Next Steps

1. **User opens app on phone** → Frontend logging will start
2. **Check activity_log** for:
   - `presence_update` events (will show if upsert fails and why)
   - `realtime_subscribe` events (will show if subscription connects)
3. **Send test message** via edge function
4. **Query timeline** to see full event sequence

---

## Architecture Diagram

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                          LOGGING FLOW                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  FRONTEND (CommsConsoleContext.tsx, usePresenceTracking.ts)                  │
│  ─────────────────────────────────────────────────────────────              │
│  → presence_update   stage: compute         (computed state)                 │
│  → presence_update   stage: upsert_start    (attempting DB write)            │
│  → presence_update   stage: upsert_success  (succeeded)                      │
│  → presence_update   stage: upsert_error    (failed + full error)            │
│  → realtime_subscribe stage: setup          (thread ID, user ID)             │
│  → realtime_subscribe stage: subscribed     (SUBSCRIBED status)              │
│  → realtime_subscribe stage: timeout        (5s watchdog triggered)          │
│  → chat_receive      stage: realtime_received (message ID, preview)          │
│                                                                              │
│  EDGE FUNCTION (send-chat-message)                                           │
│  ─────────────────────────────────                                           │
│  → chat_send   stage: request_received      (request params)                 │
│  → chat_send   stage: assistant_resolved    (assistant ID)                   │
│  → chat_send   stage: thread_resolved       (thread ID)                      │
│  → chat_send   stage: message_stored        (message ID)                     │
│  → chat_send   stage: presence_checked      (isActive, context, decision)    │
│  → chat_send   stage: push_sent/skipped     (push result or skip reason)     │
│  → chat_send   stage: complete              (final success)                  │
│  → chat_send   stage: exception             (error details)                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```
