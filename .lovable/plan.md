

## Problem: Stale Deployment + Missing Handoff Tracing

The deployed `send-unified-notification` contains a **direct Slack POST path** that does not exist in the current source code. The source correctly routes Slack through `callUnifiedWebhook` (GET to `UNIFIED_WEBHOOK_URL` / n8n), but the deployed version bypasses this with a direct POST to the Slack webhook — which returns 404 because the n8n webhook only accepts GET.

Additionally, there is no structured tracing between `notification-delivery` → `send-unified-notification` → n8n, making it hard to diagnose handoff failures.

## Plan

### A. Redeploy `send-unified-notification` (fixes Slack delivery)

Simply redeploying syncs the deployed code with the source, which already routes Slack through n8n via GET. No code changes needed for this fix.

### B. Add handoff tracing to `send-unified-notification/index.ts`

Add 4 `activity_log` trace points with a `correlation_id` (using `notificationId` or generated UUID):

1. **Entry trace** (~line 396, after parsing request): Log channels requested, userId, notificationId
2. **Pre-webhook trace** (~line 772, before `fetch`): Log the webhook URL prefix and channels being sent
3. **Post-webhook trace** (~line 806, after response parsing): Log n8n response status, per-channel results
4. **Slack-specific trace**: Log whether Slack was included in the n8n GET call and what the response was

Each trace uses `session_id = correlation_id` so you can query the full chain:
```sql
SELECT * FROM activity_log WHERE session_id = '<notificationId>' ORDER BY created_at;
```

### C. Add handoff tracing to `notification-delivery/index.ts`

Add 2 trace points around the `supabase.functions.invoke('send-unified-notification')` calls (~lines 209 and 598):

1. **Pre-handoff** (~before invoke): Log channels, notificationIds, userId, correlation_id
2. **Post-handoff** (~after invoke): Log success/failure, error message if any, response summary

### D. Redeploy both functions

Deploy `send-unified-notification` and `notification-delivery` together to activate the tracing.

### Files Modified
- `supabase/functions/send-unified-notification/index.ts` — add 4 activity_log trace points
- `supabase/functions/notification-delivery/index.ts` — add 2 activity_log trace points around handoffs
- Both redeployed

### Technical Details

The tracing pattern uses fire-and-forget inserts (`.then().catch()`) to avoid blocking notification delivery. Each trace row includes:
- `activity_type`: e.g. `notification_handoff_start`, `notification_webhook_sent`, `notification_webhook_response`
- `session_id`: the notificationId (correlation key)
- `status`: `started` / `completed` / `error`
- `stage`: which step in the pipeline
- `metadata`: channels, webhook URL prefix, response status, error details

