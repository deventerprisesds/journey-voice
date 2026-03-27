

# Fix: Calendar Sync Broken + Google OAuth redirect_uri_mismatch

## Two Problems

### Problem 1: Google OAuth `redirect_uri_mismatch`

The screenshot shows Google blocking the OAuth flow with `Error 400: redirect_uri_mismatch`. This happens because the published URL `https://journey-voice.lovable.app/settings` is not listed as an authorized redirect URI in the Google Cloud Console.

**Fix**: You need to add the following to your Google Cloud Console (APIs & Credentials > OAuth 2.0 Client > Authorized redirect URIs):
- `https://journey-voice.lovable.app/settings`

This is a configuration change in Google Cloud Console, not a code change.

### Problem 2: Delta sync skips expired connections instead of refreshing them

In `calendar-delta-sync/index.ts` lines 64-77, expired connections are **skipped entirely** with a "Token expired" error. But the function already has working `refreshGoogleToken` and `refreshOutlookToken` functions — they just never get called for expired connections because the check on line 66 bails out before the API call (and the refresh logic only triggers on a 401 response).

This means: once `expires_at` passes (typically 1 hour after last refresh), delta-sync silently stops syncing that connection until the user manually reconnects. This is why syncs worked this morning but stopped later.

**Fix**: In `supabase/functions/calendar-delta-sync/index.ts`, replace the "skip expired" block (lines 64-77) with proactive token refresh:

```ts
// If token is expired, try to refresh it before skipping
if (connection.expires_at && new Date(connection.expires_at) < now) {
  console.log(`[calendar-delta-sync] Token expired for ${connection.id}, attempting refresh...`);
  
  const { data: tokenData } = await supabaseClient
    .rpc('get_calendar_connection_tokens', { _connection_id: connection.id });
  
  if (tokenData?.[0]?.refresh_token) {
    let refreshed: string | null = null;
    if (connection.provider === 'google') {
      refreshed = await refreshGoogleToken(supabaseClient, connection, tokenData[0]);
    } else if (connection.provider === 'outlook' || connection.provider === 'office365') {
      refreshed = await refreshOutlookToken(supabaseClient, connection, tokenData[0]);
    }
    
    if (!refreshed) {
      // Refresh failed — skip this connection
      results.push({ connection_id: connection.id, provider: connection.provider,
        events_added: 0, events_updated: 0, events_deleted: 0,
        error: 'Token expired and refresh failed - needs re-authentication' });
      continue;
    }
    // Refresh succeeded — continue to normal sync (tokens updated in DB)
    console.log(`[calendar-delta-sync] Token refreshed for ${connection.id}, proceeding with sync`);
  } else {
    results.push({ connection_id: connection.id, provider: connection.provider,
      events_added: 0, events_updated: 0, events_deleted: 0,
      error: 'Token expired, no refresh token available' });
    continue;
  }
}
```

## Files to Change

| File | Change |
|------|--------|
| `supabase/functions/calendar-delta-sync/index.ts` | Replace skip-on-expired with proactive token refresh (lines 64-77) |
| **Google Cloud Console** (manual) | Add `https://journey-voice.lovable.app/settings` to authorized redirect URIs |

## Result

- Expired tokens get automatically refreshed during delta-sync, so calendar events keep flowing in
- Google OAuth will work from the published app once the redirect URI is added in Google Cloud Console

