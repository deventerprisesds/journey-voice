
# Conservative Fix: Auth Login Loop with Full Backup & Traceability

## Approach Philosophy

**No existing code will be removed.** All changes are **additive** - parallel implementations that can be toggled, bypassed, or reverted instantly. The existing Supabase auth flow remains untouched as the primary path.

---

## Problem Summary

After clicking "Continue with Google" on the published site:
1. User redirects to Google, authenticates successfully
2. Returns to app, but session is never recognized
3. App redirects back to `/auth` → login loop

---

## Root Cause (High Confidence)

The current `initAuth()` in `useAuth.tsx` has a timing vulnerability:

```text
1. getSession() called first
2. Supabase exchanges OAuth code → fires SIGNED_IN event
3. onAuthStateChange() attached AFTER → event missed
4. App sees no session → redirects to /auth
```

This race condition was always present but "lucky timing" masked it. A change in network latency, Supabase internal timing, or browser behavior can flip it to consistent failure.

---

## Solution: Parallel "V2" Auth Flow + Boot Trace

### Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                        AuthProvider                          │
├─────────────────────────────────────────────────────────────┤
│  useAuthV2Mode = false (default)                            │
│                                                             │
│  if (useAuthV2Mode) {                                       │
│    → initAuthV2() ← NEW: listener-first, race-safe         │
│  } else {                                                   │
│    → initAuth()   ← EXISTING: unchanged backup              │
│  }                                                          │
│                                                             │
│  + bootTrace logging at every step                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Details

### 1. Boot Trace System (New File)

**File: `src/utils/bootTrace.ts`**

A lightweight diagnostic system that:
- Generates a unique `boot_id` per app load
- Records timestamped steps: `auth_init_start`, `listener_attached`, `getSession_start`, `getSession_done`, `user_set`, etc.
- Stores in memory for UI display
- Best-effort logs to `error_log` table (never blocks)
- Provides `copyDiagnostics()` for one-click sharing

### 2. Safe Storage Adapter (Additive to client.ts)

**File: `src/integrations/supabase/client.ts`**

Add a `createSafeStorage()` wrapper that:
- Tests `localStorage` availability
- Falls back to in-memory storage if blocked
- Logs which mode is active
- **Does NOT change the existing export** - just wraps the storage option

### 3. V2 Auth Initialization (Parallel to existing)

**File: `src/hooks/useAuth.tsx`**

Add a new function `initAuthV2()` alongside existing `initAuth()`:

```typescript
// NEW V2 FLOW (parallel, not replacing)
const initAuthV2 = useCallback(async () => {
  bootTrace.mark('v2_init_start');
  
  // STEP 1: Attach listener FIRST (before any getSession)
  const { data: { subscription } } = supabase.auth.onAuthStateChange(
    (event, session) => {
      bootTrace.mark(`auth_event:${event}`);
      handleAuthChange(event, session);
    }
  );
  bootTrace.mark('v2_listener_attached');
  
  // STEP 2: Now seed initial state
  const { data: { session } } = await supabase.auth.getSession();
  bootTrace.mark('v2_getSession_done');
  
  if (session?.user) {
    setUser(session.user);
    setSession(session);
    bootTrace.mark('v2_user_set');
  }
  
  setLoading(false);
  bootTrace.mark('v2_init_complete');
  
  return () => subscription.unsubscribe();
}, [...]);
```

**Toggle mechanism:**
```typescript
// Feature flag - easy to switch back
const USE_V2_AUTH = true; // Set to false to revert to original

useEffect(() => {
  if (USE_V2_AUTH) {
    initAuthV2().then(cleanup => ...);
  } else {
    initAuth().then(cleanup => ...);  // Original preserved
  }
}, [...]);
```

### 4. Enhanced ProtectedRoute Diagnostics

**File: `src/components/ProtectedRoute.tsx`**

Add to the slow-load warning panel:
- Display current `boot_id`
- Show last trace step reached
- Add "Copy Diagnostics" button that copies full trace to clipboard
- All additive - existing UI structure unchanged

### 5. Environment-Aware OAuth (Additive)

**File: `src/pages/Auth.tsx`**

Add a production-specific code path that uses standard redirect instead of popup:

```typescript
const isProductionDomain = window.location.hostname === 'journey-voice.lovable.app';

const handleGoogleSignIn = async () => {
  if (isProductionDomain) {
    // Production: standard redirect (no popup issues)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth`,
        // NO skipBrowserRedirect - normal flow
      }
    });
  } else {
    // Preview/dev: existing popup logic (unchanged)
    // ... existing code stays here ...
  }
};
```

### 6. Debug Page (New Route)

**File: `src/pages/Debug.tsx`** (new)

A dedicated diagnostics page showing:
- Boot ID and timestamp
- Environment detection results
- Current auth state (user email, session expiry - no tokens)
- Full boot trace timeline
- Action buttons: Copy Diagnostics, Sign Out, Clear Storage, Unregister SW

**Route addition in `src/App.tsx`:**
```typescript
<Route path="/debug" element={<Debug />} />
```

---

## Files to Modify/Create

| File | Action | Risk |
|------|--------|------|
| `src/utils/bootTrace.ts` | **Create** | None - new file |
| `src/integrations/supabase/client.ts` | **Add** safe storage wrapper | Very Low - additive only |
| `src/hooks/useAuth.tsx` | **Add** `initAuthV2()` parallel to existing | Low - toggle controlled |
| `src/components/ProtectedRoute.tsx` | **Add** diagnostics UI | Low - additive to existing |
| `src/pages/Auth.tsx` | **Add** production-specific OAuth path | Low - conditional branch |
| `src/pages/Debug.tsx` | **Create** | None - new file |
| `src/App.tsx` | **Add** `/debug` route | None - new route |

---

## Rollback Strategy

If V2 auth causes issues:
1. Set `USE_V2_AUTH = false` in `useAuth.tsx`
2. App immediately uses original `initAuth()` - unchanged from current
3. No other code changes needed

---

## Validation Steps

After deployment:
1. Open `journey-voice.lovable.app/debug` - verify boot trace is logging
2. Click "Continue with Google" on `/auth`
3. **Success case**: Redirects to `/tasks` with session
4. **Failure case**: Open `/debug`, click "Copy Diagnostics", share with me
5. Trace will show exactly which step didn't happen (e.g., "last step: `v2_listener_attached`, missing: `auth_event:SIGNED_IN`")

---

## Technical: Why This Should Fix It

The Supabase recommended pattern is:

```typescript
// 1. Subscribe FIRST
onAuthStateChange((event, session) => { ... });

// 2. THEN get initial session
getSession();
```

This ensures:
- The `SIGNED_IN` event from OAuth code exchange is **never missed**
- Session is available immediately after listener fires
- No race between "get session" and "listen for changes"

The current code does it in reverse order, which works most of the time but fails when Supabase finishes the OAuth exchange quickly.

---

## Summary

- **Zero removals** - all existing auth code preserved
- **Feature flag** toggle between V2 and original
- **Full boot tracing** for instant diagnosis of any future issues
- **Safe storage** adapter prevents localStorage crashes
- **/debug page** for production troubleshooting
- **Environment-aware OAuth** reduces popup/redirect variability
