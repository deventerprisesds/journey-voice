

# Fix: Batch Scheduler taskIndex Off-By-One

## Root Cause

The `batch-calendar-scheduler` prompt numbers tasks starting at 1 (`1. "Go to the bank"`), and the AI returns `taskIndex: 1`. But the code uses `tasks[result.taskIndex]` which is 0-indexed. Since there's only 1 task, `tasks[1]` is `undefined` and gets silently skipped.

This is why every single-task quick-add "succeeds" but returns `scheduled: []`.

## Fix

**File**: `supabase/functions/batch-calendar-scheduler/index.ts`

One change in the result mapping loop (line 465-467):

```typescript
// Before
const originalTask = tasks[result.taskIndex];

// After — handle 1-based AI responses
const idx = result.taskIndex >= 1 && result.taskIndex > tasks.length - 1 
  ? result.taskIndex - 1