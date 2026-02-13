

# Fix: Auto-Classify Uncategorized Tasks and Backfill Existing Ones

## Problem

81 of 98 active tasks for the real user (and 19/19 for demo) sit in "Uncategorized" because:

1. **No backfill** -- The `classify-task-topic` trigger was added *after* most tasks already existed, so they were never sent through the AI classifier.
2. **UPDATE skips mapped tasks** -- Correct, but tasks that failed classification (e.g., the demo user FK error we just fixed) are never retried.
3. **No bulk mechanism** -- There is no "classify all unmapped tasks" action in the UI.

## Solution

### 1. Add a "Classify Uncategorized" button to the Priorities page

A small button in the page header that triggers bulk classification of all unmapped tasks. It will call the existing `classify-task-topic` edge function in a loop (with a small delay to avoid rate limits) for every unmapped task.

This gives the user an on-demand way to process the backlog without modifying the trigger behavior.

### 2. Auto-trigger classification on page load for unmapped tasks

When the Priorities page loads and detects unmapped tasks, automatically kick off background classification for up to 10 unmapped tasks per load (to avoid overwhelming the API). This runs silently and refreshes the data when done.

### 3. Update the edge function to handle retries

Remove the early-return for UPDATE operations when the task has no existing mapping. Currently the function checks for existing mappings on UPDATE and skips -- but this means tasks that *failed* classification (like the FK error) never get retried. The fix: only skip if a mapping actually exists; if not, proceed with classification even on UPDATE.

## Technical Plan

### File: `supabase/functions/classify-task-topic/index.ts`
- Remove the UPDATE early-return when no mapping exists (lines 181-199). Instead, only skip if a valid mapping IS found. This is already the current behavior, but I'll add a log so it's clear the function proceeds for unmapped UPDATE operations.

### File: `src/pages/Priorities.tsx`
- Add a `classifyUnmapped` function that:
  1. Collects all tasks not in `task_topic_mappings`
  2. Calls `classify-task-topic` for each (batched, 3 at a time with 500ms delays)
  3. Refreshes data when complete
- Add a "Classify" button next to the view toggle that shows the count of unmapped tasks
- Auto-trigger for small batches on page load when unmapped count > 0

### File: New utility or inline in Priorities
- Helper to call the classify edge function for a single task

## Files Changed

| File | Change |
|------|--------|
| `src/pages/Priorities.tsx` | Add "Classify Uncategorized" button and auto-classify logic on load |
| `supabase/functions/classify-task-topic/index.ts` | Clarify UPDATE handling -- proceed with classification for unmapped tasks on UPDATE |

