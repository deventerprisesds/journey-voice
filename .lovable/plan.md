
# Fix Push Notification Subscription Failures

## Problem Summary
The push notification toggle and test button fail with "Subscription failed" because the `manage-push-subscription` edge function cannot authenticate the user. The edge function logs show:
```
Authentication error: AuthSessionMissingError: Auth session missing!
```

## Root Cause Analysis
The `manage-push-subscription` edge function attempts to authenticate using `supabase.auth.getUser()` with an anon key client and the Authorization header from the request. However, the auth session isn't being properly reconstructed because the edge function is creating a client that can't access the session.

**Key insight**: Other edge functions in this project (e.g., `send-unified-notification`) use the `SUPABASE_SERVICE_ROLE_KEY` instead of `SUPABASE_ANON_KEY` for server-side operations, and they receive `userId` as a body parameter rather than trying to extract it from an auth session.

## Solution: Align with Existing Pattern

Modify `manage-push-subscription` to use the service role key and accept `userId` as a parameter, matching the pattern used by other notification functions in the project.

---

## Implementation Steps

### Step 1: Update Edge Function to Use Service Role Key
**File**: `supabase/functions/manage-push-subscription/index.ts`

Changes:
- Switch from `SUPABASE_ANON_KEY` to `SUPABASE_SERVICE_ROLE_KEY`
- Accept `userId` as a request body parameter instead of extracting from auth
- Remove the auth-based user extraction that's failing
- Add basic validation for the userId parameter

```typescript
// BEFORE:
const supabaseClient = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  {
    global: {
      headers: { Authorization: req.headers.get('Authorization')! },
    },
  }
);
const { data: { user }, error: userError } = await supabaseClient.auth.getUser();

// AFTER:
const supabaseClient = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);
const { action, subscription, userId }: RequestBody = await req.json();
if (!userId) {
  return new Response(JSON.stringify({ error: 'userId required' }), { status: 400 });
}
```

### Step 2: Update Client to Pass userId
**File**: `src/hooks/useNotifications.tsx`

Changes to `syncSubscriptionWithBackend()`:
```typescript
// BEFORE:
const { error } = await supabase.functions.invoke('manage-push-subscription', {
  body: {
    action: 'subscribe',
    subscription: subscriptionData
  }
});

// AFTER:
const { error } = await supabase.functions.invoke('manage-push-subscription', {
  body: {
    action: 'subscribe',
    subscription: subscriptionData,
    userId: user.id  // Pass the user ID explicitly
  }
});
```

Similar change to `removeSubscriptionFromBackend()`.

### Step 3: Deploy Updated Edge Function
After editing, deploy `manage-push-subscription` to apply changes.

---

## Technical Notes

### Why This Approach?
- **Consistency**: Matches the pattern used by `send-unified-notification`, `notification-delivery`, and other notification functions
- **Reliability**: Service role key always works for server-side operations
- **Simplicity**: Avoids complex auth session forwarding between client and edge function

### Security Consideration
The user ID comes from the authenticated client-side context (`useAuth`), so this is secure as long as:
1. The frontend only passes the authenticated user's own ID
2. The edge function only performs actions scoped to that user

### Files Changed
1. `supabase/functions/manage-push-subscription/index.ts` - Use service role, accept userId
2. `src/hooks/useNotifications.tsx` - Pass userId in function calls

---

## Verification
After implementation:
1. Navigate to Settings → Notifications
2. Toggle "Push Notifications" to enabled
3. Accept browser permission prompt (if shown)
4. Confirm "Enabled and subscribed" status appears
5. Click "Send Test Push" to verify end-to-end delivery
