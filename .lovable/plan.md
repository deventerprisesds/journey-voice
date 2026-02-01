
# Fix: Microsoft OAuth Edge Function Authentication Failure

## Problem Summary

After successfully authenticating with Microsoft, the edge function `calendar-token-manager` fails with "User authentication required" when trying to exchange the OAuth code for tokens.

**Flow:**
1. User clicks "Connect Outlook" → `get_oauth_url` works fine (no auth needed)
2. User authenticates on Microsoft's consent screen
3. Microsoft redirects back with `?code=...&state=outlook`
4. `useOAuthCallback` calls `exchange_code` action
5. Edge function fails: `supabase.auth.getUser()` returns null

## Root Cause

The edge function uses deprecated authentication patterns:

```typescript
// Current (broken) approach in calendar-token-manager:
supabaseClient.auth.setSession({
  access_token: authHeader.replace('Bearer ', ''),
  refresh_token: ''
})

const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
// This fails because setSession() is deprecated for edge functions
```

`setSession()` doesn't properly authenticate the client in the current Supabase edge runtime. The correct approach is to use `getClaims()` for JWT validation.

## Solution

### Part 1: Fix Edge Function Authentication

Update `supabase/functions/calendar-token-manager/index.ts` to use proper JWT validation:

```typescript
// Replace the setSession() pattern with getClaims()
const authHeader = req.headers.get('Authorization')
if (!authHeader?.startsWith('Bearer ')) {
  // For get_oauth_url action, auth is optional
  if (action !== 'get_oauth_url') {
    throw new Error('No authorization header')
  }
}

// Create client with auth header
const supabaseClient = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  { global: { headers: { Authorization: authHeader } } }
)

// For actions requiring auth, validate JWT with getClaims()
case 'exchange_code':
  const token = authHeader?.replace('Bearer ', '')
  if (!token) {
    throw new Error('User authentication required')
  }
  
  const { data: claims, error: claimsError } = await supabaseClient.auth.getClaims(token)
  if (claimsError || !claims?.claims) {
    throw new Error('User authentication required')
  }
  
  const userId = claims.claims.sub
  // Continue with token exchange...
```

### Part 2: Improve useOAuthCallback Session Detection

The hook currently waits 5 seconds for session, but the session should already exist in localStorage. The issue is timing:

```typescript
// In useOAuthCallback.tsx - add better session restoration logging
const { data: sessionData } = await supabase.auth.getSession();

if (!sessionData.session) {
  console.warn('[OAuth] No session found immediately. Checking localStorage...');
  
  // Force refresh the session from localStorage
  await supabase.auth.refreshSession();
  const { data: refreshed } = await supabase.auth.getSession();
  
  if (refreshed.session) {
    console.log('[OAuth] Session restored after refresh');
  }
}
```

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/calendar-token-manager/index.ts` | Replace `setSession()` with `getClaims()` for proper JWT validation |
| `src/hooks/useOAuthCallback.tsx` | Add session refresh attempt before falling back to timeout |

## Technical Flow After Fix

```text
User clicks "Connect Outlook"
    ↓
get_oauth_url (no auth needed) → returns Microsoft OAuth URL
    ↓
User redirected to Microsoft, authenticates
    ↓
Microsoft redirects to /calendar?code=...&state=outlook
    ↓
useOAuthCallback detects code + state
    ↓
supabase.auth.getSession() → session exists (persisted from before redirect)
    ↓
supabase.functions.invoke('calendar-token-manager', {
  body: { action: 'exchange_code', code, provider: 'outlook', redirect_uri }
})
    ↓
Edge function: getClaims(token) → validates JWT, extracts userId
    ↓
exchangeMicrosoftCode() → exchanges code for tokens, stores connection
    ↓
Returns success → toast shows "Successfully connected to Outlook Calendar"
```

## Config Changes

Update `supabase/config.toml` to ensure JWT verification is disabled (handled in code):

```toml
[functions.calendar-token-manager]
verify_jwt = false
```

This allows the edge function to handle both authenticated and unauthenticated actions (like `get_oauth_url`) in the same function.
