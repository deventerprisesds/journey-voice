
<context>
You’re in Lovable preview (editor) and see “Demo Mode” (so `isDemoMode === true`), but the Kanban tabs show 0 tasks even though the demo user has tasks. This happens because the app currently loads demo-mode tasks exclusively from `localStorage` (`kanban-demo-tasks`). In Lovable preview (an iframe + mobile browser), `localStorage` is frequently empty/partitioned and not where the demo data actually lives.

I verified in the Test Supabase DB that the demo user `00000000-0000-0000-0000-000000000001` already has tasks (count > 0). The UI just isn’t querying Supabase in demo mode, so it renders an empty board.
</context>

<root-cause>
1) `TasksPage.loadTasks()` branches:
   - demo mode => `localStorage.getItem('kanban-demo-tasks')`
   - authenticated => Supabase query

2) In Lovable preview, `localStorage` for the app can be empty or not persistent due to iframe/storage partitioning, so demo mode always “loads” an empty array.

3) Separately, the DB already contains demo tasks (and RLS policies exist to allow anon/public access to demo-user rows), so the correct source of truth in preview should be Supabase, not `localStorage`.
</root-cause>

<solution-overview>
Switch Demo Mode task loading to be Supabase-backed (with optional `localStorage` caching as a fallback), so:
- Opening Lovable preview shows the demo tasks immediately
- Refreshing doesn’t wipe the task list
- Creating tasks in demo mode uses a real UUID `board_id` from Supabase (avoids invalid UUID / “fake board id” issues)

We will not change authenticated behavior.
</solution-overview>

<implementation-steps>
1) Update demo-mode task loading in `src/pages/TasksPage.tsx`
   - Replace the demo branch that reads `localStorage` with a Supabase query:
     - `supabase.from('tasks').select('*').eq('user_id', user.id).order('created_at')`
   - Add clear error vs empty-result logging (optionally using the existing `safeQuery` utility from `src/utils/dbQuery.ts`) so we can distinguish “no tasks” from “query failed”.
   - (Optional but recommended) Keep a small fallback:
     - If Supabase errors, fall back to `localStorage` so preview remains usable even if Supabase is temporarily unavailable.

2) Fix demo-mode creation to persist to Supabase in `src/components/TaskCreationModal.tsx`
   - Today, demo mode creation writes to `localStorage` with `board_id = 'demo-board-1'` (not a UUID), which can’t be persisted in the DB and also doesn’t help preview reload.
   - Implement `getOrCreateDefaultBoardId(userId)` inside this file (or a shared util) that:
     - queries `boards` for `user_id=userId` and `is_default=true`
     - uses `.order('created_at', { ascending: false }).limit(1).maybeSingle()` to safely handle duplicates
     - if none exists, inserts a default board and returns its UUID
   - In `handleCreateTasks` when `isDemoMode`:
     - compute `effectiveBoardId` using the helper above (ignoring empty `boardId`)
     - insert tasks into Supabase (`.insert(tasksWithMeta).select()`)
     - remove the demo-only fake `id: demo-task-...` assignment (let DB generate UUIDs)
   - Keep the earlier UUID crash fix:
     - avoid any `.eq('board_id', boardId)` queries when `boardId` is empty/non-UUID
     - for AI parse “existingTasks”, in demo mode pull existing tasks from Supabase by `user_id` (not `board_id`) so it remains safe and accurate.

3) (Optional but recommended) Prevent demo initialization code from wiping tasks
   - In `src/components/KanbanBoard.tsx`, demo `createDefaultBoardAndColumns()` currently does:
     - `localStorage.setItem('kanban-demo-tasks', JSON.stringify([]))`
   - Change this to “only initialize tasks if missing” (do not overwrite) to prevent accidental task resets for any remaining localStorage demo flows.

4) Verification checklist (what you’ll test in Lovable preview)
   - Navigate to `/tasks?view=kanban`
     - Confirm at least one tab shows a non-zero count (based on demo DB tasks).
   - Use AI Create to add a Career task
     - Confirm it appears immediately under the Career tab without refresh.
   - Refresh the preview
     - Confirm the task remains visible (proves DB-backed demo persistence).
   - Confirm authenticated mode still loads tasks as before.

</implementation-steps>

<expected-result>
- In Lovable preview demo mode, the Kanban board will show the demo user’s tasks (no more “0 tasks” due to empty localStorage).
- New demo tasks created via AI will persist and continue to appear after refresh.
- The earlier “invalid UUID” issue remains fixed because we avoid querying with empty `boardId` and we use a real Supabase board UUID for inserts.
</expected-result>

<files-to-change>
- `src/pages/TasksPage.tsx`
- `src/components/TaskCreationModal.tsx`
- (Optional) `src/components/KanbanBoard.tsx`
- (Optional) create a small shared helper file (e.g., `src/utils/demoData.ts`) if we want to reuse the “get default board id” logic cleanly across components.
</files-to-change>

<notes-for-non-technical>
Right now “Demo Mode” is looking in the browser’s temporary storage for tasks, but in the Lovable preview that storage can be empty. The demo tasks actually exist in the project’s database, so we’ll switch demo mode to load them from the database instead—so they show up reliably every time you open Preview.
</notes-for-non-technical>

<technical-risks-and-mitigations>
- Risk: demo user has multiple default boards, and `.single()`-style queries can error.
  - Mitigation: use `.order(...).limit(1).maybeSingle()` consistently.
- Risk: RLS might block anon reads/writes.
  - Mitigation: confirmed migrations include demo user policies on `boards` and `tasks` (`TO public`).
</technical-risks-and-mitigations>
