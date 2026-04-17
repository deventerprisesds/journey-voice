
The user is right. My previous QC was wrong because I queried the DB directly with my *own* SQL, not the actual code path the modal uses. I need to replicate the exact data path: `useUnifiedTasks` → `dailyReviewPipeline` → modal counts.

## What the modal actually does (traced from code)

1. `FocusView` calls `useUnifiedTasks()` which:
   - Queries `tasks` where `user_id = current_user`
   - Queries `tasks_with_schedule` view where `user_id = current_user AND from_history = true AND scheduled_date < todayStr`
   - Merges both into one array (live + history rows, history rows get `_fromHistory: true`)
2. Passes merged array as `tasks` prop to `DailyReviewModal`
3. Modal calls `buildDailyReviewReasoning(tasks, todayStr, timezone)` 
4. Pipeline filters `todayTasks = tasks.filter(t => t.start_time && t.start_time.startsWith(todayStr))`
5. Counts derived from `todayTasks` with new clamps

The bug: `tasks_with_schedule` view rows can have `start_time` that starts with today's date if the historical snapshot was for a task that was once scheduled today. Those rows ALSO have lifetime `pushed_count`. So `todayTasks` gets contaminated with history rows.

## QC plan — replicate exact modal path

I need to run the **exact same two queries** that `useUnifiedTasks` runs, merge them the same way, then run the **exact same filter logic** from `dailyReviewPipeline`, and confirm the output matches what the user sees in the UI (171 / 39).

### Step 1: Replicate `useUnifiedTasks` queries
- Query A: `SELECT * FROM tasks WHERE user_id = 'a3378f93-...' ORDER BY created_at DESC`
- Query B: `SELECT * FROM tasks_with_schedule WHERE user_id = 'a3378f93-...' AND from_history = true AND scheduled_date < '2026-04-17'`
- Merge per the dedup logic in the hook

### Step 2: Apply the new pipeline filters exactly
- `todayTasks` = merged where `start_time LIKE '2026-04-17%'`
- `rolledOverIds` = `todayTasks` where `pushed_count > 0 AND updated_at >= now() - 36h`
- `overdueIds` = merged where `due_date::date < '2026-04-17' AND id IN todayTasks` (intersected)
- `backlogOverdueIds` = merged where status != DONE AND due_date::date < '2026-04-17'

### Step 3: Compare to screenshot
- Screenshot shows: 171 rolled over, 39 overdue
- If my replicated path returns 171/39 → confirms history-merge contamination is the live root cause and the new clamp isn't reaching the UI (stale bundle OR clamp not effective against history rows)
- If my replicated path returns 9/1 → confirms bundle is stale on user's device
- If it returns something else → there's a third source I haven't traced

### Step 4: Check build version on published site
- Read `index.html` from `https://journey-voice.lovable.app` to extract the deployed `<meta name="build-version">` or bundle hash
- Compare to current source to confirm publish actually shipped the new code

## Implementation

This is a read-only investigation, no file changes. I'll use:
- `supabase--read_query` to run the two exact queries and the pipeline filters as SQL
- `code--fetch_website` on the published URL to grab the live HTML/bundle hash
- Report back: exact UI numbers I derived from the exact code path, plus whether the published bundle contains the new logic

Then we'll know definitively whether the issue is (a) stale bundle, (b) history contamination bypassing the clamp, or (c) something else entirely. No fix proposed in this round — just honest QC that mirrors what you see.
