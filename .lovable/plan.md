
# Fix Plan: True Race Strategy for Auth + Assistant Loading

## Problem Summary

Two related issues are causing poor user experience:

1. **Auth takes 10 seconds despite fast path success**: The code uses `Promise.allSettled()` which waits for BOTH promises to complete. Even though the fast path (direct REST) returns in ~100ms with a valid session, the UI is blocked waiting for the slow path's 10-second timeout.

2. **"No assistants available" shows incorrectly**: The assistant fetch in `CommsConsoleContext` runs when `userId` is still null (during the 10-second auth wait), and doesn't retry when auth finally completes.

## Root Cause Analysis

From the trace data for Boot ID `ML4RZ02Y-EY5RIF`:
- `v2_init_start` at 20ms
- `fast_path_validate_success` likely completed in ~100-200ms (based on probe data)
- `v2_user_set` at **10,025ms** - 10 seconds later!

The problem is in `useAuth.tsx` lines 358-374:
```typescript
// CURRENT: Waits for BOTH to complete
const [fastResult, slowResult] = await Promise.allSettled([
  fastPath(),
  slowPath()  // <-- This times out after 10 seconds
]);
// Processing happens AFTER both complete
if (fastResult.status === 'fulfilled' && fastResult.value?.session) {
  raceResult = fastResult.value;
  // ...but user already waited 10 seconds
}
```

## Solution: True Racing with Early Exit

Replace `Promise.allSettled` with a pattern that immediately uses the first successful result and cancels/ignores the slow path.

### Implementation Strategy

```text
+---------------------------------------------------------+
|                   TRUE RACE PATTERN                      |
+---------------------------------------------------------+
|  FAST PATH              SLOW PATH                        |
|  ──────────             ─────────                        |
|  0ms: Start             0ms: Start                       |
|  100ms: Session valid   ...waiting...                    |
|  100ms: SET USER        (cancelled/ignored)              |
|  100ms: LOADING=FALSE   10000ms: Would timeout           |
+---------------------------------------------------------+
```

### Files to Modify

| File | Change | Description |
|------|--------|-------------|
| `src/hooks/useAuth.tsx` | Modify | Replace `Promise.allSettled` with true race pattern that exits immediately on fast path success |
| `src/contexts/CommsConsoleContext.tsx` | Minor fix | Ensure assistants refetch when userId changes from null to valid |

### Detailed Changes

**1. `src/hooks/useAuth.tsx` - True Race Implementation**

Replace the current race logic (lines 325-381) with:

```typescript
// STEP 2: TRUE RACE - First successful result wins immediately
bootTrace.mark('v2_race_start');

let raceWinner: { session: Session | null; source: 'fast' | 'slow' } | null = null;

// Create an abort controller for the slow path
const abortController = new AbortController();

// Fast path - returns immediately if cached session is valid
const fastPathPromise = (async () => {
  bootTrace.mark('fast_path_attempt');
  const session = await fastPathGetSession();
  if (session) {
    bootTrace.mark('fast_path_won', { userId: session.user?.id?.substring(0, 8) });
    return { session, source: 'fast' as const };
  }
  return null; // No cached session
})();

// Slow path - standard supabase-js (may hang)
const slowPathPromise = (async () => {
  bootTrace.mark('slow_path_start');
  try {
    const { data: { session }, error } = await withTimeout(
      supabase.auth.getSession(),
      AUTH_TIMEOUT_MS,
      'Authentication service timed out'
    );
    if (error) throw error;
    bootTrace.mark('slow_path_done', { hasSession: !!session });
    return { session, source: 'slow' as const };
  } catch (e) {
    bootTrace.mark('slow_path_error', { error: String(e) });
    throw e;
  }
})();

// TRUE RACE: Use Promise.race with a wrapper that ignores null results
try {
  raceWinner = await Promise.race([
    fastPathPromise.then(r => {
      if (r?.session) {
        fastPathWon = true;
        return r;
      }
      // Fast path has no session - wait for slow path
      return slowPathPromise;
    }),
    slowPathPromise
  ]);
} catch (error) {
  // If slow path threw (timeout), check if fast path had a session
  const fastResult = await fastPathPromise.catch(() => null);
  if (fastResult?.session) {
    raceWinner = fastResult;
    fastPathWon = true;
  } else {
    throw error; // Both failed
  }
}

bootTrace.mark('v2_race_complete', { 
  winner: raceWinner?.source || 'none', 
  hasSession: !!raceWinner?.session 
});
```

**Key changes:**
- Fast path that finds a valid session immediately sets the session (no waiting for slow path)
- Fast path that returns null (no cached token) falls back to slow path
- If slow path times out but fast path succeeded, use fast path result
- Both paths failing still results in timeout error

**2. `src/contexts/CommsConsoleContext.tsx` - Ensure assistants load on auth complete**

The assistants fetch should already work since it depends on `[userId]`, but we should verify. If `userId` goes from `null` → `"a3378f93-..."`, the effect should re-run.

However, the screenshots show "No assistants available" which suggests either:
a) The fetch is happening before auth completes and not re-running
b) The fetch is erroring silently

Add explicit logging and ensure the effect re-triggers:

```typescript
// In the assistants fetch useEffect (around line 164)
useEffect(() => {
  console.log('[CommsConsole] Assistants effect triggered, userId:', userId);
  if (!userId) {
    console.log('[CommsConsole] No userId yet, skipping assistant fetch');
    return;
  }
  // ... rest of fetch logic
}, [userId, isDemoMode]); // Ensure isDemoMode is also a dependency
```

## Expected Outcome

After this fix:

1. **Auth completes in ~100-200ms** for users with cached sessions (vs current 10 seconds)
2. **Assistants load immediately** after auth completes
3. **Tasks page shows tasks** instead of infinite "Loading tasks..." spinner
4. **Slow path timeout** only affects users without cached sessions (new sign-ins)

## Success Metrics

- Boot trace shows `v2_user_set` within 500ms of `v2_init_start` (for cached sessions)
- No more "No assistants available" for authenticated users
- Tasks load immediately after auth

## Risk Assessment

- **Low risk**: This is a refinement of the existing parallel strategy
- **Fallback preserved**: If fast path fails, slow path is still used
- **No breaking changes**: The session shape and auth flow remain identical
