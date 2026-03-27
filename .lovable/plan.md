
Root cause is now clear from the actual live logs and code.

## What is actually failing

Your reconnect is not failing at Google/Microsoft anymore. The provider auth succeeds, but the app fails on the final “save connection” step inside `calendar-token-manager`.

The decisive log is:

```text
Could not choose the best candidate function between:
public.insert_calendar_connection_for_user(... _expires_at)
public.insert_calendar_connection_for_user(... _expires_at, _purposes)
```

That means the database currently has two overloaded versions of `insert_calendar_connection_for_user`, and `calendar-token-manager` calls it without `_purposes`, so PostgREST cannot decide which one to execute.

## Why you still get “edge function” errors

Because the edge function does this sequence:

1. Exchange OAuth code successfully
2. Fetch the Google/Microsoft account email successfully
3. Try to insert the connection via RPC
4. RPC call fails with `PGRST203`
5. Edge function returns 500
6. No fresh connection row is saved

So the reconnect appears to “work” at the provider level, but nothing new is actually persisted.

## Why the old 3 connections still matter

You do not need them.

They are still active only because the new reconnect never finishes saving. Since no new row is created or refreshed, the system keeps using the older active rows.

For `dev@enterpriseds.io`, the currently active rows are still old/stale mixtures:
- old Google row
- multiple Outlook/Office365 rows
- at least some are legacy and duplicated

That is why sync keeps behaving inconsistently.

## Secondary issue confirmed

`calendar-delta-sync` is currently not crashing on `metadata` anymore in the live logs. It is now saying:

```text
[calendar-delta-sync] No READ connections found
```

That likely means the preview session is hitting demo/no-auth state, while your live user has active rows in the DB. So the immediate blocker for your reconnect flow is not delta sync first — it is the failed insert RPC in `calendar-token-manager`.

## Implementation plan

### 1. Fix the overloaded RPC ambiguity
Update `calendar-token-manager` so every call to `insert_calendar_connection_for_user` passes `_purposes`.

Use explicit args like:
- `_purposes: ['READ', 'WRITE']`

This removes the PostgREST ambiguity immediately without relying on overload resolution.

Files:
- `supabase/functions/calendar-token-manager/index.ts`

### 2. Make the DB function set unambiguous going forward
Add a migration to remove the legacy 8-argument overload of `insert_calendar_connection_for_user`, keeping only the newer version that accepts `_purposes`.

This prevents the same bug from recurring elsewhere.

Files:
- new migration in `supabase/migrations/`

### 3. Auto-clean older active connections after successful Google reconnect too
The Outlook path already has cleanup logic that deactivates older Microsoft rows after a successful save/update.
The Google path should do the same after successful create/refresh:
- keep the chosen/current Google connection active
- deactivate older Google rows for that user

Files:
- `supabase/functions/calendar-token-manager/index.ts`

### 4. Stop relying on “best single connection” in settings UI
The settings UI is still choosing only one “best” Google and one “best” Outlook connection, which hides the duplicate-row problem and makes debugging harder.

Refactor connection loading to:
- show all active connections
- mark expired/stale ones clearly
- allow disconnect/deactivate per row
- keep READ/WRITE controls per connection

Files:
- `src/components/NotificationSettings.tsx`
- likely align with `CalendarConnectionModal.tsx`

### 5. Add explicit stale-connection cleanup for existing bad rows
Because you already have old rows in production, add one cleanup path:
- either automatic deactivation of older duplicate provider/account rows after successful reconnect
- or a manual “Disconnect old connections” action in UI

For your case, cleanup should preserve the newest valid connection and deactivate older duplicates.

### 6. Verify the end-to-end live flow
After implementation, verify in this order:
1. Reconnect Google
2. Confirm `calendar-token-manager` returns 200, not 500
3. Confirm a fresh/updated Google row exists for user `a3378f93-d655-4913-b2fa-ca5b1d8020f1`
4. Confirm old duplicate Google rows are inactive
5. Reconnect Outlook if needed
6. Confirm `list_calendars` returns calendars for the new row
7. Confirm `calendar-delta-sync` pulls events for the live user
8. Confirm Focus/Today view shows external events

## Expected outcome

After this fix:
- reconnect will stop ending in vague “edge function” errors
- new Google/Outlook connections will actually save
- stale old connections will no longer be the ones being synced
- calendar pull/push controls will behave predictably per connection

## Technical details

### Confirmed evidence
- `calendar-token-manager` log shows successful token exchange, then failure on RPC insert
- DB shows two overloads of `insert_calendar_connection_for_user`
- DB still shows older active connection rows because new reconnects were never saved
- current active rows for the live user include multiple Outlook-family rows and an expired Google row

### Exact root-cause statement
```text
PostgREST RPC dispatch is ambiguous because public.insert_calendar_connection_for_user
exists in two overloaded forms, and the edge function invokes it without _purposes.
Therefore new OAuth connections fail to persist, leaving stale active connections in place.
```

### Files to change
- `supabase/functions/calendar-token-manager/index.ts`
- new migration under `supabase/migrations/`
- `src/components/NotificationSettings.tsx` (multi-row visibility / cleanup UX)

