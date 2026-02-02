
# Fix Plan: Supabase Auth `getSession()` Hanging Issue

## Problem Summary
The production app shows "Connection to authentication service timed out" after 10 seconds, despite the auth endpoint being healthy (verified via direct fetch probes). The issue is **inside supabase-js**, not at the network layer.

## Root Cause Analysis
Based on the backend traces:
- Auth endpoint responds in ~131ms when probed directly with `fetch()`
- `supabase.auth.getSession()` hangs for 10+ seconds and times out
- This pattern suggests an internal lock or deadlock in supabase-js (possibly IndexedDB, storage, or internal state machine)

## Solution: Parallel Auth Strategy with Direct Token Check

We will implement a "race" strategy that checks for an existing session token via direct localStorage/REST before waiting on `supabase.auth.getSession()`:

### Phase 1: Fast-Path Token Detection

Add a fast check that reads the auth token directly from localStorage and validates it via REST API (bypassing supabase-js entirely):

```text
┌─────────────────────────────────────────────────────────────┐
│                     AUTH INITIALIZATION                      │
├─────────────────────────────────────────────────────────────┤
│  FAST PATH (Direct REST)           SLOW PATH (supabase-js)  │
│  ────────────────────────          ─────────────────────────│
│  1. Read token from localStorage   1. supabase.getSession() │
│  2. POST /auth/v1/user (validate)  2. Wait up to 10s        │
│  3. If valid → use session         3. Timeout → error       │
│                                                              │
│  RACE: First successful path wins, cancels the other        │
└─────────────────────────────────────────────────────────────┘
```

### Phase 2: Implementation Details

**Files to modify:**

1. **`src/integrations/supabase/client.ts`** - Add helper to read stored session token directly
2. **`src/utils/directAuth.ts`** (new) - Direct REST-based session validation
3. **`src/hooks/useAuth.tsx`** - Add fast-path race to initAuthV2

**Key code changes:**

1. Create `src/utils/directAuth.ts`:
   - `getStoredTokens()` - Read access_token/refresh_token from localStorage
   - `validateTokenDirect()` - POST to `/auth/v1/user` with the token
   - `refreshTokenDirect()` - POST to `/auth/v1/token?grant_type=refresh_token` if expired

2. Modify `initAuthV2()` in useAuth.tsx:
   - Run fast-path and slow-path in parallel with `Promise.race()`
   - If fast-path succeeds first (user has valid cached token), use it immediately
   - If fast-path fails (no token, invalid, etc.), fall back to supabase-js path
   - Log which path won for debugging

### Phase 3: Fallback Improvements

- If both paths fail, show a more specific error based on which failed:
  - "No stored session" → Redirect to sign in
  - "Token expired and refresh failed" → Clear storage and redirect to sign in
  - "Network timeout" → Show retry with network diagnostics

### Phase 4: Logging for Diagnosis

Add trace steps to capture:
- Whether a stored token was found
- Fast-path validation result and latency
- Which path won the race
- Any errors from either path

## Files Changed

| File | Change Type | Description |
|------|-------------|-------------|
| `src/utils/directAuth.ts` | Create | Direct REST auth validation utility |
| `src/hooks/useAuth.tsx` | Modify | Add fast-path race to initAuthV2 |
| `src/integrations/supabase/client.ts` | Modify | Export storage key constant |

## Success Criteria

1. Users with valid cached sessions load instantly (fast-path wins)
2. Users without sessions are redirected to sign-in quickly
3. The 10-second timeout only triggers if both paths fail (rare)
4. Backend logs show which path resolved first for debugging

## Risk Assessment

- **Low risk**: Fast-path is additive; supabase-js path remains as fallback
- **No breaking changes**: Existing behavior preserved if fast-path fails
- **Rollback**: Can disable fast-path with a feature flag

## Alternative Considered

Replacing supabase-js entirely was considered but rejected because:
- Would lose automatic token refresh, listener events, and other features
- Higher maintenance burden
- The parallel strategy gives us the best of both worlds
