
Goal: fix why channel test buttons appear to “fail” in live use, explain/clean duplicate delivery paths, and fix calendar reconnect errors.

What I verified from your live project:
1) The test buttons are reaching backend functions.
- `send-unified-notification` logs show Email, Slack, Google Event, Outlook Event tests were invoked.
- `send-push-notification` logs show push was sent successfully to 1 subscription.

2) Current test UX is misleading.
- `send-unified-notification` treats `n8n workflow started` as success, but that is only “queued,” not confirmed delivered.
- UI currently shows success toast for Slack without checking per-channel delivery result in detail.

3) Calendar reconnect error has a confirmed DB root cause.
- `insert_calendar_connection_for_user` exists in two overloaded signatures (8-arg + 9-arg), which can cause PostgREST RPC ambiguity during OAuth token exchange.

4) Yes, there are duplicate/parallel notification paths.
- Immediate tests call edge functions directly from UI.
- Scheduled reminders go through `notification-delivery`.
- Slack/email/google depend on `UNIFIED_WEBHOOK_URL` (n8n), while push is sent directly via `send-push-notification`.

Implementation plan:
1) Fix calendar OAuth reconnect reliability (DB migration)
- Drop legacy 8-arg `insert_calendar_connection_for_user` overload.
- Keep only the 9-arg version (`_purposes` with default), so RPC resolution is unambiguous.

2) Make test results truthful in Notification Settings UI
- Update `sendTestEmail/sendTestSlack/sendTestGoogleEvent/sendTestOutlookEvent/sendTestPush` to inspect returned payloads (`success`, `errors`, `channelResults`) and show:
  - Delivered
  - Queued (workflow started, unconfirmed)
  - Failed (with concrete reason)
- Stop showing optimistic success for Slack when only queueing occurred.

3) Add explicit delivery diagnostics for each test click
- Persist a test entry in `delivery_logs` with channel + response summary so you can see exactly what happened after pressing each button.
- Surface “last test status per channel” in the settings/testing area.

4) Reduce duplicate-source confusion (single canonical path for tests)
- Route all channel tests through one unified test contract (including push), with consistent response format.
- Keep push direct send under the hood, but report it through the same unified result object.
- Clearly label channels as:
  - Directly confirmed (push/outlook when API returns success)
  - Queued via workflow (email/slack/google through n8n unless callback confirms final delivery)

5) Add downstream confirmation support (optional but recommended)
- Use `notification-callback` from n8n to mark final delivered/failed state for email/slack/google tests.
- This upgrades “workflow started” into true delivery visibility.

Technical details:
- DB fix:
  - remove old signature: `insert_calendar_connection_for_user(uuid,text,text,text,text,text,text,timestamptz)`
- Frontend:
  - `src/components/NotificationSettings.tsx` (test handlers + toast logic)
- Edge function:
  - `supabase/functions/send-unified-notification/index.ts` (normalized result contract)
  - optional: `supabase/functions/notification-callback/index.ts` integration from workflow
- Optional observability:
  - use `delivery_logs` consistently for manual tests too, not only scheduled flow.

Files to modify:
- `supabase/migrations/*` (new migration for function overload cleanup)
- `src/components/NotificationSettings.tsx`
- `supabase/functions/send-unified-notification/index.ts`
- (optional workflow confirmation path) `supabase/functions/notification-callback/index.ts`

Verification after implementation:
1) Reconnect Google calendar from live Settings (should complete without RPC ambiguity error).
2) Run each Test button once and confirm each shows Delivered/Queued/Failed (not generic success).
3) Confirm push test reports delivered count and endpoint count.
4) Confirm Slack/Email result moves from queued to final status when callback arrives.
5) Re-test on Samsung Internet and Chrome to confirm browser-specific behavior is visible in diagnostics.
