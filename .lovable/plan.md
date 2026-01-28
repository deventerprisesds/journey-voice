

# Implementation Plan: Remaining Chat Latency Optimizations

## Current Implementation Status

| Optimization | Status | Evidence |
|--------------|--------|----------|
| Unified Chat Persistence | DONE | `CommsConsoleContext.tsx` lines 333-365 - messages persisted via `generate-embeddings` with `source: 'chat'` |
| Parallel Pre-Processing | DONE | `hybrid-assistant-api` lines 191-242 - `Promise.all()` fetches prefs, RAG, agenda, tools simultaneously |
| Reduced Polling Interval | DONE | `hybrid-assistant-api` line 463 - polling at 500ms instead of 1000ms |
| useChatAssistant source field | DONE | `useChatAssistant.ts` lines 158, 180 - includes `source: 'chat'` |
| Tool Definition Caching | NOT DONE | Tools fetched every request via HTTP call |
| SSE Streaming | NOT DONE | Still using polling loop |
| Latency Metrics | NOT DONE | No `response_time_ms`, `time_to_first_token`, or `user_timezone` in metadata |
| Smart Routing | NOT DONE | No bypass for simple queries |

---

## Remaining Optimizations to Implement

### 1. Tool Definition Caching (Quick Win - ~400ms savings)

**Problem:** Each request makes an HTTP call to `execute-tool/definitions` even though tool definitions rarely change.

**Solution:** Cache tool definitions at module scope (persists across requests during the same cold start).

**File:** `supabase/functions/hybrid-assistant-api/index.ts`

**Changes:**
```typescript
// Add at module scope (top of file, after imports)
let cachedToolDefinitions: any[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// In handleAssistantRequest, replace the tool fetch in Promise.all with:
async function getToolDefinitions(): Promise<any[]> {
  const now = Date.now();
  if (cachedToolDefinitions && (now - cacheTimestamp) < CACHE_TTL_MS) {
    console.log('[HYBRID] Using cached tool definitions');
    return cachedToolDefinitions;
  }
  
  // Fetch fresh definitions
  const response = await fetch(`${supabaseUrl}/functions/v1/execute-tool/definitions`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (response.ok) {
    const data = await response.json();
    cachedToolDefinitions = (data.tools || [])
      .filter((t: any) => !['hang_up', 'initiate_phone_call'].includes(t.name))
      .map((t: any) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters }
      }));
    cacheTimestamp = now;
    console.log(`[HYBRID] Cached ${cachedToolDefinitions.length} tool definitions`);
  }
  
  return cachedToolDefinitions || [];
}
```

---

### 2. SSE Streaming Implementation (Major Impact - perceived latency drops from 30s to 3-5s)

**Problem:** Users wait for the entire response before seeing any text.

**Solution:** Use OpenAI Assistants v2 streaming API and return Server-Sent Events to the frontend.

#### Backend Changes

**File:** `supabase/functions/hybrid-assistant-api/index.ts`

**Add streaming mode detection and SSE response:**

```typescript
// In serve() handler, detect streaming request
const { stream = false, ...restBody } = await req.json();

if (stream) {
  // Return SSE stream
  return handleStreamingRequest(restBody);
} else {
  // Existing polling behavior
  return handlePollingRequest(restBody);
}
```

**New streaming handler:**
```typescript
async function handleStreamingRequest(body: any) {
  const { userInput, userId, threadId, assistantId } = body;
  
  // ... same pre-processing as before (parallel fetch) ...
  
  // Create run with streaming enabled
  const runResponse = await fetch(
    `https://api.openai.com/v1/threads/${openaiThreadId}/runs`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({
        assistant_id: assistantId,
        additional_instructions: additionalInstructions,
        tools: toolDefinitions,
        stream: true  // Enable streaming
      })
    }
  );

  // Transform OpenAI stream to SSE for client
  const transformStream = new TransformStream({
    transform(chunk, controller) {
      // Parse OpenAI event and forward relevant deltas
      const text = new TextDecoder().decode(chunk);
      // Extract thread.message.delta events and forward
      controller.enqueue(new TextEncoder().encode(`data: ${text}\n\n`));
    }
  });

  return new Response(runResponse.body?.pipeThrough(transformStream), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}
