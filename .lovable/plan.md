

# Fix: Realtime Subscription + Presence Tracking Failures

## Root Cause Analysis

The Realtime message subscription did NOT work because of a race condition and RLS policy issues:

### Finding 1: Race Condition in Thread Initialization

The Realtime subscription at line 341-381 of `CommsConsoleContext.tsx` depends on `dbThreadId`:

```typescript
useEffect(() => {
  if (!dbThreadId || !userId) return;  // <-- EXIT EARLY if null
  // ... subscription code
}, [dbThreadId, userId]);
```

The `dbThreadId` comes from `useUnifiedThread` which requires BOTH `userId` AND `assistantId`:

```typescript
// useUnifiedThread.ts line 39
if (!enabled || !userId || !assistantId) {
  setDbThreadId(null);  // <-- dbThreadId stays null!
  return;
}
```

**Timeline of the bug:**
1. User loads page → `userId` becomes available
2. `useUnifiedThread` runs but `currentAssistant` is still `null`
3. `dbThreadId` remains `null`
4. Realtime subscription sees `!dbThreadId` → **never subscribes**
5. Later, `currentAssistant` is set from the async fetch
6. `useUnifiedThread` runs again and sets `dbThreadId`
7. Realtime subscription now works... **but the user may have already missed messages**

### Finding 2: User Presence RLS Policy Issue

The console log shows:
```
[PresenceTracking] Failed to update presence: 
  new row violates row-level security policy for table "user_presence"
```

The upsert operation fails because:
- There's no existing row in `user_presence` for this user
- The INSERT policy exists but the upsert's ON CONFLICT behavior may be triggering incorrectly

This means **presence is never set**, so the `send-chat-message` function thinks the user is always "away" and tries to send push notifications.

### Finding 3: Database State Confirmation

```sql
-- Thread exists and is correctly linked:
SELECT id, assistant_id FROM ai_threads WHERE user_id = 'a3378f93-...';
-- Result: 6643d1fc-904e-4103-b143-e51f2f4b5015, f6d67661-c41b-49e4-...

-- Messages are being stored with correct thread_id:
SELECT thread_id FROM conversation_messages WHERE user_id = 'a3378f93-...' LIMIT 1;
-- Result: 6643d1fc-904e-4103-b143-e51f2f4b5015

-- Table IS in the publication:
SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
-- Result: conversation_messages ✓

-- But presence is empty (failed to upsert):
SELECT * FROM user_presence WHERE user_id = 'a3378f93-...';
-- Result: (empty)
```

---

## Solution

### Fix 1: Update user_presence RLS to Allow Initial Insert

The current INSERT policy may have a conflict with the ALL policy. Simplify to a single policy:

```sql
-- Drop conflicting policies
DROP POLICY IF EXISTS "Users can insert own presence" ON user_presence;
DROP POLICY IF EXISTS "Users can manage own presence" ON user_presence;
DROP POLICY IF EXISTS "Users can view own presence" ON user_presence;

-- Create a single unified policy for authenticated users
CREATE POLICY "Users can manage own presence"
  ON user_presence
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Keep service role policy for edge functions
-- (already exists: "Service role can read all presence")
```

### Fix 2: Ensure Realtime Subscription Waits for Valid Thread

Modify the Realtime subscription effect to log clearly when it can't subscribe, and ensure it retries when `dbThreadId` becomes available:

**File: `src/contexts/CommsConsoleContext.tsx` (lines 341-381)**

Add logging to understand when subscription is active:

```typescript
useEffect(() => {
  if (!userId) {
    console.log('[CommsConsole] Realtime: No userId, skipping subscription');
    return;
  }
  if (!dbThreadId) {
    console.log('[CommsConsole] Realtime: No dbThreadId yet, waiting for thread initialization');
    return;
  }
  
  console.log('[CommsConsole] Realtime: Setting up subscription for thread:', dbThreadId);
  
  const channel = supabase
    .channel(`chat-messages-${dbThreadId}`)
    .on(/* ... existing code ... */)
    .subscribe((status) => {
      console.log('[CommsConsole] Realtime subscription status:', status);
    });
  
  return () => {
    console.log('[CommsConsole] Realtime: Cleaning up subscription for thread:', dbThreadId);
    supabase.removeChannel(channel);
  };
}, [dbThreadId, userId]);
```

### Fix 3: Add Presence Debugging

Add more logging to `usePresenceTracking.ts` to understand failure modes:

```typescript
try {
  const { error, data } = await supabase
    .from('user_presence')
    .upsert({/* ... */}, { onConflict: 'user_id' });

  if (error) {
    console.error('[PresenceTracking] Failed to update presence:', error);
    console.error('[PresenceTracking] User ID:', userId, 'Auth UID:', (await supabase.auth.getUser()).data.user?.id);
  }
} catch (err) {
  console.error('[PresenceTracking] Error:', err);
}
```

---

## Files to Modify

| File | Change |
|------|--------|
| Migration | Fix `user_presence` RLS policies |
| `src/contexts/CommsConsoleContext.tsx` | Add Realtime debug logging |
| `src/hooks/usePresenceTracking.ts` | Add auth debugging |

## Testing After Fix

1. Open browser DevTools Console
2. Navigate to a page with Comms Console
3. Look for logs:
   - `[CommsConsole] Realtime: Setting up subscription for thread: <uuid>`
   - `[CommsConsole] Realtime subscription status: SUBSCRIBED`
   - `[PresenceTracking] Updated: isActive=true, context=chat`
4. I'll send a test message via edge function
5. You should see:
   - `[CommsConsole] Realtime message received: <uuid>`
   - Message appears instantly in chat
   - NO push notification (because you're active in chat)

## Checklist Update

Add to `docs/SUPABASE_CHECKLIST.md`:

```markdown
| Date | Mistake | Resolution |
|------|---------|------------|
| 2026-02-04 | Realtime subscription never started due to race condition with async thread initialization | Always ensure subscription dependencies are set before subscription runs; add debug logging |
| 2026-02-04 | RLS INSERT+ALL policies conflicted on upsert for new rows | Use single ALL policy with USING and WITH CHECK clauses |
```

