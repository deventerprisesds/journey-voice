
# Fix Chat Crashes & AI Date Accuracy Issues

## Problem Summary

Three issues have been identified:
1. **Error Serialization Bug**: Tool errors show as `[object Object]` instead of meaningful messages
2. **Stream Timeout Crash**: Chat shows "Failed to send message" when the connection closes unexpectedly  
3. **AI Date Calculation Error**: When user said "next Tuesday", AI scheduled for February 6th (Friday) instead of February 3rd (actual next Tuesday)

---

## Issue 1: Error Serialization Bug

### Root Cause
In `supabase/functions/execute-tool/index.ts`, error objects from Supabase are serialized using `String(error)` which produces `"[object Object]"` instead of the actual error message.

**Current Code (Lines 933, 963, 1013, etc.):**
```typescript
} catch (error) {
  return { success: false, error: String(error) };
}
```

**Problem**: Supabase errors are objects like:
```json
{ "code": "PGRST116", "message": "JSON object requested, multiple (or no) rows returned" }
```

### Fix
Update all catch blocks to properly serialize error messages:

```typescript
} catch (error) {
  const errorMessage = error instanceof Error 
    ? error.message 
    : (typeof error === 'object' && error !== null && 'message' in error)
      ? (error as any).message
      : JSON.stringify(error);
  return { success: false, error: errorMessage };
}
```

**Files to modify:**
- `supabase/functions/execute-tool/index.ts` - Update all 11+ catch blocks that use `String(error)`

---

## Issue 2: Stream Timeout Crash

### Root Cause
The SSE stream from `hybrid-assistant-api` closes before completion, causing `Http: connection closed before message completed`. The frontend then shows "Failed to send message. Please try again."

This can happen when:
- Tool execution takes too long (>30 seconds total)
- Multiple tool call iterations occur (the logs show 4 iterations)
- Client-side network issues

### Fix 1: Add heartbeat to SSE stream
Send periodic keep-alive messages to prevent timeout:

```typescript
// In hybrid-assistant-api streaming handler
const heartbeatInterval = setInterval(async () => {
  try {
    await writer.write(encoder.encode(`: heartbeat\n\n`));
  } catch {
    clearInterval(heartbeatInterval);
  }
}, 15000); // Every 15 seconds
```

### Fix 2: Better frontend error recovery
When streaming fails, gracefully retry or show more specific error:

```typescript
// In CommsConsoleContext.tsx
} catch (err) {
  console.error('Error sending message:', err);
  const errorMessage: ConversationMessage = {
    id: `error-${Date.now()}`,
    role: 'system',
    content: err instanceof Error 
      ? `Request failed: ${err.message}. Please try again.`
      : 'Connection interrupted. Please try again.',
    source: currentMode,
    assistant_id: null,
    created_at: new Date().toISOString(),
  };
  setMessages((prev) => [...prev, errorMessage]);
}
```

### Fix 3: Add streaming error event handling
Parse error events from the SSE stream:

```typescript
// In CommsConsoleContext.tsx SSE parsing
} else if (parsed.type === 'error') {
  throw new Error(parsed.message || 'Server error occurred');
}
```

**Files to modify:**
- `supabase/functions/hybrid-assistant-api/index.ts` - Add heartbeat mechanism
- `src/contexts/CommsConsoleContext.tsx` - Better error handling and error event parsing

---

## Issue 3: AI Date Calculation Error

### Root Cause
This is an OpenAI model issue, not a tool bug. Looking at the logs:
- User said "next Tuesday" on January 30, 2026 (Thursday)
- AI called `reschedule_task` with `new_date: "2026-02-06"` (Friday!)
- Correct answer: February 3, 2026 (Tuesday)

The assistant is receiving the correct current date in its instructions but is miscalculating "next Tuesday".

### Fix: Strengthen date context in system instructions
Add explicit day-of-week context to help the AI:

```typescript
// In hybrid-assistant-api, getCurrentTimeString function
const dayName = now.toLocaleString('en-US', { timeZone: timezone, weekday: 'long' });
const fullDate = now.toLocaleString('en-US', { 
  timeZone: timezone, 
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true
});

// Include: "Today is Thursday, January 30, 2026. Next Tuesday = February 3, 2026."
```

### Additional Fix: Add date validation in reschedule_task
Optionally validate that the target date is reasonable:

```typescript
// In execute-tool reschedule_task
if (args.reason?.includes('Tuesday') && new Date(args.new_date).getDay() !== 2) {
  console.warn(`[RESCHEDULE] Warning: Date ${args.new_date} is not a Tuesday but reason mentions Tuesday`);
}
```

**Files to modify:**
- `supabase/functions/hybrid-assistant-api/index.ts` - Enhance date context in system prompt
- `supabase/functions/execute-tool/index.ts` - Optional day-of-week validation

---

## Technical Summary

| Issue | Location | Root Cause | Severity |
|-------|----------|------------|----------|
| `[object Object]` errors | execute-tool/index.ts | `String(error)` on objects | High |
| Stream timeout crash | hybrid-assistant-api + frontend | No heartbeat, poor error recovery | High |
| Wrong date calculation | OpenAI model + instructions | Insufficient day-of-week context | Medium |

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/execute-tool/index.ts` | Fix all `String(error)` patterns to properly extract error messages |
| `supabase/functions/hybrid-assistant-api/index.ts` | Add SSE heartbeat, enhance date context in prompts |
| `src/contexts/CommsConsoleContext.tsx` | Handle SSE error events, improve error messaging |

---

## Expected Outcomes

After these fixes:
- Error messages will be meaningful (e.g., "Task not found" instead of `[object Object]`)
- Chat connections will stay alive longer with heartbeat signals
- Users will see more helpful error messages when failures occur
- AI will have stronger date context to prevent day-of-week calculation errors
