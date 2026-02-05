
# Fix: Restore Push Notification messageData for Instant Chat Display

## Root Cause Confirmed

The "Smart Message Catch-up (Slack/SMS Model)" implementation is correctly written in three of the four files, but **one file has an incomplete TypeScript interface** that silently strips the critical `messageData` property.

### The Bug

In `supabase/functions/send-push-notification/index.ts`, the `NotificationRequest` interface (lines 14-19) is too restrictive:

```typescript
interface NotificationRequest {
  userId: string;
  title: string;
  body: string;
  data?: {
    type: string;
    taskId?: string;
    notificationId?: string;
    // MISSING: messageData, threadId, callType, openCommsConsole, messageId
  };
}
```

When the request is destructured at line 33:
```typescript
const { userId, title, body, data }: NotificationRequest = await req.json();
```

TypeScript only preserves properties defined in the interface. The `messageData` object sent by `send-chat-message` is silently discarded, causing the payload at line 110 to always be `null`:
```typescript
messageData: data?.messageData || null,  // Always null because interface doesn't include messageData
```

### Why the Service Worker Never Posts Messages

1. `send-chat-message` correctly sends `messageData` in the request body
2. `send-push-notification` **strips `messageData`** due to restrictive interface
3. Push payload arrives at Service Worker with `data.messageData = null`
4. Service Worker checks `if (messageData)` at line 145 and skips posting
5. App never receives `NEW_CHAT_MESSAGE` event
6. Message only appears after manual refresh (realtime subscription or visibility reload)

---

## The Fix

Update the `NotificationRequest` interface to include all properties that `send-chat-message` sends:

**File: `supabase/functions/send-push-notification/index.ts`**

```typescript
interface NotificationRequest {
  userId: string;
  title: string;
  body: string;
  data?: {
    type: string;
    taskId?: string;
    notificationId?: string;
    messageId?: string;           // For chat messages
    threadId?: string;            // For threading context
    callType?: string;            // Call type identifier
    openCommsConsole?: boolean;   // Whether to open chat panel
    batchSize?: number;           // For batched notifications
    notificationIds?: string[];   // For batched notifications
    messageData?: {               // Full message for Slack/SMS instant display
      id: string;
      role: string;
      content: string;
      source: string;
      assistant_id?: string;
      created_at: string;
      thread_id: string;
    };
  };
}
```

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/send-push-notification/index.ts` | Update `NotificationRequest` interface to include `messageData` and related fields |

---

## Expected Behavior After Fix

1. User's recurring call triggers at scheduled time
2. `notification-delivery` calls `send-chat-message` with `commsMode: 'app_message'`
3. `send-chat-message` stores message and calls `send-push-notification` with full `messageData`
4. `send-push-notification` **preserves `messageData`** in push payload (previously stripped)
5. Service Worker receives push and posts `NEW_CHAT_MESSAGE` to all app clients
6. App's `CommsConsoleContext` receives SW message and adds to state **instantly**
7. User sees the message without needing to refresh

---

## Verification Steps

After deployment:
1. Set a recurring call with "App Chat" delivery for 1-2 minutes from now
2. Check edge function logs for `send-push-notification` to see payload includes `messageData`
3. Check browser console for `[SW] Posting NEW_CHAT_MESSAGE to X clients`
4. Confirm message appears in chat **immediately** without refresh

---

## Why This Happened

This is a **partial implementation bug**. The plan for "Smart Message Catch-up" correctly specified updating the interface, but only the implementation code was added (line 110) without the corresponding interface update (lines 14-19). TypeScript silently discards properties not in the interface during destructuring, causing the feature to fail silently.
