

## Answer: Reuse `TaskCreationModal`

The **`TaskCreationModal`** (already imported and rendered in `FocusView.tsx` at line 1244) is the correct component. It's used in 4 places across the app:

1. **FocusView** — already wired with `initialDate`, `initialHour`, `initialMinute`
2. **Calendar page** — opens on slot click with date/hour/minute
3. **KanbanBoard** — opens for column-specific task creation
4. **DailyScheduleView** — opens on time slot click

It already supports the exact behavior needed: when `initialHour` and `initialDate` are passed, it auto-switches to the **manual tab** showing the date picker and time-slot grid pre-filled to that time.

## Plan: Wire open slots to existing modal

**File**: `src/components/FocusView.tsx`

**Change 1** — Add `createModalMinute` state (line ~124):
```typescript
const [createModalMinute, setCreateModalMinute] = useState<number>(0);
```

**Change 2** — Open slot click handler (lines ~1006-1024): Add `onClick` to each open slot div that sets hour, minute, and opens the modal:
```typescript
onClick={() => {
  setCreateModalHour(slot.hour);
  setCreateModalMinute(slot.minute);
  setIsCreateModalOpen(true);
}}
```
Style the slot as a tappable grid row with time label + Plus icon.

**Change 3** — Pass `createModalMinute` to the modal (line 1255):
```typescript
initialMinute={createModalMinute}
```

Single file, 3 small edits. The modal already handles everything else.

