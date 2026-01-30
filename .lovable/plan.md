

## Fix Chat Loading States and Tool Call Streaming Issues

### Problems Identified

Based on my analysis of the codebase and the screenshot showing two empty message bubbles:

1. **Duplicate Loading Indicators**: When a message is processing, TWO bubbles appear:
   - An empty assistant message placeholder (added at line 345-352 in `CommsConsoleContext.tsx`)
   - The `isLoading` bouncing dots indicator (rendered at line 86-99 in `TranscriptScroll.tsx`)

2. **"Using tool" Flash Then Blank UI**: When the AI uses tools (like searching tasks):
   - The streaming handler in `handleStreamingRequest` sends `tool_call` events
   - But it does NOT wait for tool execution to complete - it just pipes through OpenAI's stream
   - When OpenAI's stream enters `requires_action` status (needing tool outputs), the stream ends
   - The frontend's placeholder message is left with empty content or just the tool indicator
   - The "Using tools..." text gets cleaned up (line 419-423), leaving an empty bubble

3. **Root Cause**: The streaming implementation is incomplete for tool calls. As noted in lines 494-496: *"Tool calls will fall back to polling mode for now"* - but this fallback doesn't actually happen. The streaming mode just terminates when tools are needed.

---

### Solution

#### Fix 1: Eliminate Duplicate Loading Indicators

**File: `src/components/CommsConsole/TranscriptScroll.tsx`**

Don't show the `isLoading` indicator when there's already a streaming message placeholder (empty assistant message). The logic should check if the last message is an empty assistant message and skip the bouncing dots in that case.

| Line | Change |
|------|--------|
| 86-99 | Add condition to hide loading indicator when there's an empty streaming placeholder |

```tsx
// Current: Always shows loading indicator when isLoading=true
{isLoading && (
  <div className="flex gap-2 animate-fade-in">...</div>
)}

// Fixed: Hide when there's already a streaming placeholder
{isLoading && !messages.some(m => m.role === 'assistant' && !m.content) && (
  <div className="flex gap-2 animate-fade-in">...</div>
)}
```

#### Fix 2: Show Loading State in Empty Placeholder

**File: `src/components/CommsConsole/TranscriptScroll.tsx`**

Render the bouncing dots INSIDE assistant messages that have empty content (streaming placeholders) instead of as a separate element.

| Line | Change |
|------|--------|
| 77-80 | Modify message content rendering to show loading animation for empty assistant messages |

```tsx
// Current: Just renders empty content
<p className="text-sm whitespace-pre-wrap break-words">
  {message.content}
</p>

// Fixed: Show loading animation for empty assistant messages
{message.role === 'assistant' && !message.content ? (
  <div className="flex gap-1">
    <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '0ms' }} />
    <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '150ms' }} />
    <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '300ms' }} />
  </div>
) : (
  <p className="text-sm whitespace-pre-wrap break-words">
    {message.content}
  </p>
)}
```

#### Fix 3: Fallback to Polling When Tools Are Required

**File: `src/contexts/CommsConsoleContext.tsx`**

When streaming ends with no content (tool call scenario), automatically retry with polling mode instead of leaving an empty message.

| Line | Change |
|------|--------|
| After 423 | Add fallback logic to use polling mode when streaming produces no content |

```tsx
// After final cleanup (line 423)
// Check if we got no content (tool calls not supported in streaming)
if (!fullContent) {
  console.log('[CommsConsole] Streaming produced no content, falling back to polling...');
  // Remove the empty placeholder
  setMessages((prev) => prev.filter(m => m.id !== assistantMessageId));
  
  // Call again without streaming
  const fallbackResponse = await supabase.functions.invoke('hybrid-assistant-api', {
    body: {
      userInput: content,
      userId,
      threadId: effectiveThreadId,
      assistantId: currentAssistant?.openai_assistant_id || undefined,
      dbAssistantId: currentAssistant?.id || undefined,
      stream: false // Explicitly disable streaming
    },
  });
  
  if (fallbackResponse.data?.response) {
    setMessages((prev) => [...prev, {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: fallbackResponse.data.response,
      source: currentMode,
      assistant_id: currentAssistant?.id || null,
      created_at: new Date().toISOString(),
    }]);
    receivedThreadId = fallbackResponse.data.threadId;
  }
}
```

---

### Files Changed

| File | Changes |
|------|---------|
| `src/components/CommsConsole/TranscriptScroll.tsx` | Show loading animation inside empty placeholder messages; hide duplicate loading indicator |
| `src/contexts/CommsConsoleContext.tsx` | Add polling fallback when streaming returns empty content (tool call scenarios) |

---

### Why This Works

1. **Single Visual Indicator**: Users see only ONE loading state - the bouncing dots appear inside the assistant bubble itself
2. **Tool Calls Succeed**: When streaming fails due to tool calls, the system automatically falls back to the working polling mode
3. **No Blank Messages**: Empty assistant placeholders either show loading animation or get replaced with actual content

