

# Plan: Unify Conversation Message Persistence Across All Modes

## Problem Summary

Currently, the three communication modes save messages inconsistently:

| Mode | Source | Saves to `conversation_messages`? | Includes `source` field? |
|------|--------|----------------------------------|-------------------------|
| **Phone** | `twilio-realtime-bridge` | Yes | Yes (`'phone'`) |
| **Voice (WebRTC)** | `RealtimeVoiceAssistant.saveTranscript()` | Yes, via `generate-embeddings` | Yes (`'voice'`) |
| **Chat (CommsConsole)** | `CommsConsoleContext.sendMessage()` | **NO - local state only** | N/A |
| **Chat (useChatAssistant)** | `useChatAssistant.sendMessage()` | Yes, but missing `source` | **NO** |

This means **chat messages from CommsConsole are never persisted to the database**, making unified monitoring impossible.

---

## Root Cause

`CommsConsoleContext.sendMessage()` (lines 263-346) creates messages only in React local state and calls `hybrid-assistant-api`, but **never inserts into `conversation_messages`**.

Meanwhile, `useChatAssistant.ts` (which DOES persist) is **not used** by the CommsConsole component.

---

## Solution: Add Chat Persistence to CommsConsoleContext

### File to Modify

**`src/contexts/CommsConsoleContext.tsx`**

### Changes

1. **After receiving the assistant response** (around line 318-320), add a call to `generate-embeddings` to persist both user and assistant messages to `conversation_messages`.

2. **Include required fields**:
   - `source: 'chat'`
   - `assistant_id: currentAssistant?.id`
   - `thread_id: dbThreadId`
   - `voice_session_id: null` (not applicable for chat)

### Implementation

Modify the `sendMessage` function to persist messages via the existing `generate-embeddings` edge function (same approach used by Voice mode):

```typescript
// After line 308 (successful response from hybrid-assistant-api):

// Persist user message to conversation_messages
await supabase.functions.invoke('generate-embeddings', {
  body: {
    action: 'store_conversation',
    userId,
    threadId: effectiveThreadId,
    assistantId: currentAssistant?.id,
    source: 'chat',
    role: 'user',
    content: content,
    messageType: 'user',
    metadata: { mode: 'comms_console' }
  }
});

// Persist assistant message to conversation_messages
await supabase.functions.invoke('generate-embeddings', {
  body: {
    action: 'store_conversation',
    userId,
    threadId: effectiveThreadId,
    assistantId: currentAssistant?.id,
    source: 'chat',
    role: 'assistant',
    content: data?.response,
    messageType: 'assistant',
    metadata: { mode: 'comms_console' }
  }
});
```

---

## Result After Fix

| Mode | Saves to DB? | `source` | `assistant_id` | `thread_id` |
|------|-------------|----------|----------------|-------------|
| Phone | Yes | `'phone'` | Yes | Yes |
| Voice | Yes | `'voice'` | Yes | Yes |
| Chat | **Yes** | `'chat'` | Yes | Yes |

All three modes will now save to `conversation_messages` with consistent fields, enabling:
- Unified monitoring across all modes without user filtering
- Cross-mode RAG context retrieval
- Single debugging timeline

---

## Bonus Fix: useChatAssistant.ts

Also update `src/hooks/useChatAssistant.ts` lines 157-162 and 178-183 to include `source: 'chat'` in the inserts for any code paths that still use this hook directly (e.g., standalone chat pages).

---

## Technical Notes

- Uses existing `generate-embeddings` function for consistency with Voice mode
- Both message persistence calls can be fire-and-forget (don't block UI)
- Error handling already exists in `generate-embeddings` with logging
- This approach matches the "shared systems, not duplicated code" architecture memory

