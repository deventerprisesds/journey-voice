
# Fix: SSE Streaming Parser Bug

## Problem
The chat responses are truncated/corrupted because the SSE parser only processes the first event per chunk.

**Symptoms (from screenshot):**
- "What is the date?" → "Today, January 202." (missing "is Wednesday," and "8, 2026")
- "I'm sorry the date and time" → "TheAmerica/New_Y)." (completely garbled)

## Root Cause
In `src/contexts/CommsConsoleContext.tsx`, the `parseSSEDelta` function returns after finding the first valid JSON line:

```typescript
function parseSSEDelta(chunk: string) {
  const lines = chunk.split('\n');
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    // BUG: Returns immediately after first parsed event
    try {
      return JSON.parse(data);  // <-- Only first event processed
    } catch {}
  }
  return null;
}
```

SSE chunks often contain multiple events, so most deltas are being dropped.

## Solution
Change the parser to return an **array of all parsed events** from each chunk, then process all of them in the streaming loop.

## Implementation

### File: `src/contexts/CommsConsoleContext.tsx`

**1. Update the parser to return all events (around line 64):**

```typescript
function parseSSEEvents(chunk: string): Array<{ type: string; content?: string; threadId?: string }> {
  const events: Array<{ type: string; content?: string; threadId?: string }> = [];
  const lines = chunk.split('\n');
  
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (!data) continue;
    if (data === '[DONE]') {
      events.push({ type: 'done' });
      continue;
    }
    try {
      events.push(JSON.parse(data));
    } catch {
      // Skip malformed JSON (may be split across chunks)
    }
  }
  
  return events;
}
```

**2. Update the streaming loop to process all events (around line 372-396):**

```typescript
while (reader) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value, { stream: true });
  const events = parseSSEEvents(chunk);  // Get ALL events

  for (const parsed of events) {  // Process each event
    if (parsed.type === 'delta' && parsed.content) {
      if (!timeToFirstToken) {
        timeToFirstToken = Date.now() - requestStartTime;
        console.log(`[CommsConsole] Time to first token: ${timeToFirstToken}ms`);
      }
      fullContent += parsed.content;
      setMessages((prev) => prev.map(m =>
        m.id === assistantMessageId
          ? { ...m, content: fullContent }
          : m
      ));
    } else if (parsed.type === 'done') {
      receivedThreadId = parsed.threadId || null;
    } else if (parsed.type === 'tool_call') {
      setMessages((prev) => prev.map(m =>
        m.id === assistantMessageId
          ? { ...m, content: fullContent + `\n\n_Using ${parsed.content || 'tools'}..._` }
          : m
      ));
    }
  }
}
```

## Expected Outcome
- All delta tokens will be processed and accumulated correctly
- "What is the date?" → "Today is Wednesday, January 28, 2026."
- Response streaming will display smoothly token-by-token

## Testing
1. Send a message in the chat and verify the full response appears
2. Confirm timestamps and dates render completely
3. Check the persisted content matches the displayed content
