

# Self-Debugging Chat + Presence + Realtime System

## Problem Statement

The chat system silently fails with no visibility into why:
- **Presence**: `user_presence` table is empty for your user (upsert failing silently)
- **Realtime**: No evidence in logs that subscription is working or receiving events
- **Push**: Server logs "push sent" but you don't receive messages in-app

**Goal**: Every step logs to `activity_log` so I can see exactly where things break without you needing to participate in debugging.

---

## Architecture: Step-by-Step Activity Logging

Every component will log to `activity_log` with structured events. I can query this table to see the exact sequence of events and where failures occur.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                          LOGGING FLOW                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  FRONTEND (CommsConsoleContext.tsx, usePresenceTracking.ts)                  │
│  ─────────────────────────────────────────────────────────────              │
│  → presence_update_attempt   (computed state)                                │
│  → presence_update_success   (upsert succeeded)                              │
│  → presence_update_error     (upsert failed + full error)                    │
│  → realtime_subscribe_start  (thread ID, user ID)                            │
│  → realtime_subscribe_status (SUBSCRIBED / CHANNEL_ERROR / etc)              │
│  → realtime_message_received (message ID, content preview)                   │
│  → realtime_cleanup          (on unmount)                                    │
│                                                                              │
│  EDGE FUNCTION (send-chat-message)                                           │
│  ─────────────────────────────────                                           │
│  → chat_send_received        (request params)                                │
│  → chat_thread_resolved      (thread ID, assistant ID)                       │
│  → chat_message_stored       (message ID)                                    │
│  → chat_presence_checked     (presence state, decision)                      │
│  → chat_push_sent            (push result)                                   │
│  → chat_send_complete        (final status)                                  │
│  → chat_send_error           (error details)                                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Details

### File 1: New `src/utils/activityLogger.ts`

A dedicated frontend logging utility that writes directly to `activity_log` via REST (bypasses supabase-js to avoid any potential hang). Only logs for your dev account.

**Key features:**
- Uses REST API directly (like `directLog.ts`) to avoid supabase-js issues
- Includes user_id in every log entry so I can filter by your account
- Includes session_id (boot ID) for correlating events within a page session
- Fire-and-forget (never blocks UI)
- **Only logs when user_id = your dev account** (no spam for others)

```typescript
// Key function signature:
export async function logActivity(params: {
  userId: string;
  activityType: string;
  status: 'started' | 'completed' | 'error';
  stage?: string;
  errorMessage?: string;
  errorCode?: string;
  metadata?: Record<string, unknown>;
}): Promise<void>
```

---

### File 2: Update `src/hooks/usePresenceTracking.ts`

Add comprehensive logging at every step:

1. **On compute**: Log what presence state was computed
2. **Before upsert**: Log the attempt with full payload
3. **After upsert success**: Log success
4. **After upsert error**: Log full error details (message, code, hint)
5. **On unmount**: Log cleanup attempt

Also add:
- **Heartbeat every 30 seconds** (ensures presence stays fresh)
- **`pagehide` event listener** (critical for iOS when app goes to background)
- **`focus`/`blur` listeners** (more reliable than just `visibilitychange`)

---

### File 3: Update `src/contexts/CommsConsoleContext.tsx`

Add comprehensive logging for Realtime subscription:

1. **Before subscribe**: Log attempt with thread ID and user ID
2. **On status change**: Log every status (SUBSCRIBED, CHANNEL_ERROR, CLOSED, etc.)
3. **On message received**: Log message ID and content preview
4. **On duplicate skipped**: Log that we skipped a duplicate
5. **On cleanup**: Log cleanup with thread ID
6. **Watchdog**: If not SUBSCRIBED within 5 seconds, log timeout warning

Also add logging for:
- Thread initialization (`dbThreadId` becoming available)
- Assistant loading

---

### File 4: Update `src/hooks/useChatAssistant.ts`

This hook is used by the **ChatInterface sheet** but has **no Realtime subscription**. Add one to ensure system-initiated messages appear there too.

Changes:
1. Add Realtime subscription (same pattern as CommsConsoleContext)
2. Add logging at each step

---

### File 5: Update `supabase/functions/send-chat-message/index.ts`

Add logging to `activity_log` at every step:

1. **chat_send_received**: Request received with params
2. **chat_assistant_resolved**: Which assistant ID was used
3. **chat_thread_resolved**: Which thread ID was used (existing or new)
4. **chat_message_stored**: Message successfully stored with ID
5. **chat_presence_checked**: What presence was read, decision made
6. **chat_push_sent**: Push notification result (or skipped reason)
7. **chat_send_complete**: Final success status
8. **chat_send_error**: Any exception with full details

---

## Debugging Workflow After Implementation

1. You open the app on your phone
2. I send a test message via edge function
3. I query `activity_log`:

```sql
SELECT created_at, activity_type, status, stage, error_message, metadata::text
FROM activity_log 
WHERE user_id = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1'
ORDER BY created_at DESC
LIMIT 50;
```

