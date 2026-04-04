

# Fix Task Duration Spanning + Side-by-Side Double-Bookings

## Two changes in `src/components/FocusView.tsx`

### 1. Fix occupied slot calculation (line 968)

**Current**: `const durationMinutes = task.estimate_minutes || 60;`

**Fix**: Use actual scheduled span from `end_time - start_time`, falling back to `estimate_minutes || 60`:

```ts
const durationMinutes = task.end_time
  ? differenceInMinutes(parseISO(task.end_time), parseISO(task.start_time))
  : (task.estimate_minutes || 60);
```

This ensures a task scheduled 11:00–1:00 PM marks all four 30-min slots as occupied, hiding false "open" slots.

### 2. Side-by-side rendering for overlapping items

Currently, timeline items at the same `sortKey` stack vertically. When two tasks (or a task and an external event) overlap the same time slot, they should render side-by-side.

**Approach**: After sorting the timeline, group consecutive items that share overlapping time ranges. For each overlap group with 2+ items, wrap them in a flex row container (`flex flex-row gap-2`) where each item gets `flex-1 min-w-0` so they share the width equally.

Overlap detection: two items overlap if `startA < endB && startB < endA`. Compute each item's start/end minutes from their time data, then do a single pass to build groups.

## Files changed

| File | Change |
|------|--------|
| `src/components/FocusView.tsx` line 968 | Use `end_time - start_time` for duration instead of `estimate_minutes` |
| `src/components/FocusView.tsx` ~line 1036-1038 | After sorting timeline, group overlapping items and render groups side-by-side in a flex row |

