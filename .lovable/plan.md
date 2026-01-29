
# Plan: Unhide Kanban Toolbar in Tabbed View

## Summary

The toolbar buttons (AI Create, Filters, Select mode, Schedule, etc.) are hidden in the tabbed Kanban view because they're wrapped inside the conditional block `{!useStandardColumns && board && (...)}`. The fix is to move the toolbar outside this conditional so it's always visible.

No new functions are needed - the existing `setIsCreationModalOpen(true)` pattern already handles task creation correctly.

---

## Current Problem

**File: `src/components/KanbanBoard.tsx` (lines 936-1014)**

The entire toolbar is inside a conditional block:
```tsx
{!useStandardColumns && board && (
  <div className="flex items-center justify-between">
    <div>{/* Board title */}</div>
    <div className="flex items-center gap-2">
      <VoiceAssistantButton />
      <Button>Select</Button>
      <Button>Show/Hide Completed</Button>
      <AddColumnModal />
      <Button>Filters</Button>
      <Button onClick={() => setIsCreationModalOpen(true)}>AI Create</Button>  ← HIDDEN in tabbed mode!
      <Button>Schedule</Button>
      <Button>Add Sample</Button>
    </div>
  </div>
)}
```

When `useStandardColumns=true` (tabbed view), this entire block is skipped, hiding all toolbar buttons.

---

## Solution

Split the conditional into two parts:

1. **Board header (title/description)** - stays conditional (hidden in tabbed mode, as intended)
2. **Toolbar buttons** - moved outside the conditional (always visible)

Some buttons like "Add Column" and "Add Sample" only make sense in full board mode, so they remain conditional.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/KanbanBoard.tsx` | Restructure lines 936-1014 to separate board header from toolbar |

---

## Implementation Details

**New structure:**
```tsx
{/* Board Header - hide in tabbed mode */}
{!useStandardColumns && board && (
  <div>
    <h2>{board.name}</h2>
    <p>{board.description}</p>
  </div>
)}

{/* Toolbar - ALWAYS visible */}
<div className="flex items-center justify-end gap-2 flex-wrap">
  <VoiceAssistantButton />
  <Button onClick={toggleSelectMode}>Select</Button>
  <Button onClick={toggleShowCompletedTasks}>Show/Hide Completed</Button>
  {!useStandardColumns && board && <AddColumnModal />}  {/* Only in full board */}
  <Button onClick={() => setShowFilters(!showFilters)}>Filters</Button>
  <Button onClick={() => setIsCreationModalOpen(true)}>AI Create</Button>
  <Button onClick={generateDailySchedule}>Schedule</Button>
  {!useStandardColumns && <Button onClick={addSampleTask}>Add Sample</Button>}  {/* Only in full board */}
</div>
```

---

## DailyScheduleView Status

The "New Task" button already follows the correct pattern:
```tsx
<Button onClick={() => { setCreateAtTime(null); setIsCreating(true); }}>
  New Task
</Button>
```

This is equivalent to the Kanban's `setIsCreationModalOpen(true)` - both open `TaskCreationModal` with appropriate props. No changes needed here since the pattern is already consistent and reusable.

---

## Expected Result

After this change:
- The AI Create button, Filters, Select mode, Show Completed, Schedule, and Voice Assistant buttons will be visible in both the standard Kanban view AND the tabbed category view (Today, Career, Prof. Education, Ventures, Life)
- Add Column and Add Sample remain hidden in tabbed mode (as they require the full board context)
