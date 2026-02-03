

# Plan: Fix Task Creation Bug - Invalid `.catch()` on Supabase Operations

## Summary

The AI assistant cannot create tasks because the recently added activity logging code uses an unsupported pattern (`.catch()`) that crashes the edge functions.

## Root Cause Analysis

### Error Discovered
```
"supabase.from(...).insert(...).catch is not a function"
```

### Why This Happens
The Supabase JavaScript client in Deno returns a `PostgrestBuilder` object from `.insert()`, not a native Promise. While PostgrestBuilder is thenable (works with `await`), it does **not** have a `.catch()` method.

### The Broken Code Pattern (multiple locations)
```typescript
// THIS IS BROKEN - crashes the function
await supabase.from('activity_log').insert({
  user_id: userId,
  activity_type: 'task_created',
  ...
}).catch((e: Error) => console.error('[LOG] Failed:', e.message));
```

### Impact
1. User asks: "create a test task for 12:15am"
2. `parse_and_create_tasks` is called correctly
3. The AI parser extracts the task correctly
4. The task might get inserted into the database
5. **The `.catch()` line throws an error and crashes the function**
6. The AI receives: `{ success: false, error: "supabase.from(...).insert(...).catch is not a function" }`
7. The AI apologizes: "Unable to create tasks at this moment"

## Files With This Bug

| File | Lines | Instances |
|------|-------|-----------|
| `supabase/functions/execute-tool/index.ts` | 1264, 1358 | 2 |
| `supabase/functions/send-unified-notification/index.ts` | 547, 561 | 2 |
| `supabase/functions/notification-delivery/index.ts` | 616 | 1 |

**Total: 5 instances across 3 edge functions**

---

## Technical Fix

### Option A: Wrap in Try-Catch (Best Practice)
```typescript
// Fixed pattern - wrap in try/catch, don't await (fire-and-forget)
try {
  supabase.from('activity_log').insert({
    user_id: userId,
    activity_type: 'task_created',
    ...
  }); // Note: not awaited - fire and forget for logging
} catch (e) {
  console.error('[LOG] Failed:', e);
}
```

### Option B: Use .then() with Error Handler
```typescript
// Alternative - use then/catch pattern (also works)
supabase.from('activity_log').insert({...})
  .then(() => {})
  .catch((e: Error) => console.error('[LOG] Failed:', e));
```

### Recommended: Option A
The try-catch pattern is cleaner and aligns with Deno best practices. Since logging is best-effort (shouldn't block the main flow), we don't need to await the result.

---

## Changes Required

### File 1: `supabase/functions/execute-tool/index.ts`

**Line 1257-1264** - Replace:
```typescript
await supabase.from('activity_log').insert({
  user_id: userId,
  activity_type: 'task_created',
  session_id: data.id,
  status: 'completed',
  stage: 'parse_and_create',
  metadata: { title: data.title, category: data.category, status: data.status, priority: data.priority }
}).catch((e: Error) => console.error('[PARSE_AND_CREATE] Failed to log activity:', e.message));
```

With:
```typescript
// Best-effort activity logging (fire and forget)
supabase.from('activity_log').insert({
  user_id: userId,
  activity_type: 'task_created',
  session_id: data.id,
  status: 'completed',
  stage: 'parse_and_create',
  metadata: { title: data.title, category: data.category, status: data.status, priority: data.priority }
}).then(() => {
  console.log('[PARSE_AND_CREATE] Activity logged: task_created');
}).catch(() => {
  // Silently ignore logging failures
});
```

**Line 1351-1358** - Same fix for the scheduling activity log.

### File 2: `supabase/functions/send-unified-notification/index.ts`

**Lines 538-547, 550-561** - Apply the same `.then().catch()` pattern.

### File 3: `supabase/functions/notification-delivery/index.ts`

**Lines 606-616** - Apply the same `.then().catch()` pattern.

### File 4: `supabase/functions/_shared/config.ts`

Bump version to track deployment:
```typescript
export const GLOBAL_VERSION = "2026-02-03-v18";
```

---

## Expected Results After Fix

1. **Task creation works again** - Users can create tasks via chat
2. **Activity logging is best-effort** - Failures don't crash the main flow
3. **All notification flows work** - Outlook events, Slack messages, etc.
4. **Version bump** - Easy to verify the fix is deployed via `/ping`

---

## Verification Steps

After deployment:
1. Call `/ping` endpoint - should return `global_version: "2026-02-03-v18"`
2. Test task creation via chat: "create a test task for 5pm"
3. Verify task appears in database and on board
4. Check activity_log for the logged event (optional - not critical)

---

## Root Cause of This Bug

The activity logging code was added in the previous implementation to enable end-to-end tracing. The `.catch()` pattern works in browser JavaScript but **not** with Supabase's Deno client, which returns a PostgrestBuilder rather than a native Promise.

