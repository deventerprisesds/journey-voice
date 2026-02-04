

# Smart Message Catch-up (Slack/SMS Model)

## Current Problem

When you receive a push notification and open the app, the message doesn't appear until you refresh. The naive fix (reload on every visibility change) wastes network requests and feels janky.

## The Slack/SMS Model

Slack appears to have messages "already there" because:

1. **Push payload carries the message data** - The push notification contains the message content, ID, and thread ID
2. **Service worker receives push and posts to app** - Even if the app is suspended, the SW can wake it briefly or store the message
3. **App listens for SW messages and updates state** - The message appears instantly without a network fetch
4. **On visibility change, only fetch if needed** - Quick check: "Is there anything newer than my last message?" - if yes, fetch; if no, skip

## Implementation Plan

### Phase 1: Include full message in push payload

**File: `supabase/functions/send-push-notification/index.ts`**

Modify the push payload to include the full message data:

```typescript
const payload = JSON.stringify({
  title,
  body,
  data: {
    ...data,
    // Include full message for immediate display
    message: data?.messageData || null
  },
  // ...rest
});
```

**File: `supabase/functions/send-chat-message/index.ts`**

Pass the full message data to the push notification:

```typescript
body: JSON.stringify({
  userId,
  title: 'Iris',
  body: truncateText(content, 100),
  data: {
    type: 'chat_message',
    // NEW: Include full message for immediate display
    messageData: {
      id: storedMessage.id,
      role: 'assistant',
      content,
      source: 'chat',
      assistant_id: effectiveAssistantId,
      created_at: new Date().toISOString(),
      thread_id: dbThreadId
    },
    openCommsConsole: true,
    threadId: dbThreadId,
    messageId: storedMessage.id
  }
})
```

### Phase 2: Service worker posts message to app

**File: `public/sw.js`**

When a push is received, immediately post the message to any open app clients:

```javascript
self.addEventListener('push', (event) => {
  // Parse notification data
  const notificationData = event.data ? event.data.json() : {};
  
  // If this push contains a message, post it to all app clients
  if (notificationData.data?.messageData) {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then((clientList) => {
          for (const client of clientList) {
            client.postMessage({
              type: 'NEW_CHAT_MESSAGE',
              message: notificationData.data.messageData
            });
          }
        })
    );
  }
  
  // Show the notification as usual
  event.waitUntil(
    self.registration.showNotification(notificationData.title, {...})
  );
});
```

### Phase 3: App listens for SW messages and updates state immediately

**File: `src/contexts/CommsConsoleContext.tsx`**

Add a listener for `NEW_CHAT_MESSAGE` from the service worker:

```typescript
useEffect(() => {
  const handleServiceWorkerMessage = (event: MessageEvent) => {
    // Existing NOTIFICATION_CLICKED handler...
    
    // NEW: Handle message pushed from service worker
    if (event.data?.type === 'NEW_CHAT_MESSAGE') {
      const message = event.data.message;
      console.log('[CommsConsole] Message received from SW:', message.id);
      
      // Log receipt
      logChat(userId, 'sw_message_received', 'completed', {
        messageId: message.id,
        threadId: message.thread_id
      });
      
      // Add to messages if not already present and matches current thread
      if (message.thread_id === dbThreadId) {
        setMessages(prev => {
          if (prev.some(m => m.id === message.id)) return prev;
          return [...prev, {
            id: message.id,
            role: message.role,
            content: message.content,
            source: message.source,
            assistant_id: message.assistant_id,
            created_at: message.created_at,
          }];
        });
      }
    }
  };
  
  navigator.serviceWorker?.addEventListener('message', handleServiceWorkerMessage);
  return () => navigator.serviceWorker?.removeEventListener('message', handleServiceWorkerMessage);
}, [userId, dbThreadId]);
```

### Phase 4: Smart visibility reload (only if needed)

**File: `src/contexts/CommsConsoleContext.tsx`**

Add a visibility change handler that only reloads if there are newer messages:

```typescript
// Track the latest message timestamp we've seen
const lastMessageTimestampRef = useRef<string | null>(null);

// Update ref whenever messages change
useEffect(() => {
  if (messages.length > 0) {
    lastMessageTimestampRef.current = messages[messages.length - 1].created_at;
  }
}, [messages]);

// On visibility change, check if there are newer messages
useEffect(() => {
  const handleVisibilityChange = async () => {
    if (document.visibilityState !== 'visible' || !dbThreadId || !userId) return;
    
    logChat(userId, 'visibility_check', 'started', { threadId: dbThreadId });
    
    // Quick query: any messages newer than our last seen?
    const lastSeen = lastMessageTimestampRef.current || new Date(0).toISOString();
    
    const { data, error } = await supabase
      .from('conversation_messages')
      .select('id')
      .eq('thread_id', dbThreadId)
      .eq('user_id', userId)
      .gt('created_at', lastSeen)
      .limit(1);
    
    if (error) {
      logChat(userId, 'visibility_check', 'error', { error: error.message }, error.message);
      return;
    }
    
    if (data && data.length > 0) {
      // There are newer messages, reload history
      logChat(userId, 'visibility_reload', 'started', { 
        threadId: dbThreadId, 
        lastSeen,
        newMessageCount: data.length 
      });
      setHistoryLoaded(false);
    } else {
      // No new messages, skip reload
      logChat(userId, 'visibility_check', 'completed', { 
        result: 'no_new_messages',
        lastSeen 
      });
    }
  };
  
  document.addEventListener('visibilitychange', handleVisibilityChange);
  return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
}, [dbThreadId, userId]);
```

## Expected Behavior After Implementation

1. **Push notification arrives while app is open but backgrounded:**
   - Service worker receives push
   - SW posts `NEW_CHAT_MESSAGE` to app
   - App (still running) adds message to state immediately
   - When you foreground: message is already there

2. **Push notification arrives while app is closed:**
   - Service worker receives push, shows notification
   - You tap notification to open app
   - `?openComms=true` URL param triggers `setHistoryLoaded(false)`
   - History reload fetches the new message

3. **App foregrounded without tapping notification:**
   - Visibility change fires
   - Quick query checks for messages newer than last seen
   - If new messages exist: reload history
   - If no new messages: do nothing (efficient!)

## Activity Logging Added

| Event | Stage | Description |
|-------|-------|-------------|
| `sw_message_received` | completed | Message received from service worker |
| `visibility_check` | started/completed | Checking for newer messages on foreground |
| `visibility_reload` | started | Reloading because newer messages found |

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/send-chat-message/index.ts` | Include full message data in push payload |
| `supabase/functions/send-push-notification/index.ts` | Pass through message data |
| `public/sw.js` | Post message to app clients on push |
| `src/contexts/CommsConsoleContext.tsx` | Handle SW message, smart visibility reload |

