

# Create QuickTaskInput for Focus View Direct Task Creation

## Overview

Create a new, simpler component specifically for the Focus View that directly calls `parse_and_create_tasks` (same as Chat/Voice) instead of going through the preview card flow.

## Why a New Component?

`SmartTaskInput` is used in 4 places:
- `FocusView.tsx` - Today's schedule (needs direct creation)
- `EnhancedTaskGridView.tsx` - List view (keeps preview)
- `CalendarModule.tsx` - Calendar view (keeps preview)
- `TabbedKanbanBoard.tsx` - Kanban view (keeps preview)

Only Focus View needs the simplified "create immediately" behavior. The other 3 views benefit from the preview/edit step since they deal with various dates.

## Solution

### File 1: Create `src/components/QuickTaskInput.tsx` (NEW)

A streamlined component that:
- Takes text input from user
- Calls `execute-tool` edge function with `parse_and_create_tasks`
- Always defaults `target_date` to `'today'` (using central timezone utility)
- Creates task immediately (no preview step)
- Shows success/error toast

```typescript
import React, { useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { getDefaultTimezone } from '@/lib/date';

interface QuickTaskInputProps {
  onTaskCreated?: () => void;
}

const QuickTaskInput: React.FC<QuickTaskInputProps> = ({ onTaskCreated }) => {
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;

    setIsProcessing(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const userTimezone = getDefaultTimezone();

      // Call execute-tool with parse_and_create_tasks
      // target_date: 'today' ensures due_date defaults to today
      const { data, error } = await supabase.functions.invoke('execute-tool', {
        body: {
          toolName: 'parse_and_create_tasks',
          toolArgs: {
            text: input.trim(),
            target_date: 'today',
            auto_schedule: true
          },
          userId: user.id,
          context: {
            timezone: userTimezone
          }
        }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to create task');

      const createdCount = data.result?.createdTasks?.length || 1;
      toast({
        title: "Task Created",
        description: `Added ${createdCount} task${createdCount !== 1 ? 's' : ''} to today's schedule`,
      });

      setInput('');
      onTaskCreated?.();

    } catch (error) {
      console.error('Failed to create task:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create task",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Add a task for today..."
        disabled={isProcessing}
        className="flex-1"
      />
      <Button type="submit" disabled={isProcessing || !input.trim()} size="icon">
        {isProcessing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
      </Button>
    </form>
  );
};

export default QuickTaskInput;
```

### File 2: Update `src/components/FocusView.tsx`

Replace `SmartTaskInput` import and usage with `QuickTaskInput`:

**Change 1**: Update import (line 35):
```typescript
// Before
import SmartTaskInput from './SmartTaskInput';

// After
import QuickTaskInput from './QuickTaskInput';
```

**Change 2**: Update component usage (lines 398-402):
```typescript
// Before
<SmartTaskInput 
  tasks={tasks}
  targetDate={today}
  onTaskScheduled={onTaskUpdate}
/>

// After
<QuickTaskInput 
  onTaskCreated={() => onTaskUpdate?.(null as any)}
/>
```

## How It Works

```text
User types "gym" in Focus View
        ↓
QuickTaskInput → execute-tool edge function
        ↓
toolName: 'parse_and_create_tasks'
toolArgs: { text: "gym", target_date: "today", auto_schedule: true }
        ↓
execute-tool resolves "today" → "2026-02-04" (user's timezone)
        ↓
ai-task-parser sets due_date: "2026-02-04"
        ↓
Task created in DB with due_date + auto-scheduled start_time
        ↓
Toast "Task Created" → List refreshes → Task appears
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/components/QuickTaskInput.tsx` | CREATE - New simplified component |
| `src/components/FocusView.tsx` | MODIFY - Use QuickTaskInput instead of SmartTaskInput |

## Benefits

1. **No breaking changes** - SmartTaskInput unchanged for other views
2. **Unified with Chat/Voice** - Same `parse_and_create_tasks` path
3. **Automatic due_date** - Always defaults to today for Focus View
4. **Simpler UX** - No preview step needed for today's tasks
5. **Uses central timezone utility** - Consistent date handling

