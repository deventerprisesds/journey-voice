

# Fix Default Tab and Collapsed Accordions on Assignments Page

## Problems

1. **"All" tab is leftmost and partially hidden** — on mobile (411px), the status tab bar overflows left, cutting off the "All" pill
2. **Default tab is "all"** — should default to "due_next" since that's the most actionable view
3. **Course accordions auto-open** — the `useEffect` on line ~249 opens all courses by default; they should start collapsed

## Changes

**File: `src/pages/Assignments.tsx`**

| Change | Detail |
|--------|--------|
| Default `statusTab` | Change initial state from `'all'` to `'due_next'` (line 47) |
| Remove "All" tab or move it to end | Move the "All" TabsTrigger to the last position in the tab bar so "Due Next" is leftmost and fully visible |
| Collapse accordions by default | Change the `useEffect` that sets `openCourses` to initialize with an empty `Set()` instead of opening all courses |

