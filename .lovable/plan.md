
Goal
- Fix “Test Failed — No Office 365 connection found…” while the UI shows Outlook “Connected”.

What’s happening (root cause)
- The “Send Test Reminder” button in Notification Settings calls the edge function: supabase/functions/send-unified-notification.
- That edge function tries to load the user’s Outlook token from calendar_connections using:
  - provider IN ('office365','outlook')
  - is_active = true
  - .maybeSingle()
- Your database currently has multiple active Outlook/Office365 rows for the same user (from earlier iterations / provider-name changes).
- When multiple rows match, .maybeSingle() fails (it expects 0 or 1 row), so the function treats it as “no connection” and returns the “No Office 365 connection found…” error.

Fix approach
- Make the backend (send-unified-notification) robust to multiple active rows by selecting the “best” connection, rather than requiring exactly one.
- Prevent new duplicates going forward by deactivating older Outlook/Office365 rows whenever a new Microsoft token is stored/refreshed.

Implementation steps (code changes)

1) Update Outlook connection selection in send-unified-notification
File: supabase/functions/send-unified-notification/index.ts

Change getOutlookConnectionForUser():
- Replace the .maybeSingle() query with “pick best connection” logic:

Selection rules (same spirit as the UI fix):
- Prefer a non-expired connection (expires_at is null OR expires_at > now), and among those pick the most recently updated.
- If none are valid, pick the most recently updated active connection.

Implementation detail (recommended)
- Do two queries with order + limit(1):
  A) “valid” query:
     - user_id = userId
     - is_active = true
     - provider IN ('office365','outlook')
     - AND (expires_at is null OR expires_at > nowISO)
     - order by updated_at desc (and optionally expires_at desc)
     - limit 1
  B) fallback query:
     - same filters except no expires_at condition
     - order by updated_at desc
     - limit 1
- This avoids the “multiple rows returned” error and ensures we consistently select a good token.

Expected outcome
- Clicking “Send Test Reminder” will stop failing simply because multiple active rows exist.

2) Prevent future duplicates in calendar-token-manager when saving Microsoft tokens
File: supabase/functions/calendar-token-manager/index.ts

A) Make “existing connection lookup” resilient
- In exchangeMicrosoftCode(), the lookup uses .maybeSingle() across provider IN ('outlook','office365') + provider_account_id.
- If both an 'outlook' and an 'office365' row exist for the same account id, that can also produce multiple rows and break refresh logic.
- Change the lookup to either:
  - use order('updated_at', { ascending: false }).limit(1).maybeSingle()
  - or fetch multiple and pick the most recently updated.

B) Deactivate older active Outlook/Office365 rows after a successful insert/refresh
- After the code successfully updates or inserts the new/refresh connection, run a cleanup update:
  - set is_active = false
  - where user_id = userId
  - and provider IN ('outlook','office365')
  - and is_active = true
  - and id != “the chosen/updated/inserted id”
- This ensures there is only one active Outlook connection going forward, reducing future confusion and edge-function ambiguity.

3) Deploy updated edge functions
- Deploy:
  - send-unified-notification
  - calendar-token-manager

4) Validate end-to-end
- In the app:
  - Go to Settings → Notifications
  - Confirm Outlook still displays “Connected”
  - Tap “Send Test Reminder”
  - Expect success toast and a calendar event created in Outlook.
- If it still fails, check edge logs for send-unified-notification to confirm which connection row was selected and whether token decryption/refresh succeeded.

Edge cases considered
- Multiple active connections where one is expired and another is valid: we will select the valid one.
- All active connections are expired: we’ll select the most recently updated and then proceed into the refresh flow (if refresh_token exists).
- Mixed provider labels ('outlook' vs 'office365'): treated as the same provider group everywhere.

Files affected
- supabase/functions/send-unified-notification/index.ts
- supabase/functions/calendar-token-manager/index.ts