4. I'll see the exact sequence:
   - Did presence update succeed? (If not, why?)
   - Did Realtime subscribe? (If not, why?)
   - Did the edge function store the message?
   - Did it check presence correctly?
   - Did the message arrive via Realtime?

---

## Files to Modify/Create

| File | Action | Purpose |
|------|--------|---------|
| `src/utils/activityLogger.ts` | CREATE | Dedicated frontend activity logging via REST |
| `src/hooks/usePresenceTracking.ts` | MODIFY | Add logging + heartbeat + pagehide |
| `src/contexts/CommsConsoleContext.tsx` | MODIFY | Add Realtime logging + watchdog |
| `src/hooks/useChatAssistant.ts` | MODIFY | Add Realtime subscription + logging |
| `supabase/functions/send-chat-message/index.ts` | MODIFY | Add step-by-step logging |
| `docs/SUPABASE_CHECKLIST.md` | MODIFY | Add lessons learned |

---

## Expected Log Output (Success Case)

```text
2026-02-04 21:30:01 | presence_update_attempt   | started   | compute      | {isActive: true, context: 'chat'}
2026-02-04 21:30:01 | presence_update_attempt   | completed | upsert       | {isActive: true}
2026-02-04 21:30:02 | realtime_subscribe        | started   | setup        | {threadId: '6643...'}
2026-02-04 21:30:02 | realtime_subscribe        | completed | SUBSCRIBED   |
2026-02-04 21:30:05 | chat_send_received        | started   | request      | {generateFromContext: ...}
2026-02-04 21:30:05 | chat_thread_resolved      | completed |              | {threadId: '6643...'}
2026-02-04 21:30:06 | chat_message_stored       | completed |              | {messageId: 'abc...'}
2026-02-04 21:30:06 | chat_presence_checked     | completed |              | {isActive: true, skipPush: true}
2026-02-04 21:30:06 | chat_send_complete        | completed |              | {messageId: 'abc...'}
2026-02-04 21:30:06 | realtime_message_received | completed |              | {messageId: 'abc...'}
```

---

## Expected Log Output (Failure Case - Presence)

```text
2026-02-04 21:30:01 | presence_update_attempt   | started   | compute      | {isActive: true, context: 'chat'}
2026-02-04 21:30:01 | presence_update_attempt   | error     | upsert       | new row violates row-level security policy | {code: '42501', hint: '...'}
```

This tells me exactly what failed and why!

---

## Technical Details

### Activity Logger (REST-based, not supabase-js)

```typescript
const DEV_USER_ID = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1';

export async function logActivity(params: ActivityLogParams): Promise<void> {
  // Only log for dev user
  if (params.userId !== DEV_USER_ID) return;
  
  const body = {
    user_id: params.userId,
    activity_type: params.activityType,
    status: params.status,
    stage: params.stage || null,
    error_message: params.errorMessage || null,
    error_code: params.errorCode || null,
    session_id: getBootId(),
    metadata: {
      ...params.metadata,
      timestamp: new Date().toISOString(),
      pathname: window.location.pathname
    }
  };

  // Fire-and-forget POST to activity_log via REST
  fetch(`${SUPABASE_URL}/rest/v1/activity_log`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(body)
  }).catch(() => {}); // Never throw
}
```

### Presence Heartbeat

```typescript
// Every 30 seconds, refresh presence if user is active
useEffect(() => {
  if (!userId || !enabled) return;
  
  const interval = setInterval(() => {
    if (document.visibilityState === 'visible') {
      updatePresence(true, isPanelOpen ? currentMode : 'background');
    }
  }, 30000);
  
  return () => clearInterval(interval);
}, [userId, enabled, isPanelOpen, currentMode]);
```

### Realtime Watchdog

```typescript
const subscribeStartTime = useRef<number | null>(null);
const [realtimeStatus, setRealtimeStatus] = useState<string>('idle');

// Inside subscription setup:
subscribeStartTime.current = Date.now();
setRealtimeStatus('subscribing');

// In subscribe callback:
.subscribe((status) => {
  setRealtimeStatus(status);
  logActivity({
    userId,
    activityType: 'realtime_subscribe',
    status: status === 'SUBSCRIBED' ? 'completed' : 'started',
    stage: status,
    metadata: { threadId: dbThreadId, elapsedMs: Date.now() - subscribeStartTime.current }
  });
});

// Watchdog effect:
useEffect(() => {
  if (realtimeStatus === 'subscribing') {
    const timeout = setTimeout(() => {
      if (realtimeStatus === 'subscribing') {
        logActivity({
          userId,
          activityType: 'realtime_subscribe',
          status: 'error',
          stage: 'timeout',
          errorMessage: 'Subscription not SUBSCRIBED after 5 seconds'
        });
      }
    }, 5000);
    return () => clearTimeout(timeout);
  }
}, [realtimeStatus]);
```

