

## Plan: Expand Auto-fill Candidates to Include TODO Tasks

### Root Cause
Tasks scheduled before the status preservation deploy had no `scheduling_context.pre_schedule_status`. On clear, they fell back to `TODO` (already overwritten by scheduler). Auto-fill then skips them because it only looks for `READY`/`UP_NEXT` + priority board tasks.

### Fix — `src/components/FocusView.tsx`

**Expand the READY/UP_NEXT query (lines 455-461)** to also include `TODO`:

```typescript
.in('status', ['READY', 'UP_NEXT', 'TODO'])
```

This ensures cleared tasks (now `TODO`) are picked back up by auto-fill. It also makes sense conceptually — `TODO` is a valid triage state for schedulable work.

**Remove the redundant `.neq('status', 'DONE')` on line 460** — already covered by the `.in()` filter.

### Files Modified
- `src/components/FocusView.tsx` — one line change to widen candidate status filter

