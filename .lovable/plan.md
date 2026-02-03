

# Plan: SmartTaskInput Positioning & Label Improvements

## Summary

This plan addresses three issues across three views:
1. **Focus View**: Move SmartTaskInput to its own row at the top, above both columns
2. **Kanban Board**: Move SmartTaskInput above the filter pills (category tabs) 
3. **List View**: Move SmartTaskInput below the header section and above the "Group by" controls
4. **All Views**: Improve the "+Assign" label to be more intuitive

---

## Current vs. Desired Layout

### Focus View

**Current**: SmartTaskInput is inside the "Today's Schedule" card, below the card header
```
┌─────────────────────────────────────────────────────────────┐
│ Today's Schedule Card                 │ Currently Doing     │
│ ┌─────────────────────────────────┐  │                     │
│ │ [SmartTaskInput HERE - WRONG]   │  │                     │
│ └─────────────────────────────────┘  │                     │
│ Morning, Business Hours, etc.        │                     │
└─────────────────────────────────────────────────────────────┘
```

**Desired**: SmartTaskInput on its own row at the very top
```
┌─────────────────────────────────────────────────────────────┐
│ [SmartTaskInput - FULL WIDTH - OWN ROW]                     │
├─────────────────────────────────────────────────────────────┤
│ Today's Schedule Card                 │ Currently Doing     │
└─────────────────────────────────────────────────────────────┘
```

### Kanban Board (via TabbedKanbanBoard)

**Current**: Category pills are at the top, SmartTaskInput is below them inside KanbanBoard
```
[Today v] [Career] [Prof. Education] [Ventures] [Life]    ← Pills (in TabbedKanbanBoard)
┌─────────────────────────────────────────────────────────────┐
│ [SmartTaskInput HERE - WRONG]                               │ ← Inside KanbanBoard
├─────────────────────────────────────────────────────────────┤
│ Toolbar (Voice, Select, Show, Filters, AI Create, Schedule) │
│ Kanban columns...                                           │
└─────────────────────────────────────────────────────────────┘
```

**Desired**: SmartTaskInput above the category pills
```
┌─────────────────────────────────────────────────────────────┐
│ [SmartTaskInput - FULL WIDTH - ABOVE PILLS]                 │
├─────────────────────────────────────────────────────────────┤
[Today v] [Career] [Prof. Education] [Ventures] [Life]
│ Toolbar (Voice, Select, Show, Filters, AI Create, Schedule) │
│ Kanban columns...                                           │
└─────────────────────────────────────────────────────────────┘
```

### List View (EnhancedTaskGridView)

**Current**: SmartTaskInput at the very top, above "Task Grid" header
```
┌─────────────────────────────────────────────────────────────┐
│ [SmartTaskInput HERE - WRONG]                               │
├─────────────────────────────────────────────────────────────┤
│ Task Grid                              [Select] [Hide] [Stats]│
│ Manage your tasks in a structured grid view with grouping   │
├─────────────────────────────────────────────────────────────┤
│ Group by: [Category v]  Sort by: [Created v]  [↓ DESC]      │
├─────────────────────────────────────────────────────────────┤
│ Task table...                                               │
└─────────────────────────────────────────────────────────────┘
```

**Desired**: SmartTaskInput between header/description and controls
```
┌─────────────────────────────────────────────────────────────┐
│ Task Grid                              [Select] [Hide] [Stats]│
│ Manage your tasks in a structured grid view with grouping   │
├─────────────────────────────────────────────────────────────┤
│ [SmartTaskInput - CORRECT POSITION]                         │
├─────────────────────────────────────────────────────────────┤
│ Group by: [Category v]  Sort by: [Created v]  [↓ DESC]      │
├─────────────────────────────────────────────────────────────┤
│ Task table...                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Label Improvement

**Current**: `+Assign (0)` - Not intuitive, unclear what it assigns

**New**: `📋 Include Homework (0)` - Clearer that it adds pending assignments/homework to the scheduling context

Alternative options:
- `+ Homework (0)` 
- `Include Assignments (0)`
- `+ Pending Work (0)`

---

## Technical Changes

### 1. SmartTaskInput.tsx - Update Label (Lines 220-225)

Change the label from "+Assign" to something more descriptive:
```tsx
<Label 
  htmlFor="include-assignments" 
  className="cursor-pointer text-xs text-muted-foreground whitespace-nowrap"
