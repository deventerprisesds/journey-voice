

# Status Check: Priority Lane UX — What's Done vs What's Missing

## Done (implemented)

| Item | Status |
|------|--------|
| `is_priority` boolean column on `tasks` table | Done (migration deployed) |
| `is_priority` in Task TypeScript interface | Done |
| Client-side scoring: `is_priority` +12 boost | Done (`schedulingCandidates.ts` line 47) |
| Server-side scoring: `is_priority` +12 boost | Done (`nightly-schedule-builder` line 726) |
| Topic-mapped boost reduced from +10 to +2 | Done (both client and server) |
| Recency boost (+2 for ≤3 days, +1 for 4-7 days) | Done (both client and server) |
| Urgency ladder (48h = +5, 3-7 days = +3) | Done (both client and server) |
| Auto-classify tasks on create/update (DB trigger) | Done (trigger `notify_task_topic_classification` fires on INSERT/UPDATE) |
| Build error fix (Assignments.tsx stripping client-only fields) | Done |

## NOT built yet

| Item | Detail |
|------|--------|
| `priority_rank` column | No migration, no column in DB |
| `priority_rank` in Task interface | Not added |
| "My Priorities" lane component (`PriorityLane.tsx`) | Does not exist |
| Drag-into-lane from category columns | No handler in `Priorities.tsx` |
| Reorder within lane (updates rank) | Not implemented |
| Drag-out / remove from lane | Not implemented |
| Rank-aware scoring (replace flat +12 with `10 + max(5 - rank, 0)`) | Still flat +12 |
| Mobile swipe-to-prioritize gesture | Not implemented |
| Star icon badge on priority tasks across views | Not implemented |

## Plan: Build the missing pieces

### 1. Database migration
```sql
ALTER TABLE tasks ADD COLUMN priority_rank integer DEFAULT null;
```

### 2. Type update -- `src/types/task.ts`
Add `priority_rank?: number | null` to the Task interface.

### 3. Scoring update -- both locations
Replace `if (task.is_priority) score += 12` with:
```
score += task.is_priority ? 10 + Math.max(5 - (task.priority_rank ?? 0), 0) : 0;
```
This gives: Rank 0 = +15, Rank 1 = +14, ..., Rank 5+ = +10 (floor). A non-priority task maxes out around +14 from all other signals combined, so even the lowest-ranked priority item (+10 base) plus its own signals will always outrank non-priority.

Applied in:
- `src/lib/schedulingCandidates.ts`
- `supabase/functions/nightly-schedule-builder/index.ts`

### 4. New component -- `src/components/priorities/PriorityLane.tsx`
- Full-width horizontal lane above category columns
- Renders tasks where `is_priority = true`, ordered by `priority_rank`
- Each card shows star badge, task title, priority pill, remove (x) button
- When empty: "Drag tasks here to prioritize" placeholder
- Droppable target using existing `@hello-pangea/dnd`

### 5. Update `src/pages/Priorities.tsx`
- Query `is_priority` tasks on load, ordered by `priority_rank`
- Render `PriorityLane` above category columns inside existing `DragDropContext`
- Handle three drag flows:
  - **Category to Lane**: set `is_priority = true`, assign `priority_rank` at drop index, re-index all lane items
  - **Lane reorder**: re-index all `priority_rank` values, batch update
  - **Lane to Category / remove button**: set `is_priority = false`, `priority_rank = null`, re-index remaining
- Batch persist via Supabase after every change

### 6. Mobile swipe gesture
- Touch event handlers on task cards in category columns and in the `TaskRow` component
- Right-swipe past 80px reveals star icon overlay
- On release: adds task to bottom of priority lane, persists

### 7. Star badge across views
- Show a small star icon on priority tasks in Kanban, task grid, daily schedule, and assignment views by checking `is_priority` on the task object

### Files changed

| File | Change |
|------|--------|
| Migration SQL | Add `priority_rank` column |
| `src/types/task.ts` | Add `priority_rank` field |
| `src/components/priorities/PriorityLane.tsx` | New component |
| `src/pages/Priorities.tsx` | Integrate lane, drag handlers, swipe, load priority tasks |
| `src/components/priorities/CategoryColumn.tsx` | Add swipe gesture to `TaskRow` |
| `src/lib/schedulingCandidates.ts` | Rank-aware scoring |
| `supabase/functions/nightly-schedule-builder/index.ts` | Rank-aware scoring + query `priority_rank` |
| `src/components/TaskCard.tsx` | Star badge for `is_priority` tasks |