```

#### Frontend Changes

**File:** `src/contexts/CommsConsoleContext.tsx`

**Replace `supabase.functions.invoke` with streaming fetch:**

```typescript
const sendMessage = useCallback(async (content: string) => {
  // ... existing message creation ...
  
  const requestStartTime = Date.now();
  let timeToFirstToken: number | null = null;
  
  // Create placeholder assistant message
  const assistantMessageId = `assistant-${Date.now()}`;
  setMessages(prev => [...prev, {
    id: assistantMessageId,
    role: 'assistant',
    content: '',
    source: currentMode,
    assistant_id: currentAssistant?.id || null,
    created_at: new Date().toISOString(),
  }]);
  
  try {
    const response = await fetch(
      `https://wwxgajrtmslzklnyplah.supabase.co/functions/v1/hybrid-assistant-api`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userInput: content,
          userId,
          threadId: effectiveThreadId,
          assistantId: currentAssistant?.openai_assistant_id,
          stream: true
        })
      }
    );
    
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      const deltaContent = parseSSEDelta(chunk); // Extract text from delta
      
      if (deltaContent) {
        if (!timeToFirstToken) {
          timeToFirstToken = Date.now() - requestStartTime;
        }
        fullContent += deltaContent;
        setMessages(prev => prev.map(m => 
          m.id === assistantMessageId 
            ? { ...m, content: fullContent }
            : m
        ));
      }
    }
    
    // Persist with metrics (after stream completes)
    const responseTimeMs = Date.now() - requestStartTime;
    persistMessagesWithMetrics(content, fullContent, {
      response_time_ms: responseTimeMs,
      time_to_first_token: timeToFirstToken,
      word_count: fullContent.split(/\s+/).length,
      user_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      streamed: true
    });
    
  } catch (err) {
    // ... error handling ...
  }
}, [...]);
```

---

### 3. Latency Metrics Tracking

**File:** `src/contexts/CommsConsoleContext.tsx`

**Add timing capture around requests:**

```typescript
// Before the API call
const requestStartTime = Date.now();

// After receiving complete response
const responseTimeMs = Date.now() - requestStartTime;

// Enhanced persistence call
supabase.functions.invoke('generate-embeddings', {
  body: {
    action: 'store_conversation',
    userId,
    threadId: effectiveThreadIdForPersistence,
    assistantId: currentAssistant?.id || null,
    source: 'chat',
    role: 'assistant',
    content: data?.response || '',
    messageType: 'assistant',
    metadata: {
      mode: 'comms_console',
      response_time_ms: responseTimeMs,
      time_to_first_token: timeToFirstToken || null,
      word_count: (data?.response || '').split(/\s+/).length,
      content_length: (data?.response || '').length,
      user_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      request_timestamp: new Date(requestStartTime).toISOString(),
      streamed: false  // or true if using streaming
    }
  }
});
```

**Debug Query Template:**
```sql
SELECT 
  id,
  role,
  source,
  created_at AT TIME ZONE 'America/New_York' as local_time,
  metadata->>'response_time_ms' as latency_ms,
  metadata->>'time_to_first_token' as ttft_ms,
  metadata->>'word_count' as words,
  metadata->>'user_timezone' as tz,
  LEFT(content, 50) as preview
FROM conversation_messages 
WHERE source = 'chat'
ORDER BY created_at DESC 
LIMIT 20;
```

---

### 4. Smart Routing for Simple Queries (Phase 3 - Future)

**Concept:** Detect trivial messages (greetings, acknowledgments) and route to Chat Completions API instead of Assistants API, skipping RAG.

**Detection patterns:**
```typescript
const TRIVIAL_PATTERNS = [
  /^(hi|hello|hey|thanks|thank you|ok|okay|got it|sure|yes|no|bye|goodbye)\.?$/i,
  /^good (morning|afternoon|evening)\.?$/i
];

function isTrivialMessage(input: string): boolean {
  const trimmed = input.trim();
  return trimmed.length < 20 && TRIVIAL_PATTERNS.some(p => p.test(trimmed));
}
```

**Routing logic (in hybrid-assistant-api):**
```typescript
if (isTrivialMessage(userInput)) {
  // Skip RAG, skip Assistants API - use Chat Completions directly
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${openaiApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are Iris, a helpful assistant. Respond briefly.' },
        { role: 'user', content: userInput }
      ],
      max_tokens: 100
    })
  });
  // Return immediately without tool processing
}
```

---

## Implementation Order

| Priority | Optimization | Effort | Impact |
|----------|--------------|--------|--------|
| 1 | Tool Caching | Low (30 min) | ~400ms per request |
| 2 | Latency Metrics | Low (1 hour) | Essential for monitoring |
| 3 | SSE Streaming | Medium (3-4 hours) | Perceived latency 30s → 3-5s |
| 4 | Smart Routing | Medium (2 hours) | 2-10s for simple queries |

---

## Technical Notes

- Tool caching uses module-level variables in Deno (persists during cold start lifecycle)
- OpenAI Assistants v2 streaming returns `thread.message.delta` events with incremental content
- Tool calls during streaming still require synchronous handling before continuing
- SSE requires proper error handling for connection drops
- Metrics are stored in JSONB `metadata` column for flexible querying
- Smart routing is optional and should be tested carefully to avoid skipping important context

