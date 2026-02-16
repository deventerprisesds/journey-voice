

# Fix: Chat Check-In Context Grounding and Tool Guardrails

## Problem

When a scheduled check-in fires, the AI correctly lists the day's tasks. But when the user asks a follow-up question ("What are the tasks you speak of?"), the AI loses context because:

1. The follow-up message is sent to `hybrid-assistant-api` with no reference to the active check-in
2. The OpenAI thread contains old conversation history about unrelated tasks (e.g., "AI presentation")
3. The AI hallucinates context from old messages and executes destructive tool calls (unscheduling tasks) when the user only asked a question

## Solution: Two Changes

### 1. Inject Check-In Context Into Follow-Up Messages

**File: `src/hooks/useChatAssistant.ts` (sendMessage function, ~line 604)**

When the user sends a free-form message while an agenda is active (`activeAgendaThreadId.current` is set), prepend a grounding instruction to the `userInput` sent to `hybrid-assistant-api`:

```
[ACTIVE CHECK-IN CONTEXT]
The user is currently in a {agendaStep} step of their check-in.
The assistant just presented {description of lastInteractiveContent}.
The user's message below is likely a follow-up question about this check-in.
Do NOT execute any task modification tools (unschedule_task, update_task, move_to_backlog, etc.)
unless the user EXPLICITLY asks you to change something.
Respond conversationally based on the current check-in context.

User message: {actual message}
```

This ensures that when the user says "What are the tasks you speak of?", the AI knows they're referring to the tasks it just listed, not to old thread history.

### 2. Store Check-In Task Context for Reference

**File: `src/hooks/useChatAssistant.ts`**

Add a new ref: `checkInTaskContext` that stores a summary of what was presented during the check-in (task names, times, etc.). This gets populated in `startWindowCheckIn` and cleared in `scheduleSelectedTasks` or when the agenda ends.

When building the grounding instruction, include the actual task data:
```
The check-in listed these scheduled tasks:
1. Test Cook Dinner - 12:15 AM, 60 min
2. Test Evening Courses - 2:30 AM, ~23h30m

The user is asking about THESE tasks. Answer from this context.
```

This prevents the AI from calling `get_todays_tasks` or other tools and returning different data.

## Files Changed

| File | Change |
|------|--------|
| `src/hooks/useChatAssistant.ts` | Add `checkInTaskContext` ref; modify `startWindowCheckIn` to store presented task data; modify `sendMessage` to prepend grounding context when agenda is active |

## What Stays the Same

- `hybrid-assistant-api` -- no changes needed (grounding is prepended to userInput)
- `send-chat-message` -- no changes (initial check-in delivery is fine)
- `agenda-manager` -- already wired, tangent pause/resume continues to work
- Voice/phone flows -- unaffected

## Expected Behavior After Fix

1. Scheduled check-in fires: "Today you have these tasks: Test Cook Dinner at 12:15 AM..."
2. User asks: "What are the tasks you speak of?"
3. AI receives grounding: knows the user is asking about the check-in tasks, does NOT call tools
4. AI responds: "Those are your two scheduled tasks for today -- Test Cook Dinner at 12:15 AM and Test Evening Courses at 2:30 AM. Would you like to adjust either of them?"
