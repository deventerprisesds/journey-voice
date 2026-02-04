
# Complete Push Notification Fix with Proper Logging

## Summary

This plan fixes the push notification system by:
1. Creating the missing database table
2. Removing broken fallback code from edge functions  
3. Adding activity logging to match project patterns
4. Implementing actual browser push delivery

---

## What Already Exists (No Changes to These)

- `notification-delivery/index.ts` - Orchestrates all notifications (working)
- `send-unified-notification/index.ts` - Handles Slack/Email/Outlook (working)
- Activity logging pattern using `activity_log` table (established)

## What Gets Modified (Existing Files)

### 1. `manage-push-subscription/index.ts` (already exists)
**Changes**: Remove broken fallback + add activity logging

```typescript
// REMOVE this broken fallback code (lines 81-97):
// supabase.auth.updateUser() cannot work with service role

// ADD activity logging:
supabaseClient.from('activity_log').insert({
  user_id: userId,
  activity_type: 'push_subscription_created',
  metadata: { endpoint: subscription.endpoint.substring(0, 50) }
}).then(() => {}).catch(() => {});  // fire-and-forget pattern
```

### 2. `send-push-notification/index.ts` (already exists)
**Current state**: Stub that logs but doesn't deliver (see lines 51-57)
**Changes**: Add actual web-push delivery + activity logging

```typescript
// ADD: Fetch subscriptions from database
const { data: subscriptions } = await supabaseClient
  .from('push_subscriptions')
  .select('*')
  .eq('user_id', userId);

// ADD: Send via web-push library
import webpush from 'npm:web-push';
webpush.setVapidDetails(...);
for (const sub of subscriptions) {
  await webpush.sendNotification(sub, payload);
}

// ADD: Activity logging
supabaseClient.from('activity_log').insert({
  user_id: userId,
  activity_type: 'browser_push_sent',
  metadata: { title, subscriptionCount: subscriptions.length }
}).then(() => {}).catch(() => {});
```

---

## What Gets Created (New)

### 3. Database Migration: `push_subscriptions` table

```sql
CREATE TABLE public.push_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh_key TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

-- RLS for service role access
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access"
  ON public.push_subscriptions FOR ALL
  USING (true) WITH CHECK (true);
```

---

## Activity Logging Integration

After this fix, the debug timeline will show:

| Activity Type | Function | When |
|--------------|----------|------|
| `push_subscription_created` | manage-push-subscription | Toggle ON |
| `push_subscription_removed` | manage-push-subscription | Toggle OFF |
| `browser_push_sent` | send-push-notification | Notification delivered |
| `browser_push_failed` | send-push-notification | Delivery error |

Query for debugging:
```sql
SELECT * FROM activity_log 
WHERE activity_type LIKE 'push_%' OR activity_type LIKE 'browser_push_%'
ORDER BY created_at DESC;
```

---

## Files Changed Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `supabase/functions/manage-push-subscription/index.ts` | MODIFY | Remove broken fallback, add logging |
| `supabase/functions/send-push-notification/index.ts` | MODIFY | Add web-push delivery, add logging |
| Database migration | CREATE | `push_subscriptions` table |

---

## Expected Outcome

1. Toggle push notifications shows single success toast
2. "Send Test Push" delivers actual browser notification
3. All push operations appear in activity_log for debugging
4. Follows same patterns as existing notification functions
