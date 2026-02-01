

# Fix: OAuth Callback Collision Between Supabase Auth and Calendar OAuth

## Root Cause Identified

The `useOAuthCallback` hook cannot distinguish between two different OAuth flows that both use `code` and `state` URL parameters:

1. **Supabase Auth OAuth** (Google Sign-In)
   - Returns: `code=auth_code&state=pkce_random_token`
   - Should be handled automatically by Supabase client
   
2. **Calendar OAuth** (Google/Outlook Calendar connection)
   - Returns: `code=calendar_code&state=google` or `state=outlook`
   - Should be handled by our `useOAuthCallback` hook

Currently, the hook fires for BOTH flows because it only checks if `code` and `state` exist, not whether the `state` value indicates a calendar OAuth flow.

## Why This Causes Re-Authentication Issues

When a user signs in with Google:
1. After auth, URL contains `?code=xxx&state=pkce_token`
2. `useOAuthCallback` runs (it's in Calendar and Settings pages)
3. It calls `supabase.auth.getSession()` before Supabase has finished restoring the session
4. Finding no session, it may redirect to `/auth` or create race conditions
5. Meanwhile, Supabase's own auth callback handler is trying to process the same `code`

## Solution

Add a guard to `useOAuthCallback` to **only process calendar OAuth callbacks**, by checking that `state` equals exactly `'google'` or `'outlook'`.

### Code Change

**File: `src/hooks/useOAuthCallback.tsx`**

```tsx
// Current code (line 31):
if (code && state) {
  const provider = state; // 'google' or 'outlook'

// Fixed code:
if (code && state && (state === 'google' || state === 'outlook')) {
  const provider = state;
```

This single change ensures:
- Supabase Auth callbacks (where `state` is a PKCE token) are **ignored** by this hook
- Calendar OAuth callbacks (where `state` is explicitly `'google'` or `'outlook'`) are **processed**

## Additional Cleanup: Remove Duplicate AuthContext

There's also a duplicate `src/contexts/AuthContext.tsx` file that's not imported anywhere but could cause confusion. It should be deleted to prevent future issues.

## Files to Change

| File | Change |
|------|--------|
| `src/hooks/useOAuthCallback.tsx` | Add `state === 'google' \|\| state === 'outlook'` guard to line 31 |
| `src/contexts/AuthContext.tsx` | Delete (unused duplicate of `src/hooks/useAuth.tsx`) |

## Technical Details

### Before (problematic):
```tsx
// Fires for ANY OAuth callback with code + state
if (code && state) {
  const provider = state; // Could be 'google', 'outlook', OR a PKCE token!
```

### After (fixed):
```tsx
// Only fires for calendar-specific OAuth callbacks
if (code && state && (state === 'google' || state === 'outlook')) {
  const provider = state as 'google' | 'outlook';
```

## Expected Result

- Google Sign-In works without triggering calendar token exchange
- Calendar OAuth connection works as before (unchanged flow)
- No more re-authentication loops when already signed in
- Clean codebase with single source of truth for auth context