>
  + Homework ({selectedAssignmentIds.size})
</Label>
```

Also add a tooltip or title attribute for additional clarity.

### 2. FocusView.tsx - Move SmartTaskInput to Top Row

**Current location**: Lines 388-395 (inside the "Today's Schedule" Card, after CardHeader)

**Move to**: Before the grid div that contains both columns (line 366)

```tsx
return (
  <DragDropContext onDragEnd={handleDragEnd}>
    {/* Smart Task Input - Own row at top */}
    <Card className="mb-4">
      <CardContent className="pt-4">
        <SmartTaskInput 
          tasks={tasks}
          targetDate={today}
          onTaskScheduled={onTaskUpdate}
        />
      </CardContent>
    </Card>
    
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Timeline - 2/3 width on desktop */}
      ...
```

**Remove**: The SmartTaskInput block from lines 388-395 inside the Today's Schedule card.

### 3. TabbedKanbanBoard.tsx - Add SmartTaskInput Above Pills

The category pills are rendered in `TabbedKanbanBoard.tsx` (line 173), but the KanbanBoard component inside each tab has its own SmartTaskInput.

**Solution**: 
1. Add SmartTaskInput import to `TabbedKanbanBoard.tsx`
2. Add SmartTaskInput above the tabs (line 171)
3. Remove SmartTaskInput from `KanbanBoard.tsx` (lines 1028-1037)

```tsx
// TabbedKanbanBoard.tsx
import SmartTaskInput from './SmartTaskInput';

return (
  <div className="space-y-4">
    {/* Smart Task Input - Above category tabs */}
    <Card>
      <CardContent className="pt-4">
        <SmartTaskInput 
          tasks={normalizedTasks}
          targetDate={new Date()}
          onTaskScheduled={onTaskUpdate}
        />
      </CardContent>
    </Card>
    
    <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
      {/* Pills row */}
      <div className="flex items-center gap-1 ...">
        ...
      </div>
      ...
    </Tabs>
  </div>
);
```

### 4. KanbanBoard.tsx - Remove SmartTaskInput

Remove lines 1028-1037:
```tsx
// DELETE THIS BLOCK
{/* Smart Task Input */}
<Card>
  <CardContent className="pt-4">
    <SmartTaskInput 
      tasks={tasks}
      targetDate={new Date()}
      onTaskScheduled={onTaskUpdate}
    />
  </CardContent>
</Card>
```

Also remove the import from line 25.

### 5. EnhancedTaskGridView.tsx - Move SmartTaskInput Below Header

**Current location**: Lines 696-705 (at the very top)

**Move to**: After the header section (line 746) and before the Controls section (line 781)

The new order will be:
1. Header ("Task Grid" title + description + buttons)
2. Bulk Action Bar (if select mode active)
3. **SmartTaskInput (NEW POSITION)**
4. Controls (Group by, Sort by)
5. Grouped Task Grid

### 6. Toolbar Alignment in KanbanBoard.tsx

The user noted the toolbar is right-aligned instead of left-aligned.

**Current** (line 1040):
```tsx
<div className="flex items-center justify-end">
```

**Change to**:
```tsx
<div className="flex items-center justify-start">
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/SmartTaskInput.tsx` | Change "+Assign" label to "+ Homework" |
| `src/components/FocusView.tsx` | Move SmartTaskInput above the grid, wrap in Card |
| `src/components/TabbedKanbanBoard.tsx` | Add SmartTaskInput above the category tabs |
| `src/components/KanbanBoard.tsx` | Remove SmartTaskInput, fix toolbar alignment |
| `src/components/EnhancedTaskGridView.tsx` | Move SmartTaskInput between header and controls |

---

## Expected Results

After implementation:
1. **Focus View**: SmartTaskInput on its own full-width row above both "Today's Schedule" and "Currently Doing" columns
2. **Kanban Board**: SmartTaskInput above the category filter pills (Today, Career, etc.)
3. **List View**: SmartTaskInput below the "Task Grid" title/description and above the "Group by" controls
4. **All Views**: Label changed from "+Assign (0)" to "+ Homework (0)" for clarity
5. **Kanban Toolbar**: Left-aligned instead of right-aligned

