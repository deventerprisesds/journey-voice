

# Unified Memory + Chat Latency Optimization Plan

## Problem Summary

### Memory Issue
The approved "Chat Memory Fix" only applied to the **Chat** interface. **Voice** and **Phone** modes still create ephemeral, session-based threads on every connection - they don't participate in the unified thread system.

**Current State:**

| Mode | Uses `useUnifiedThread`? | Reuses Same Thread? | Memory Persists? |
|------|-------------------------|---------------------|------------------|
| Chat | Yes | Yes | Yes |
| Voice (WebRTC) | No | No - creates new `ai_threads` row each session | No |
| Phone (Twilio) | No | No - creates per-call thread | No |

**Root Cause in Voice (Lines 480-490 of `RealtimeVoiceAssistant.ts`):**
```typescript
const { data: thread } = await supabase
  .from('ai_threads')
  .insert({  // <-- INSERTS new thread every connect()
    user_id: this.userId,
    assistant_id: assistantId,
    openai_thread_id: `webrtc_${this.sessionId}`,  // <-- Ephemeral ID
    mode: 'voice'
  })
```

### Latency Issue
Chat responses take 20-40 seconds while the OpenAI Playground feels instant. Root causes:
1. **Polling instead of streaming** (1-second intervals)
2. **Sequential pre-processing** (prefs, RAG, agenda, tools loaded one after another)
3. **Tool execution overhead** (hop through execute-tool edge function)

---

## Implementation Plan

### Phase 1: Unified Threads for Voice Mode (Frontend)

**Goal:** Make Voice use the same thread as Chat, so the assistant remembers conversations across modes.

#### 1.1 Pass Unified Thread to RealtimeVoiceAssistant

**File:** `src/contexts/VoiceAssistantContext.tsx`

Changes:
- Accept `unifiedDbThreadId` and `unifiedAssistantId` as props or from context
- Pass these to `RealtimeVoiceAssistant.connect()` method

**File:** `src/utils/RealtimeVoiceAssistant.ts`

Changes:
- Add optional `unifiedThreadId?: string` parameter to `connect()` method
- Instead of always inserting a new `ai_threads` row:
  - If `unifiedThreadId` is provided: use it (skip insert)
  - If not provided (standalone voice): fall back to current behavior (insert new row)
- Store the thread ID for message persistence
- Update `storeConversation()` calls to use the unified thread ID

```typescript
// Before (line 480-490)
const { data: thread } = await supabase
  .from('ai_threads')
  .insert({...})

// After
if (unifiedThreadId) {
  this.threadId = unifiedThreadId;
  console.log('[VOICE] Using unified thread:', unifiedThreadId);
} else {
  // Fallback: create session-specific thread (standalone voice mode)
  const { data: thread } = await supabase
    .from('ai_threads')
    .insert({...})
  this.threadId = thread?.id || null;
}
```

#### 1.2 Wire CommsConsoleContext to Pass Thread to Voice

**File:** `src/contexts/CommsConsoleContext.tsx`

Changes:
- When calling `voiceAssistant.connectToAssistant()`, pass `dbThreadId` from `useUnifiedThread`
- The voice assistant will then use the same thread as chat

**File:** `src/contexts/VoiceAssistantContext.tsx`

Changes:
- Update `connectToAssistant()` signature to accept optional `threadId`
- Forward to `RealtimeVoiceAssistant.connect()`

---

### Phase 2: Unified Threads for Phone Mode (Backend)

**Goal:** Make Phone calls use a unified thread so Iris remembers across phone sessions.

#### 2.1 Update twilio-realtime-bridge Thread Lookup

**File:** `supabase/functions/twilio-realtime-bridge/index.ts`

Changes:
- Before creating a new thread, check if a unified thread exists for this user + assistant:
```typescript
// Look for existing unified thread
const { data: existingThread } = await supabase
  .from('ai_threads')
  .select('id, openai_thread_id')
  .eq('user_id', userId)
  .eq('assistant_id', assistantId)
  .eq('mode', 'unified')  // or any mode, as long as same assistant
  .order('updated_at', { ascending: false })
  .limit(1)
  .maybeSingle();

if (existingThread) {
  threadId = existingThread.id;
} else {
  // Create new unified thread (will be reused across modes)
  // ... existing insert logic
}
```

#### 2.2 Load Conversation History for RAG

Both Voice and Phone should load conversation history from the unified thread to provide memory context:
- The existing `loadRAGContext()` function already does this if given the correct `threadId`
- Ensure the unified thread ID is passed to RAG context retrieval

---

### Phase 3: Chat Latency - Quick Wins

**Goal:** Reduce actual latency by 2-5 seconds with minimal risk.

#### 3.1 Parallelize Pre-Processing

**File:** `supabase/functions/hybrid-assistant-api/index.ts`

Change the sequential loading:
```typescript
// Before (sequential - each waits for previous)
const { data: prefs } = await supabase.from('user_scheduling_prefs')...
const ragResponse = await fetch('.../rag-context-retrieval'...
const agendaResponse = await fetch('.../agenda-manager'...
const toolsResponse = await fetch('.../execute-tool/definitions'...
```

