

# Complete Chat-First Notification System

## Overview

This plan addresses the full Slack/SMS-like experience where:
1. **If active in app**: Messages appear instantly in chat (no push notification)
2. **If away/inactive**: Messages appear in chat AND push notification is sent
3. **Deferred messages**: User can say "send me a chat in 5 minutes" and the AI schedules it via cron

## Current State Analysis

Based on my exploration:

1. **`send-chat-message` edge function** - Stores messages and sends push notifications, but always sends push regardless of user activity
2. **`CommsConsoleContext.tsx`** - Loads chat history but lacks Realtime subscription for new messages
3. **`useUnifiedThread` hook** - Manages thread per user+assistant combination
4. **`execute-tool`** - Has `initiate_phone_call` for delayed callbacks, but no `send_chat_message` tool
5. **No user presence tracking** - System has no visibility into whether user is actively viewing the chat

## Architecture Design

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MESSAGE FLOW DIAGRAM                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   USER ACTIVE IN CHAT?                                                       │
│          │                                                                   │
│    ┌─────┴─────┐                                                             │
│    ▼           ▼                                                             │
│   YES          NO                                                            │
│    │           │                                                             │
│    ▼           ▼                                                             │
│  ┌──────────┐ ┌──────────────┐                                               │
│  │ Realtime │ │ Store + Push │                                               │
│  │ Insert   │ │ Notification │                                               │
│  │ Only     │ │              │                                               │
│  └──────────┘ └──────────────┘                                               │
│    │           │                                                             │
│    ▼           ▼                                                             │
│  Message     User taps push                                                  │
│  appears     → App opens                                                     │
│  instantly   → Realtime shows message                                        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Implementation Plan

### Phase 1: User Presence Tracking

**File: `src/contexts/CommsConsoleContext.tsx`**

Track when the user is actively viewing the Comms Console using:
- Page Visibility API (`document.visibilityState`)
- Panel open state
- Mode (chat vs voice)

Update a presence indicator that gets passed to the backend.

```typescript
// Track if user is actively viewing chat
const [isActiveInChat, setIsActiveInChat] = useState(false);

useEffect(() => {
  const updatePresence = () => {
    const isVisible = document.visibilityState === 'visible';
    const active = isVisible && isPanelOpen && currentMode === 'chat';
    setIsActiveInChat(active);
    
    // Update presence in database (debounced)
    if (userId) {
      updateUserPresence(userId, active);
    }
  };
  
  document.addEventListener('visibilitychange', updatePresence);
  updatePresence();
  
  return () => document.removeEventListener('visibilitychange', updatePresence);
}, [isPanelOpen, currentMode, userId]);
```

### Phase 2: Database Presence Table

**Migration: Add user_presence table**

