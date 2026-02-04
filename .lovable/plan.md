
# Fix Push Notification Subscription Error Display

## Problem Analysis

Based on the screenshot and backend logs, the issue is:

1. **Backend is working correctly**: The `manage-push-subscription` logs show "Push subscription stored successfully"
2. **Error banner is stale**: The red "Subscription failed" banner at the top is from a PREVIOUS failed attempt (before VAPID keys were fixed)
3. **UI state is inconsistent**: Shows both "Subscription failed" error AND "Enabled and subscribed" status

The actual push subscription is now working with the new VAPID keys, but the error banner from a previous attempt persists.

---

## Root Causes

### Issue 1: Error State Not Cleared on Success
In `useNotifications.tsx`, when `subscribe()` succeeds, it doesn't clear any previously displayed error. The toast error persists visually until manually dismissed.

### Issue 2: Stale Browser Subscription
Samsung Internet may have cached the old subscription with the invalid VAPID public key. The browser's PushManager throws an error when trying to create a new subscription with a DIFFERENT applicationServerKey.

### Issue 3: No Forced Unsubscribe Before Re-Subscribe
When VAPID keys change, the existing subscription must be unsubscribed first before creating a new one with the new key.

---

## Solution

### Step 1: Force Unsubscribe Before Subscribe with New Key

Update `useNotifications.tsx` to detect key mismatches and force unsubscribe:

```typescript
const subscribe = async (): Promise<boolean> => {
  if (!isSupported || permission !== 'granted' || !user) {
    return false;
  }

  setIsLoading(true);
  try {
    const registration = await navigator.serviceWorker.ready;
    const vapidPublicKey = await getVapidPublicKey();
    
    // Check for existing subscription with potentially different key
    const existingSubscription = await registration.pushManager.getSubscription();
    
    if (existingSubscription) {
      // Unsubscribe from old subscription before creating new one
      // This handles VAPID key changes gracefully
      console.log('[useNotifications] Removing existing subscription before re-subscribing');
      try {
        await existingSubscription.unsubscribe();
        await removeSubscriptionFromBackend();
      } catch (unsubError) {
        console.warn('[useNotifications] Could not unsubscribe old subscription:', unsubError);
      }
    }
    
    // Now create new subscription with current VAPID key
    const pushSubscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer
    });

    setSubscription(pushSubscription);
    
    const success = await syncSubscriptionWithBackend(pushSubscription);
    
    if (success) {
      toast({
        title: "Subscribed to notifications",
        description: "You'll receive task reminders and updates",
      });
      return true;
    } else {
      throw new Error('Failed to sync subscription with backend');
    }
  } catch (error) {
    // ... existing error handling
  }
};
```

### Step 2: Improve Error Handling Display

The error toast/banner should be scoped and not persist across retries. This is likely working correctly (toasts auto-dismiss), but the screenshot shows a persistent error card that might be a separate UI element.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/hooks/useNotifications.tsx` | Add forced unsubscribe before re-subscribe to handle VAPID key changes |

---

## Immediate Workaround (For User)

Since the backend shows subscriptions are working:

1. **Clear browser data for the site** (or just Service Worker data)
2. **Toggle push notifications OFF** in settings
3. **Toggle push notifications ON** again

This forces a fresh subscription with the new VAPID key.

---

## Technical Details

The core issue is that the Web Push API's `PushManager.subscribe()` throws an error if you try to subscribe with a different `applicationServerKey` than the existing subscription. The fix ensures we always unsubscribe first when keys might have changed.
