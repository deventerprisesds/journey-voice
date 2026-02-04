

# Test-First Implementation: System-Initiated Chat Messages

## What We Just Proved

1. **`hybrid-assistant-api` works** - It can process messages with contextual instructions (like "Midday Check-in" context)
2. **Push notifications work** - You received the notification on your device
3. **Same OpenAI thread is used** - The response used thread `thread_BNkJV5VJSFDV3oVOYIjeCjHU` which is your active Iris thread

## What's Missing

The message from Iris wasn't stored in `conversation_messages`, so:
- You won't see it when you open the chat
- There's no conversation thread to continue

## Implementation Plan

### Step 1: Create Edge Function for System-Initiated Messages

**New File**: `supabase/functions/send-chat-message/index.ts`

This function will:
1. Get or create the user's active chat thread
2. Store the system-initiated message in `conversation_messages` as role `assistant`
3. Optionally call `hybrid-assistant-api` to generate a contextual greeting
4. Send a push notification with deep-link data

```typescript
interface ChatMessageRequest {
  userId: string;
  message?: string;              // Direct message OR...
  generateFromContext?: {        // ...AI-generated message
    callType: 'morning_standup' | 'midday_checkin' | 'eod_wrapup' | 'custom';
    context?: string;
  };
  sendPush?: boolean;            // Whether to send push notification
}
```

### Step 2: Update twilio-scheduled-call to Support Chat Mode

Modify the existing function to:
- Check `call.commsMode` field
- If `commsMode === 'app_message'`, call `send-chat-message` instead of `twilio-voice-handler`

### Step 3: Update Service Worker for Deep Linking

**File**: `public/sw.js`

- Navigate to `/tasks?view=focus&openComms=true` on notification click
- Post `NOTIFICATION_CLICKED` message to the app

### Step 4: Update CommsConsoleContext for Notification Handling

**File**: `src/contexts/CommsConsoleContext.tsx`

- Listen for `NOTIFICATION_CLICKED` messages
- Listen for `openComms=true` URL parameter
- Auto-open panel and reload messages when triggered

### Step 5: Add CommsMode to UI

**File**: `src/components/VoiceAssistantSettings.tsx`

- Add "Delivery Method" dropdown to each scheduled call
- Options: Phone Call, In-App Chat, Slack, Email

---

## Files to Create/Modify

| File | Type | Changes |
|------|------|---------|
| `supabase/functions/send-chat-message/index.ts` | NEW | System-initiated chat message + push |
| `supabase/functions/twilio-scheduled-call/index.ts` | MODIFY | Add commsMode branching |
| `public/sw.js` | MODIFY | Deep link handling for openComms |
| `src/contexts/CommsConsoleContext.tsx` | MODIFY | Handle notification clicks + URL params |
| `src/services/schedulingService.ts` | MODIFY | Add CommsMode type |
| `src/components/VoiceAssistantSettings.tsx` | MODIFY | Add delivery method dropdown |

---

## Testing Flow After Implementation

1. Set "Midday Check-in" to "In-App Chat" mode
2. Wait for scheduled time (or manually trigger)
3. Push notification appears: "Iris: Hello! How is your day going?"
4. Tap notification → app opens to Comms Console
5. Iris's message appears in chat history
6. You can reply and continue the conversation

---

## Technical Details

### send-chat-message Edge Function

```typescript
// 1. Get user's active thread
const { data: thread } = await supabase
  .from('ai_threads')
  .select('id, openai_thread_id')
  .eq('user_id', userId)
  .eq('assistant_id', defaultAssistantId)
  .order('updated_at', { ascending: false })
  .limit(1)
  .single();

// 2. Generate message via hybrid-assistant-api (if needed)
let content = message;
if (!content && generateFromContext) {
  const response = await fetch(`${supabaseUrl}/functions/v1/hybrid-assistant-api`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${supabaseServiceKey}` },
    body: JSON.stringify({
      userInput: buildSystemPrompt(generateFromContext),
      userId,
      threadId: thread.id,
      contextualInstructions: buildCallContext(generateFromContext),
      systemInitiated: true
    })
  });
  content = (await response.json()).response;
}

// 3. Store in conversation_messages
await supabase.from('conversation_messages').insert({
  thread_id: thread.id,
  user_id: userId,
  role: 'assistant',
  content,
  source: 'chat',
  metadata: { system_initiated: true, trigger: generateFromContext?.callType }
});

// 4. Send push notification
if (sendPush) {
  await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${supabaseServiceKey}` },
    body: JSON.stringify({
      userId,
      title: 'Iris',
      body: truncate(content, 100),
      data: { type: 'chat_message', openCommsConsole: true }
    })
  });
}
```

### Service Worker Update

```javascript
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const data = event.notification.data || {};
  let url = '/tasks?view=focus';
  
  if (data.openCommsConsole) {
    url = '/tasks?view=focus&openComms=true';
  }
  
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({ type: 'NOTIFICATION_CLICKED', data });
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
```

### CommsConsoleContext Update

```typescript
// Listen for service worker messages
useEffect(() => {
  const handler = (event: MessageEvent) => {
    if (event.data?.type === 'NOTIFICATION_CLICKED' && event.data.data?.openCommsConsole) {
      setIsPanelOpen(true);
      setCurrentMode('chat');
      setHistoryLoaded(false); // Trigger message reload
    }
  };
  navigator.serviceWorker?.addEventListener('message', handler);
  return () => navigator.serviceWorker?.removeEventListener('message', handler);
}, []);

// Check URL params on mount
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('openComms') === 'true') {
    setIsPanelOpen(true);
    setCurrentMode('chat');
    window.history.replaceState({}, '', window.location.pathname);
  }
}, []);
```