```sql
CREATE TABLE user_presence (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT false,
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  active_context TEXT DEFAULT 'unknown',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE user_presence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can update own presence"
  ON user_presence FOR ALL
  USING (auth.uid() = user_id);

-- Auto-update updated_at
CREATE TRIGGER update_user_presence_updated_at
  BEFORE UPDATE ON user_presence
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### Phase 3: Realtime Subscription for New Messages

**File: `src/contexts/CommsConsoleContext.tsx`**

Add Supabase Realtime subscription to receive messages instantly:

```typescript
// Subscribe to new messages on this thread
useEffect(() => {
  if (!dbThreadId || !userId) return;
  
  console.log('[CommsConsole] Setting up realtime subscription for thread:', dbThreadId);
  
  const channel = supabase
    .channel(`chat-messages-${dbThreadId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'conversation_messages',
        filter: `thread_id=eq.${dbThreadId}`,
      },
      (payload) => {
        const newMessage = payload.new as any;
        console.log('[CommsConsole] Realtime message received:', newMessage.id);
        
        // Deduplicate - skip if already in state
        setMessages(prev => {
          if (prev.some(m => m.id === newMessage.id)) return prev;
          
          return [...prev, {
            id: newMessage.id,
            role: newMessage.role,
            content: newMessage.content,
            source: newMessage.source || 'chat',
            assistant_id: newMessage.assistant_id,
            created_at: newMessage.created_at,
          }];
        });
      }
    )
    .subscribe();
  
  return () => {
    console.log('[CommsConsole] Cleaning up realtime subscription');
    supabase.removeChannel(channel);
  };
}, [dbThreadId, userId]);
```

### Phase 4: Conditional Push Notifications

**File: `supabase/functions/send-chat-message/index.ts`**

Before sending push notification, check if user is actively viewing chat:

```typescript
// Check user presence before sending push
let shouldSendPush = sendPush;

if (sendPush) {
  const { data: presence } = await supabase
    .from('user_presence')
    .select('is_active, active_context')
    .eq('user_id', userId)
    .maybeSingle();
  
  // Skip push if user is active in chat
  if (presence?.is_active && presence?.active_context === 'chat') {
    console.log('[SEND-CHAT-MESSAGE] User active in chat, skipping push notification');
    shouldSendPush = false;
  }
}

// Only send push if user is inactive
if (shouldSendPush) {
  await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, { ... });
}
```

### Phase 5: Add "Send Chat Message" Tool

**File: `supabase/functions/execute-tool/index.ts`**

Add a new tool so the AI can schedule chat messages:

```typescript
{
  type: "function",
  name: "send_chat_message",
  description: "Send a chat message to the user. Use for 'remind me in X minutes', 'send me a message at 3pm', or 'check in with me later'.",
  parameters: {
    type: "object",
    properties: {
      delay_minutes: { 
        type: "number", 
        description: "Minutes to wait before sending (e.g., 'in 5 minutes' = 5)" 
      },
      scheduled_time: { 
        type: "string", 
        description: "Specific time to send in HH:MM format (e.g., '15:00' for 3pm)" 
      },
      message: { 
        type: "string", 
        description: "The message content to send" 
      },
      context: { 
        type: "string", 
        description: "Context for AI to generate a message if no specific message provided" 
      }
    }
  }
}
```

**Implementation:**

```typescript
async function sendScheduledChatMessage(supabase: any, userId: string, args: any): Promise<ExecuteToolResponse> {
  const delayMinutes = args.delay_minutes || 0;
  const scheduledTime = args.scheduled_time;
  const message = args.message;
  const context = args.context || 'scheduled check-in';
  
  // Calculate when to send
  let sendAt: Date;
  if (scheduledTime) {
    // Parse HH:MM and set for today/tomorrow
    const [hours, minutes] = scheduledTime.split(':').map(Number);
    sendAt = new Date();
    sendAt.setHours(hours, minutes, 0, 0);
    if (sendAt < new Date()) sendAt.setDate(sendAt.getDate() + 1); // Tomorrow if past
  } else {
    sendAt = new Date(Date.now() + delayMinutes * 60 * 1000);
  }
  
  if (delayMinutes === 0 && !scheduledTime) {
    // Send immediately
    const response = await supabase.functions.invoke('send-chat-message', {
      body: {
        userId,
        message,
        generateFromContext: message ? undefined : { callType: 'custom', context },
        sendPush: true,
        assistantId: args.assistantId
      }
    });
    
    if (response.error) throw response.error;
    return { success: true, message: 'Message sent!' };
  }
  
  // Schedule for later via scheduled_notifications
  const { error } = await supabase.from('scheduled_notifications').insert({
    user_id: userId,
    notification_type: 'scheduled_chat',
    scheduled_for: sendAt.toISOString(),
    title: 'Iris',
    body: message || `Scheduled check-in: ${context}`,
    metadata: {
      type: 'chat_message',
      message,
      context,
      assistantId: args.assistantId
    }
  });
  
  if (error) throw error;
  
  const timeDescription = scheduledTime 
    ? `at ${scheduledTime}`
    : `in ${delayMinutes} minutes`;
  
  return { 
    success: true, 
    message: `I'll send you a message ${timeDescription}.` 
  };
}
```

### Phase 6: Handle Scheduled Chat Notifications

**File: `supabase/functions/notification-delivery/index.ts`**

Add handling for `scheduled_chat` notification type:

```typescript
case 'scheduled_chat':
  // Trigger send-chat-message function
  const chatResponse = await supabase.functions.invoke('send-chat-message', {
    body: {
      userId: notification.user_id,
      message: notification.metadata?.message,
      generateFromContext: notification.metadata?.message 
        ? undefined 
        : { callType: 'custom', context: notification.metadata?.context },
      sendPush: true,
      assistantId: notification.metadata?.assistantId
    }
  });
  
  if (chatResponse.error) throw chatResponse.error;
  break;
```

### Phase 7: Ensure Correct assistant_id in All Flows

**File: `supabase/functions/send-chat-message/index.ts`**

Update to always resolve a valid assistant_id:

```typescript
// Get user's default assistant if none provided
let effectiveAssistantId = assistantId;

if (!effectiveAssistantId) {
  const { data: defaultAssistant } = await supabase
    .from('assistants')
    .select('id')
    .eq('user_id', userId)
    .eq('is_default', true)
    .maybeSingle();
  
  effectiveAssistantId = defaultAssistant?.id || null;
  console.log('[SEND-CHAT-MESSAGE] Using default assistant:', effectiveAssistantId);
}

// Thread lookup should match by assistant for consistency
const { data: existingThread } = await supabase
  .from('ai_threads')
  .select('id, openai_thread_id')
  .eq('user_id', userId)
  .eq('assistant_id', effectiveAssistantId)  // Match the chat's filter
  .order('updated_at', { ascending: false })
  .limit(1)
  .maybeSingle();

// Store message WITH assistant_id
await supabase.from('conversation_messages').insert({
  thread_id: dbThreadId,
  user_id: userId,
  role: 'assistant',
  content,
  source: 'chat',
  assistant_id: effectiveAssistantId,  // Always set
  metadata: { ... }
});
```

### Phase 8: UI - Add Assistant Selection to Recurring Calls

**Files:**
- `src/services/schedulingService.ts` - Add `assistantId` to interface
- `src/components/VoiceAssistantSettings.tsx` - Add assistant dropdown

```typescript
// In ScheduledCall interface
export interface ScheduledCall {
  id: string;
  name: string;
  time: string;
  enabled: boolean;
  callType: 'morning_standup' | 'midday_checkin' | 'eod_wrapup' | 'custom';
  context: string;
  commsMode?: CommsMode;
  assistantId?: string;  // NEW: Which assistant sends the message
}
```

## Files to Create/Modify Summary

| File | Action | Purpose |
|------|--------|---------|
| Migration | CREATE | Add `user_presence` table |
| `src/contexts/CommsConsoleContext.tsx` | MODIFY | Add presence tracking, Realtime subscription |
| `supabase/functions/send-chat-message/index.ts` | MODIFY | Check presence before push, use correct assistant_id |
| `supabase/functions/execute-tool/index.ts` | MODIFY | Add `send_chat_message` tool |
| `supabase/functions/notification-delivery/index.ts` | MODIFY | Handle `scheduled_chat` type |
| `src/services/schedulingService.ts` | MODIFY | Add `assistantId` field |
| `src/components/VoiceAssistantSettings.tsx` | MODIFY | Add assistant dropdown |

## Testing Scenarios

1. **Active in chat**: Open Comms Console, trigger a message - should appear instantly with NO push
2. **Away from app**: Close browser, trigger a message - should receive push notification
3. **Tap notification**: Notification opens app, message should be visible in chat
4. **Delayed message**: Say "remind me in 5 minutes" - message arrives after 5 minutes
5. **Recurring check-in**: Set "Midday Check-in" to "In-App Chat" with Iris - should work correctly

## Expected Behavior After Implementation

```text
USER: "Send me a chat in 5 minutes to check on my progress"

IRIS: "I'll send you a message in 5 minutes to check on your progress."

[5 minutes later...]

IF USER IS ACTIVE IN CHAT:
  → Message appears directly in chat thread
  → No push notification

IF USER IS AWAY:
  → Push notification: "Iris: Hey! How's your progress going?"
  → User taps notification
  → App opens to Comms Console
  → Message visible in chat history
  → User can reply immediately
```

