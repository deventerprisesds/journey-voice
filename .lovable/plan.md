

# Fix: Tokens Stored in Plaintext — decrypt_token() Fails

## Root Cause

**Confirmed from live logs and DB schema**: Every "Edge Function returned a non-2xx status code" error traces back to one line:

```
Error: Calendar connection tokens not found
    at getValidAccessToken → get_calendar_connection_tokens_service
```

The RPC `get_calendar_connection_tokens_service` calls `decrypt_token()` on the stored `access_token`. But `decrypt_token()` throws an exception when called on **plaintext** data, causing the RPC to return zero rows.

**Why are tokens plaintext?** Two places bypass the encryption RPCs:

1. **`calendar-token-manager/index.ts`** — The reactivation code (lines 250-259, 291-297, and equivalent Outlook blocks) does:
   ```typescript
   await serviceClient.from('calendar_connections').update({
     access_token: tokens.access_token,  // ← PLAINTEXT!
     refresh_token: tokens.refresh_token,
   }).eq('id', existing.id);
   ```
   The `insert_calendar_connection_for_user` RPC encrypts via `encrypt_token()`, but direct `.update()` does not.

2. **`calendar-integration-manager/index.ts`** — The `doInlineRefresh` function (line ~140) also does a raw `.update()` with plaintext tokens after a token refresh.

**The fix**: An existing RPC `update_calendar_connection_tokens_for_user` already exists and encrypts properly. Both files just need to call it instead of raw `.update()`.

## Changes

### File 1: `supabase/functions/calendar-token-manager/index.ts`

Replace all 4 raw `.update()` calls for token reactivation (Google reactivate, Google 23505 reactivate, Outlook reactivate, Outlook 23505 reactivate) with:
```typescript
await serviceClient.rpc('update_calendar_connection_tokens_for_user', {
  _connection_id: existing.id,
  _user_id: userId,
  _access_token: tokens.access_token,
  _refresh_token: tokens.refresh_token || null,
  _expires_at: expiresAt,
});
```

This encrypts tokens on write, so `decrypt_token()` succeeds on read.

### File 2: `supabase/functions/calendar-integration-manager/index.ts`

In `doInlineRefresh`, replace the raw `.update()` with the same RPC:
```typescript
await supabaseClient.rpc('update_calendar_connection_tokens_for_user', {
  _connection_id: connectionId,
  _user_id: userId,
  _access_token: tokens.access_token,
  _refresh_token: tokens.refresh_token || null,
  _expires_at: expiresAt ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
});
```

### Database: Fix currently broken rows

Run a one-time update to re-encrypt the plaintext tokens for Google (`51d5aadc`) and Outlook (`bb04653a`) connections using `update_calendar_connection_tokens_for_user`. This requires a fresh OAuth exchange since the current plaintext tokens have likely expired. Alternatively, the user can simply reconnect both accounts after the code fix deploys — the reactivation path will now encrypt correctly.

## Result

- All token writes go through `encrypt_token()` via the RPC
- `decrypt_token()` in `get_calendar_connection_tokens_service` succeeds
- `listCalendars`, `syncCalendarEvents`, and `doInlineRefresh` all work
- The "Edge Function returned a non-2xx status code" error disappears

