
# Fix Assignment Linkage at the Root

## What’s actually broken

The issue is not that `assignment_id` is hard to use. The issue is that existing assignment creation flows are failing to populate it consistently, then newer code is compensating with `scheduling_context` string parsing.

From the current code:

- `src/utils/assignmentSync.ts` creates assignment tasks but does **not** write `tasks.assignment_id`
- MIT tasks are stored only as `mit_assignment_id:...` inside `scheduling_context`
- `src/pages/Assignments.tsx` loads only tasks where `assignment_id` is present, so imported tasks disappear
- `supabase/functions/nightly-assignment-sync/index.ts` and `nightly-schedule-builder` both treat overdue assignment tasks as `DONE` + set `completed_at`, which makes incomplete assignments look submitted

So yes: the correct fix is to repair the existing bad development, not build more fallback logic on top of it.

## Implementation plan

### 1. Make assignment task creation always populate real linkage fields
Update the existing assignment task creation paths so they write the relational field directly:

- `src/utils/assignmentSync.ts`
  - EMBA: insert `assignment_id: assignment.id`
  - MIT: also link into the same `tasks.assignment_id` field using the MIT row id, and include a clear source marker in `scheduling_context`
- `src/components/TaskCreationModal.tsx`
  - When creating tasks from selected assignments, persist `assignment_id` on insert instead of only embedding it in `scheduling_context`

Result:
- the app stops depending on string parsing as the primary linkage
- Assignments page, scheduler, and sync jobs can all use one consistent field

### 2. Unify how the app identifies assignment source
Because both EMBA and MIT currently feed into `tasks.assignment_id`, source must be explicit and consistent.

Update existing metadata to standardize:
- `scheduling_context.source = 'EMBA' | 'MIT'`
- stop using two different conventions like:
  - `assignment_id:...`
  - `mit_assignment_id:...`

Keep source info only for program/source classification, not as the primary link.

### 3. Repair existing tasks with null `assignment_id`
Add a targeted repair path for already-created tasks so the old bad data is corrected instead of worked around forever.

Repair logic should:
- scan assignment-derived tasks with `assignment_id IS NULL`
- recover the correct assignment row using existing stored metadata:
  - EMBA from `assignment_id:...` in `scheduling_context`
  - MIT from `mit_assignment_id:...`
  - only if needed, fallback to exact title + due date matching
- update the task row to populate real `assignment_id`
- normalize `scheduling_context.source`

This is the step that fixes the historical damage rather than masking it.

### 4. Stop auto-marking overdue assignments as completed
Update:
- `supabase/functions/nightly-assignment-sync/index.ts`
- `supabase/functions/nightly-schedule-builder/index.ts`

Change behavior so overdue assignments:
- remain open
- keep overdue styling
- are never marked `DONE` unless the user actually completes them
- never get `completed_at` from automation

If archival is still needed later, use an archive marker in metadata without faking completion.

### 5. Make the Assignments page read repaired data, not assume broken data
Update `src/pages/Assignments.tsx` so it uses the now-correct linkage model:

- load assignment-linked tasks by real `assignment_id`
- classify EMBA vs MIT using normalized source metadata
- treat `completed_at` as the only true “Submitted” signal
- stop relying on incomplete EMBA-only mapping assumptions

This should become simpler after the linkage repair, not more complex.

### 6. Fix import behavior to support the intended lifecycle
Your requirement is clear:
- first run = mass import from sheets
- later runs = compare rows and apply additions/changes only

Update:
- `supabase/functions/sync-google-sheets/index.ts`
- `supabase/functions/sync-mit-sheets/index.ts`

Change them to:
- support full import on first run
- compare by `sheet_row_number` per program on later runs
- update changed title/date/details rows instead of skipping them
- stop relying on narrow time windows for initial population

The existing weekend / 14-day filters are the wrong behavior for assignment management.

## Files to change

- `src/utils/assignmentSync.ts`
- `src/components/TaskCreationModal.tsx`
- `src/pages/Assignments.tsx`
- `supabase/functions/sync-google-sheets/index.ts`
- `supabase/functions/sync-mit-sheets/index.ts`
- `supabase/functions/nightly-assignment-sync/index.ts`
- `supabase/functions/nightly-schedule-builder/index.ts`

## Expected outcome

After this fix:

- assignment tasks will no longer be created with null `assignment_id`
- old broken tasks will be repaired instead of hidden behind fallback logic
- EMBA and MIT assignments will both appear reliably
- overdue assignments will stay visible as overdue, not fake-submitted
- the Assignments page can use the actual relational model instead of compensating for past mistakes

## Technical details

```text
Current bad state:
sheet row -> assignments / assignments_mit
          -> task created
          -> assignment_id often NULL
          -> source hidden in scheduling_context strings
          -> page filters by assignment_id
          -> counts collapse to 0

Target state:
sheet row -> assignments / assignments_mit
          -> task created/updated
          -> assignment_id always populated
          -> source stored consistently
          -> overdue stays overdue
          -> page reads linked tasks directly
```

## Validation before calling it fixed

1. Sync EMBA first run → imported rows create/update assignment-linked tasks with non-null `assignment_id`
2. Sync MIT first run → same result
3. Re-run sync without changes → no duplicates
4. Change sheet row title/date → existing assignment and linked task update
5. Existing broken tasks get repaired and start appearing in counts
6. Overdue incomplete assignments show as overdue, not submitted
