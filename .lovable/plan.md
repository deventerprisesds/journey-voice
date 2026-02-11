
# Add "+" Button to Time Window Headers in Focus View

## What You'll See
Each time window (Morning, Business Hours, After Work, Evening) will get a small "+" button in its header row, next to the time range label. Tapping it opens the Task Creation Modal pre-filled with today's date and a start time at the beginning of that window.

## Technical Details

### File: `src/components/FocusView.tsx`

1. **Add state for the modal**: Track whether the creation modal is open and which window triggered it (to pass the correct `initialHour`).

2. **Add "+" button to each window header** (around line 440-448): Insert a small icon button with `Plus` from lucide-react next to the time range text. On click, it sets the target window and opens the modal.

3. **Render `TaskCreationModal`** at the bottom of the component, passing:
   - `initialDate` = today
   - `initialHour` = the window's `start` hour (e.g., 6 for Morning, 9 for Business Hours)
   - `initialMinute` = 0
   - `boardId` and `userId` from the auth context
   - `onTasksCreated` triggers `onTaskUpdate` to refresh the list

4. **Import TaskCreationModal** and the necessary helper to get/create a default board ID.

### No other files change. The TaskCreationModal already supports these pre-population props.
