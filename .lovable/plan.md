

# Wire Chat Check-In to SharedAgendaManager

## Overview

Integrate the `agenda-manager` edge function into the chat check-in lifecycle so that tangents are tracked and automatically recovered -- identical to the phone/voice call behavior. No new edge functions or UI components are needed.

## What Changes

### File: `src/hooks/useChatAssistant.ts`

**1. Add agenda state refs**

Add two refs to track an active check-in:
- `activeAgendaThreadId` (string | null) -- the thread ID used with the agenda-manager
- `agendaStep` ('topic_selection' | 'task_selection' | 'scheduling' | null) -- current phase
- `lastInteractiveContent` (InteractiveContent | null) -- cached so we can re-present it after a tangent

**2. Add `callAgendaManager` helper**

A thin wrapper that calls `supabase.functions.invoke('agenda-manager', { body })` with the active thread ID, user ID, and the requested operation + params.

**3. Modify `startWindowCheckIn()`**

After building the topic list and before inserting the assistant message:
- Call `agenda-manager` with `operation: 'initialize'` and a context string describing the 3-step agenda:
  ```
  1. Select topic group
  2. Select tasks from topic
  3. Schedule selected tasks
  ```
- Call `operation: 'start_item'` with `itemIndex: 0`
- Set `activeAgendaThreadId` to the current `threadId`
- Set `agendaStep` to `'topic_selection'`
- Cache the interactive content in `lastInteractiveContent`

**4. Modify `selectTopic()`**

After fetching tasks and before inserting the task-selection message:
- Call `operation: 'complete_item'` (completes "Select topic group", auto-advances to item 1)
- Set `agendaStep` to `'task_selection'`
- Cache the new interactive content

**5. Modify `scheduleSelectedTasks()`**

After scheduling succeeds:
- Call `operation: 'complete_item'` twice (completes "Select tasks" and "Schedule")
- Clear `activeAgendaThreadId`, `agendaStep`, and `lastInteractiveContent`

**6. Modify `sendMessage()` -- tangent detection and recovery**

Before calling `hybrid-assistant-api`, check if `activeAgendaThreadId` is set. If so:
1. Call `agenda-manager` with `operation: 'pause_for_tangent'` and the user's message
2. Proceed with the normal `hybrid-assistant-api` call (Iris answers the tangent)
3. After receiving the response, call `operation: 'get_resume_hint'`
4. If a hint is returned, call `operation: 'resume'`
5. Append a second assistant message with:
   - Content: "Getting back to your check-in..." (or the hint text)
   - `interactive` set to the cached `lastInteractiveContent` (re-presents the topic chips or task checklist)

This means if a user asks "What's the weather?" mid-flow, Iris answers the weather question, then immediately re-presents the interactive UI with a "Getting back to..." label.

## No Changes Needed

| File | Reason |
|------|--------|
| `src/components/ChatInteractiveMessage.tsx` | Already renders all interactive types correctly |
| `src/components/ChatInterface.tsx` | Already renders interactive content on assistant messages |
| `supabase/functions/agenda-manager/index.ts` | Used as-is -- same operations as phone/voice |
| `supabase/functions/_shared/agenda-wrapper.ts` | Reference only -- chat calls the edge function directly |

## Tangent Recovery Flow

```text
1. User taps "Check In"
   --> agenda-manager: initialize (3 items), start_item(0)
   --> Iris shows topic chips

2. User types "What's the weather in Baltimore?"
   --> agenda-manager: pause_for_tangent
   --> hybrid-assistant-api answers weather question
   --> agenda-manager: get_resume_hint --> "Getting back to: Select topic group"
   --> agenda-manager: resume
   --> Iris shows weather answer, then re-presents topic chips

3. User taps a topic
   --> agenda-manager: complete_item (auto-advances)
   --> Iris shows task checklist

4. User selects tasks, taps "Schedule These"
   --> agenda-manager: complete_item x2
   --> Agenda cleared, confirmation shown
```

## Technical Details

The `callAgendaManager` helper uses `supabase.functions.invoke` (not raw fetch), keeping it consistent with how the chat already calls `execute-tool` and `hybrid-assistant-api`. The agenda thread ID reuses the existing `threadId` from the chat hook, ensuring cross-session persistence if the user refreshes.

