
# Fix: Batch Task Scheduling + Chat UX Enhancements

## Problem Summary

Two distinct issues reported:

### Issue 1: Batch Task Scheduling Not Working
When the user said: *"Create tasks: Go to Arundel Mills mall at 2; Transfer $40k at 3; Go to gym at 945; Plan the week at 430; Go to church at 11; Drop off my daughter at 230"*

**What happened:**
- AI called `create_task` 6 times individually
- Tasks created with `start_time: null`, `is_scheduled: false`
- Time slots ("at 2", "at 3", "at 945") were NOT extracted
- "Today's Schedule" shows "0 scheduled"

**Root cause:**
The assistant's `core_instructions` list `create_task` but NOT `parse_and_create_tasks`. The AI doesn't know the more powerful tool exists that handles:
- Natural language time parsing ("at 2", "at 3pm", "at 945")
- Batch creation of multiple tasks
- Auto-scheduling to time slots

### Issue 2: Chat UX Missing Features
- No timestamps on messages (SMS-like experience requested)
- No easy way to copy message content

---

## Solution

### Part 1: Update Assistant Instructions to Use parse_and_create_tasks

**Database update** - Add `parse_and_create_tasks` to the assistant's tool list and instructions:

```sql
UPDATE user_scheduling_prefs 
SET core_instructions = core_instructions || '

TASK CREATION - CRITICAL:
- For MULTIPLE tasks or tasks with times, ALWAYS use parse_and_create_tasks
- parse_and_create_tasks handles: "Go to gym at 9am, meeting at 2pm, dinner at 7" → creates all with scheduled times
- ONLY use create_task for single tasks without specific times
- parse_and_create_tasks auto-schedules tasks and extracts time slots from natural language

Available functions (add to list):
- parse_and_create_tasks: Parse natural language into multiple tasks with auto-scheduling. Use this for: multiple tasks, tasks with times, bulk task creation'
WHERE user_id = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1';
```

### Part 2: Add Message Timestamps (SMS-like)

**File:** `src/components/CommsConsole/TranscriptScroll.tsx`

Add timestamp display below each message bubble:

```typescript
// Add helper function for relative time
const formatRelativeTime = (dateStr: string): string => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

// In the message bubble:
<p className="text-[10px] text-muted-foreground/60 mt-1">
  {formatRelativeTime(message.created_at)}
</p>
```

### Part 3: Add Copy Button on Message Long-Press/Hover

**File:** `src/components/CommsConsole/TranscriptScroll.tsx`

Add a copy button that appears on hover (desktop) or long-press context menu (mobile):

```typescript
import { Copy, Check } from 'lucide-react';

// Add state for copied status
const [copiedId, setCopiedId] = useState<string | null>(null);

const handleCopy = async (content: string, id: string) => {
  await navigator.clipboard.writeText(content);
  setCopiedId(id);
  setTimeout(() => setCopiedId(null), 2000);
};

// In each message bubble, add copy button:
<button 
  onClick={() => handleCopy(message.content, message.id)}
  className="opacity-0 group-hover:opacity-100 absolute -right-6 top-1 p-1 rounded hover:bg-muted transition-opacity"
  title="Copy message"
>
  {copiedId === message.id ? (
    <Check className="w-3 h-3 text-green-500" />
  ) : (
    <Copy className="w-3 h-3 text-muted-foreground" />
  )}
</button>
```

---

## Files to Modify

| File | Change |
|------|--------|
| Database: `user_scheduling_prefs` | Add `parse_and_create_tasks` to core_instructions |
| `src/components/CommsConsole/TranscriptScroll.tsx` | Add timestamps and copy functionality |

---

## Technical Flow After Fix

### Task Creation with Times:
```text
User: "Create tasks: Go to gym at 945; Meeting at 2pm; Dinner at 7"
    ↓
AI sees parse_and_create_tasks in available tools
    ↓
AI calls: parse_and_create_tasks({
  text: "Go to gym at 945; Meeting at 2pm; Dinner at 7",
  target_date: "today",
  auto_schedule: true
})
    ↓
execute-tool → ai-task-parser extracts times
    ↓
batch-calendar-scheduler assigns time slots
    ↓
Tasks created with start_time, end_time, is_scheduled=true
    ↓
Tasks appear in Today's Schedule at correct times
```

### Chat Message UX:
```text
+-----------------------------------------------+
|  [Iris]                                        |
|  The tasks have been scheduled:               |
|  - Go to gym: 9:45 AM                         |
|  - Meeting: 2:00 PM                           |
|  - Dinner: 7:00 PM                            |
|                                   [📋]        |
|                           10:54 AM            |
+-----------------------------------------------+
```

---

## Expected Behavior After Fix

1. **Task Scheduling:**
   - User: "Schedule these for today: gym at 9, meeting at 2, dinner at 7"
   - AI uses `parse_and_create_tasks` instead of individual `create_task` calls
   - Tasks appear in Today's Schedule with correct time slots
   - "3 scheduled" shown instead of "0 scheduled"

2. **Chat UX:**
   - Each message shows relative timestamp ("10:54 AM", "2m ago")
   - Copy button appears on hover/long-press
   - Visual feedback when content is copied