To parallel loading:
```typescript
// After (parallel - all start at once)
const [prefsResult, ragResult, agendaResult, toolsResult] = await Promise.all([
  supabase.from('user_scheduling_prefs').select('*').eq('user_id', userId).maybeSingle(),
  fetch(`${supabaseUrl}/functions/v1/rag-context-retrieval`, {...}),
  fetch(`${supabaseUrl}/functions/v1/agenda-manager`, {...}),
  fetch(`${supabaseUrl}/functions/v1/execute-tool/definitions`, {...})
]);
```

**Estimated savings:** 1-2 seconds

#### 3.2 Reduce Polling Interval

**File:** `supabase/functions/hybrid-assistant-api/index.ts` (line 441)

```typescript
// Before
await new Promise(resolve => setTimeout(resolve, 1000));

// After
await new Promise(resolve => setTimeout(resolve, 500));
```

**Estimated savings:** 0-3 seconds depending on run length

#### 3.3 Cache Tool Definitions (Optional)

Tool definitions rarely change. Cache at module level:
```typescript
let cachedTools: any[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60000; // 1 minute

async function getToolDefinitions() {
  if (cachedTools && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedTools;
  }
  // ... fetch and cache
}
```

**Estimated savings:** 200-400ms per request

---

### Phase 4: Chat Latency - Streaming (Medium Effort)

**Goal:** Make responses feel instant by showing text as it generates.

#### 4.1 Backend: Implement OpenAI Assistants Streaming

**File:** `supabase/functions/hybrid-assistant-api/index.ts`

Replace polling with streaming:
```typescript
// Use OpenAI streaming API
const stream = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${openaiApiKey}`,
    'OpenAI-Beta': 'assistants=v2',
    'Accept': 'text/event-stream'  // Enable streaming
  },
  body: JSON.stringify({
    assistant_id: assistantId,
    stream: true  // Enable streaming
  })
});

// Return SSE stream to client
return new Response(stream.body, {
  headers: {
    ...corsHeaders,
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  }
});
```

#### 4.2 Frontend: Handle Streaming Responses

**File:** `src/contexts/CommsConsoleContext.tsx`

Update `sendMessage` to handle streaming:
```typescript
const response = await fetch(`${SUPABASE_URL}/functions/v1/hybrid-assistant-api`, {
  method: 'POST',
  body: JSON.stringify({...}),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();
let assistantContent = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const chunk = decoder.decode(value);
  // Parse SSE events and extract content deltas
  // Update assistant message incrementally
  assistantContent += delta;
  setMessages(prev => {
    const updated = [...prev];
    updated[updated.length - 1].content = assistantContent;
    return updated;
  });
}
```

**Estimated improvement:** Perceived latency drops from 30s to 3-5s

---

### Phase 5: Smart Routing (Future Optimization)

**Goal:** Use faster APIs for simple queries.

- Simple greetings ("hello", "thanks") → Skip RAG, use Chat Completions API directly
- Complex queries with tools → Use Assistants API (current behavior)

This is lower priority and can be implemented after Phases 1-4.

---

## Implementation Order

| Phase | Scope | Effort | Impact |
|-------|-------|--------|--------|
| **1** | Voice unified threads | 2-3 hours | Enables voice memory |
| **2** | Phone unified threads | 1-2 hours | Enables phone memory |
| **3** | Chat quick wins | 1 hour | -2-5s actual latency |
| **4** | Chat streaming | 3-4 hours | -15-25s perceived latency |
| **5** | Smart routing | 2-3 hours | -2-10s for simple queries |

**Recommended approach:** Implement Phases 1-3 together for immediate impact, then Phase 4 for dramatic perceived improvement.

---

## Verification Checklist

### After Phase 1 (Voice)
- [ ] Voice session uses existing thread from `useUnifiedThread`
- [ ] Voice transcripts are stored with correct `thread_id` and `assistant_id`
- [ ] After voice session, switching to chat mode remembers voice conversation

### After Phase 2 (Phone)
- [ ] Phone call uses existing unified thread
- [ ] After phone call, chat mode remembers phone conversation

### After Phase 3 (Quick Wins)
- [ ] Chat response time reduced by 2-5 seconds
- [ ] Edge function logs show parallel loading

### After Phase 4 (Streaming)
- [ ] Chat shows text appearing word-by-word
- [ ] First token appears within 2-3 seconds
- [ ] Tool calls show "Searching..." indicator immediately

---

## Files to Modify

**Frontend:**
- `src/contexts/CommsConsoleContext.tsx` - Wire thread to voice, add streaming support
- `src/contexts/VoiceAssistantContext.tsx` - Accept thread ID parameter
- `src/utils/RealtimeVoiceAssistant.ts` - Use unified thread instead of creating new

**Backend:**
- `supabase/functions/hybrid-assistant-api/index.ts` - Parallelize, reduce polling, add streaming
- `supabase/functions/twilio-realtime-bridge/index.ts` - Use unified thread lookup

