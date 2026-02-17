

# Add Priority Page Ordering to AI Context

## What This Does

When you drag-and-drop topic groups on the Priorities page, that order will be saved to the database and used by the AI when presenting topics during calls. Currently, drag order only lives in localStorage and the AI uses its own algorithm (recency > priority density > task count). After this change, your manual ordering takes precedence.

## Changes

### 1. Database Migration

Add a `position` column to `task_topic_index`:

```sql
ALTER TABLE task_topic_index ADD COLUMN position integer DEFAULT 0;
```

This defaults to 0, so existing topics keep working with the current algorithm until you manually reorder them on the Priorities page.

### 2. Priorities Page -- Persist Drag Order to Database

**File: `src/pages/Priorities.tsx`**

When topic groups are reordered (within same category or cross-category), in addition to saving to localStorage, write positions to the database:

- **Within-category reorder (line 425-435):** After the splice/reorder, batch-update all groups in that category with their new position index.
- **Cross-category move (line 436-487):** After moving the group, batch-update positions for both the source and destination category groups.

```typescript
// Helper function to persist positions
const persistPositions = async (groups: TopicGroupData[]) => {
  const updates = groups.map((g, i) => 
    supabase.from('task_topic_index').update({ position: i }).eq('id', g.id)
  );
  await Promise.all(updates);
};
```

Called after every drag-end that involves groups.

### 3. AI Ranking -- Use Position as Primary Sort

**File: `supabase/functions/_shared/call-context-builder.ts`**

Update `getTopicGroupsManual` to:

1. Fetch the `position` column alongside `id, topic_name, topic_summary` (line 234)
2. Include `position` in the results object (line 255)
3. Update the sort (line 264) to:

```typescript
results.sort((a, b) =>
  a.position - b.position ||
  b.priority_density - a.priority_density ||
  b.recency - a.recency ||
  b.task_count - a.task_count
);
```

Sort order: **user position** (lower = higher priority) then priority density then recency then task count.

Since all existing topics default to `position: 0`, they will tie on position and fall through to the existing algorithm -- no behavior change until you manually reorder.

## Files Changed

| File | Change |
|------|--------|
| Migration SQL | Add `position integer DEFAULT 0` to `task_topic_index` |
| `src/pages/Priorities.tsx` | Persist drag-and-drop positions to database via batch update |
| `supabase/functions/_shared/call-context-builder.ts` | Fetch `position`, sort by it first in ranking algorithm |

## Deployment

1. Run migration (add column)
2. Deploy `twilio-realtime-bridge` (picks up ranking change via shared module)
3. Reorder topics on Priorities page to set positions
4. Next call will reflect your ordering

## Technical Notes

- The `position` column uses absolute indices (0, 1, 2...) per category, matching how `localStorage` already tracks order
- Batch updates use `Promise.all` for speed -- one small update per group in the reordered category
- No rollback flag needed here -- default `0` means the existing algorithm controls until you manually set positions
