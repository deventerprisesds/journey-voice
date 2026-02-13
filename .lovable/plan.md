

# Interactive Topic-Based Task Selection in Chat

## Overview

Add an interactive, structured question-and-answer flow to the Chat interface that mirrors the window-transition call experience from phone calls. When Iris asks "What do you want to work on?", the chat renders topic groups as tappable chips. Selecting a topic reveals its tasks as checkboxes. Submitting selected tasks pushes them to the auto-scheduler.

This leverages the existing `call-context-builder.ts` patterns (topic group fetching, window detection, tier-1/tier-2 fallback) and the existing `get_tasks_by_topic` and `parse_and_create_tasks` tools -- no new edge functions needed.

## User Flow

```text
1. User opens chat (or Iris initiates a check-in message)
2. Iris says: "What would you like to focus on right now?"
   --> Renders topic groups as tappable chips/buttons
3. User taps a topic (e.g., "Career Development")
   --> Chat calls get_tasks_by_topic, renders tasks as checkboxes
4. User checks tasks they want to work on, taps "Schedule These"
   --> Selected tasks are sent to schedule_task / parse_and_create_tasks
5. Iris confirms: "Got it -- scheduled 3 tasks for this window"
```

## Technical Plan

### 1. Extend ChatMessage with structured content types

**File: `src/hooks/useChatAssistant.ts`**

Add a `structuredContent` field to `ChatMessage`:

```typescript
export interface InteractiveContent {
  type: 'topic_selection' | 'task_selection' | 'confirmation';
  topics?: Array<{ topic_name: string; task_count: number; priority_density: number }>;
  tasks?: Array<{ id: string; title: string; priority: string; status: string; category: string }>;
  selectedTopicName?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isLoading?: boolean;
  interactive?: InteractiveContent;  // NEW
}
```

### 2. Create a new "Window Check-In" trigger

**File: `src/hooks/useChatAssistant.ts`**

Add a `startWindowCheckIn()` function that:
1. Detects the current time window (morning, business_hours, after_work, evening, weekends) using the same `WINDOW_RANGES` constants from `call-context-builder.ts`
2. Fetches topic groups from `task_topic_index` joined with `task_topic_mappings` (same query pattern as `getTopicGroupsManual`)
3. Inserts an assistant message with `interactive.type = 'topic_selection'` containing the topic list
4. Falls back to "all topics" if no window-specific topics exist (matching the tier-1/tier-2 pattern from phone calls)

### 3. Build interactive UI components in ChatInterface

**File: `src/components/ChatInterface.tsx`**

Extend `MessageBubble` to render interactive content:

- **Topic Selection**: Render topic groups as a grid of tappable chips/badges. Each chip shows `topic_name (N tasks)` with a highlight for high-priority groups. Tapping a chip triggers `handleTopicSelect(topicName)`.

- **Task Selection**: Render tasks as a checklist with checkboxes. Each row shows task title, priority badge, and category. A "Schedule Selected" button at the bottom submits checked tasks.

- **Confirmation**: Render a success message with the scheduled task count.

### 4. Wire up topic drill-down and scheduling

**File: `src/hooks/useChatAssistant.ts`**

Add two new functions:

- `selectTopic(topicName: string)`: Calls the `execute-tool` edge function with `get_tasks_by_topic` tool. Renders the returned tasks as an interactive `task_selection` message.

- `scheduleSelectedTasks(taskIds: string[])`: Calls `execute-tool` with `schedule_task` for each selected task (or batches them via `parse_and_create_tasks`). Renders a confirmation message.

### 5. Add a "Check In" quick action button

**File: `src/components/ChatInterface.tsx`**

Add a "Check In" button to the empty-state quick actions and to the input bar area. Tapping it triggers `startWindowCheckIn()`, which starts the interactive flow.

### 6. Align with phone call instructions

No changes needed to `call-context-builder.ts` or `persona.ts`. The chat-side implementation reuses:
- Same `WINDOW_RANGES` and `CATEGORY_WINDOW_MAPPING` constants (imported or duplicated as simple config)
- Same data queries (topic groups via `task_topic_index` + `task_topic_mappings`)
- Same tool calls (`get_tasks_by_topic`, `schedule_task`, `parse_and_create_tasks`)

The phone call flow is AI-driven (Iris asks verbally, user responds verbally). The chat flow is UI-driven (Iris presents visual options, user taps). Both follow the identical agenda pattern:
1. Present topic groups for the current window
2. Drill into selected topic
3. Schedule selected tasks

## Files Changed

| File | Change |
|------|--------|
| `src/hooks/useChatAssistant.ts` | Add `InteractiveContent` type, `startWindowCheckIn()`, `selectTopic()`, `scheduleSelectedTasks()` functions |
| `src/components/ChatInterface.tsx` | Extend `MessageBubble` to render topic chips, task checklists, and confirmation cards; add "Check In" quick action |
| `src/components/ChatInteractiveMessage.tsx` | **New file** -- Reusable component for rendering interactive message types (topic grid, task checklist, schedule button) |

## What stays the same

- No new edge functions (reuses `execute-tool` with existing tools)
- No changes to `tool-definitions.ts`, `persona.ts`, or `call-context-builder.ts`
- Phone and voice call flows remain unchanged
- The interactive elements are purely a chat UI enhancement that calls the same backend tools

