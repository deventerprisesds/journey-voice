

# Fix Plan: Smart Connection Detection and UPSERT Logic

## Summary

Two fixes to make the Outlook connection experience seamless:
1. **Edge Function UPSERT**: Update existing connections instead of failing on duplicates
2. **Better Error Messages**: Clear, actionable messages for known failure modes

## Current Issues

| Issue | Current Behavior | Expected Behavior |
|-------|------------------|-------------------|
| Re-connecting same account | Error 23505 (duplicate key) | Update tokens silently |
| UI shows "invalid" | Generic error toast | Show "Already connected!" or "Connection refreshed!" |
| CalendarConnectionModal | Only looks up by exact provider name | Should accept both `outlook` and `office365` |

## Changes to Implement

### 1. Edge Function: Add UPSERT Logic

**File: `supabase/functions/calendar-token-manager/index.ts`**

Modify `exchangeMicrosoftCode` (lines 302-379) and `exchangeGoogleCode` (lines 222-300):

```typescript
// In exchangeMicrosoftCode, BEFORE the INSERT (around line 354)

// First check if connection already exists for this provider + account
const { data: existing, error: lookupError } = await supabaseClient
  .from('calendar_connections')
  .select('id')
  .eq('user_id', userId)
  .in('provider', ['outlook', 'office365'])  // Accept both provider names
  .eq('provider_account_id', userInfo.id)
  .maybeSingle();

if (lookupError && lookupError.code !== 'PGRST116') {
  console.error('Error checking existing connection:', lookupError);
  throw new Error(`Failed to check existing connection: ${lookupError.message}`);
}

if (existing) {
  // UPDATE existing connection with fresh tokens
  console.log(`Refreshing existing connection ${existing.id} with new tokens`);
  
  const { error: updateError } = await supabaseClient
    .rpc('update_calendar_connection_tokens_for_user', {
      _connection_id: existing.id,
      _user_id: userId,
      _access_token: tokens.access_token,
      _refresh_token: tokens.refresh_token || null,
      _expires_at: expiresAt
    });

  if (updateError) {
    console.error('Failed to refresh connection:', updateError);
    throw new Error(`REFRESH_FAILED: Could not refresh existing connection`);
  }

  return {
    success: true,
    connection_id: existing.id,
    provider: 'outlook',
    email: userInfo.mail || userInfo.userPrincipalName,
    refreshed: true,
    message: 'Connection refreshed with new tokens'
  };
}

// If no existing connection, proceed with INSERT (existing code)
const { data: connectionId, error: insertError } = await supabaseClient
  .rpc('insert_calendar_connection_for_user', { ... });

// Add fallback handling for race condition duplicates
if (insertError) {
  if (insertError.code === '23505') {
    // Duplicate detected (race condition) - treat as success
    console.log('Duplicate detected, connection already exists');
    return {
      success: true,
      provider: 'outlook',
      email: userInfo.mail || userInfo.userPrincipalName,
      refreshed: true,
      message: 'ALREADY_CONNECTED: Connection already exists and is valid'
    };
  }
  throw new Error(`Failed to store connection: ${insertError.message}`);
}
```

### 2. Database Function: Token Update with User ID

**New Migration:**

```sql
CREATE OR REPLACE FUNCTION public.update_calendar_connection_tokens_for_user(
  _connection_id uuid,
  _user_id uuid,
  _access_token text,
  _refresh_token text DEFAULT NULL,
  _expires_at timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.calendar_connections 
  SET 
    access_token = public.encrypt_token(_access_token, _user_id),
    refresh_token = CASE 
      WHEN _refresh_token IS NOT NULL THEN public.encrypt_token(_refresh_token, _user_id)
      ELSE refresh_token
    END,
    expires_at = COALESCE(_expires_at, expires_at),
    is_active = true,
    updated_at = now()
  WHERE id = _connection_id 
    AND user_id = _user_id;  -- Security: verify ownership
  
  IF FOUND THEN
    PERFORM public.log_oauth_token_access(_connection_id, 'refreshed_via_reauth');
    RETURN true;
  ELSE
    RETURN false;
  END IF;
END;
$$;
```

### 3. UI Callback Handler: Better Error Interpretation

**File: `src/hooks/useOAuthCallback.tsx`**

Update error handling (around line 97):

```typescript
if (exchangeError) {
  console.error('[OAuth] Token exchange error:', exchangeError);
  
  const errorMessage = exchangeError.message || '';
  
  // Check for "already connected" scenarios - treat as success
  if (errorMessage.includes('ALREADY_CONNECTED') || 
      errorMessage.includes('23505') ||
      errorMessage.includes('duplicate key')) {
    console.log('[OAuth] Connection already exists, treating as success');
    toast.success(`${provider === 'google' ? 'Google' : 'Outlook'} Calendar is already connected!`);
    
    // Dispatch refresh event to update UI
    window.dispatchEvent(new CustomEvent('calendar-connection-updated', {
      detail: { provider }
    }));
    
    navigate(location.pathname, { replace: true });
    return;  // Exit without throwing - this is a success case
  }
  
  // Handle authentication errors
  if (errorMessage.includes('User authentication required')) {
    toast.error('Could not verify your sign-in. Please sign in and try again.');
  } else {
    toast.error(`Failed to connect calendar: ${errorMessage}`);
  }
  
  // Still dispatch refresh to show true connection state
  window.dispatchEvent(new CustomEvent('calendar-connection-updated', {
    detail: { provider }
  }));
  
  throw exchangeError;
}

// Handle successful response - check if it was a refresh or new connection
if (data?.refreshed) {
  toast.success(`${provider === 'google' ? 'Google' : 'Outlook'} Calendar connection refreshed!`);
} else {
  toast.success(`Successfully connected to ${provider === 'google' ? 'Google' : 'Outlook'} Calendar`);
}
```

### 4. CalendarConnectionModal: Accept Both Provider Names

**File: `src/components/CalendarConnectionModal.tsx`**

Update `loadConnectedProviders` (around line 37):

```typescript
if (data && Array.isArray(data)) {
  data.forEach((conn: any) => {
    const isExpired = conn.expires_at ? new Date(conn.expires_at) < new Date() : false;
    
    // Normalize provider name - treat 'office365' as 'outlook'
    const providerKey = conn.provider === 'office365' ? 'outlook' : conn.provider;
    
    // Only store if not already set, or if this one is more recent/valid
    if (!status[providerKey] || (!isExpired && status[providerKey].expired)) {
      status[providerKey] = {
        connected: true,
        expired: isExpired,
        connectionId: conn.id
      };
    }
  });
}
```

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/calendar-token-manager/index.ts` | Add UPSERT logic for both Google and Microsoft flows |
| Database migration | Add `update_calendar_connection_tokens_for_user` RPC |
| `src/hooks/useOAuthCallback.tsx` | Handle "already connected" as success, show appropriate messages |
| `src/components/CalendarConnectionModal.tsx` | Normalize `office365` to `outlook` in status lookup |

## Expected Flow After Fix

```text
User clicks "Connect Outlook"
        ↓
OAuth redirect to Microsoft
        ↓
User authorizes → redirect back with code
        ↓
calendar-token-manager exchange_code
        ↓
    ┌───────────────────────────────────────┐
    │ Check: Does connection already exist? │
    │ (user_id + provider + account_id)     │
    └───────────────────────────────────────┘
        ↓                    ↓
    EXISTS                NOT EXISTS
        ↓                    ↓
    UPDATE tokens        INSERT new connection
    Return {               Return {
      refreshed: true        refreshed: false
    }                      }
        ↓                    ↓
    ┌───────────────────────────────────────┐
    │ UI: "Connection refreshed!"           │
    │  or "Successfully connected!"         │
    │                                       │
    │ Button shows: Connected ✓             │
    └───────────────────────────────────────┘
```

## Answer to Your Question

> Is the reset event mode updated to work with Outlook instead of office365?

**Yes!** I checked these files:

| File | Status |
|------|--------|
| `calendar-integration-manager` | Already handles both (`connection.provider === 'outlook' \|\| connection.provider === 'office365'`) |
| `send-unified-notification` | Updated in last change (`.in('provider', ['office365', 'outlook'])`) |
| `NotificationSettings.tsx` | Updated in last change (accepts both) |
| `CalendarConnectionModal.tsx` | **Needs fix** - currently uses exact provider name lookup |

The calendar event creation and notification system already work with both provider names. The remaining fix is in `CalendarConnectionModal` to normalize the lookup.

