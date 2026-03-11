

## Diagnosis

### 1. Traces are completely broken (0 rows written)
The `writeTrace` function at line 425 does `await supabase.from('error_log').insert({...})` but never checks the response `error` object. Supabase returns `{ data, error }` — if there's an error, it's silently swallowed by the outer try/catch which only catches thrown exceptions. We have ZERO visibility into what's happening.

### 2. Duplicates are the #1 problem
Current DB duplicates (non-DONE tasks):
- "Test Task - Due in 5 minutes" × 6
- "Plan the week" × 4
- "Go to gym" × 3
- "Go to Arundel Mills mall" × 3
- "Pay off credit cards" × 2
- "Go to church" × 2

Auto-fill has NO dedup guard. It sends ALL copies to the scheduler. With 20+ tasks (many duplicates), the after_work+evening window (5pm-10pm = 5 hours) can't fit them all. The AI is forced to place overflow tasks earlier, landing LIFE tasks in business_hours. The prompt says "mark as OVERFLOW" but the AI isn't reliably doing this with a massive task list.

### 3. User config IS correct
The user's `user_scheduling_prefs.config` has `LIFE: ['after_work', 'weekends', 'evening']`. On a weekday this filters to `['after_work', 'evening']`. The prompt correctly says "MUST schedule within after_work or evening." The AI violates this because there are too many tasks for the window — duplicates are the root cause.

## Changes

### A. Fix writeTrace to actually work (`FocusView.tsx`)
Check the Supabase response error and log failures:
```typescript
const { error } = await supabase.from('error_log').insert({...});
if (error) console.warn('[TRACE] DB write failed:', error.message);
```

### B. Add dedup guard in auto-fill (`FocusView.tsx` ~line 620)
Before sending to scheduler, deduplicate by normalized title — keep only the highest-scored instance of each title:
```typescript
const seenTitles = new Map();
const dedupedCandidates = scored.filter(t => {
  const key = t.title.toLowerCase().trim();
  if (seenTitles.has(key)) return false;
  seenTitles.set(key, t.id);
  return true;
});
const topCandidates = dedupedCandidates.slice(0, 25);
```
Since `scored` is already sorted by score desc, the first instance of each title is the highest-scored one.

### C. Create TaskCleanupSettings component (new file)
- "Scan for Duplicates" button queries tasks grouped by `(title, user_id)` having count > 1
- Compact results list: title, count, category
- Each row expandable to show individual entries (id, status, created_at, start_time)
- Radio select to pick which to keep
- "Delete Others" button with confirmation dialog
- Toast with deletion count

### D. Add "Tasks" tab to Settings (`Settings.tsx`)
- New tab entry: `{ value: 'tasks', label: 'Tasks', icon: ListChecks }`
- TabsContent renders `<TaskCleanupSettings />`

### Files Modified
- `src/components/FocusView.tsx` — fix writeTrace + add dedup guard
- `src/components/TaskCleanupSettings.tsx` — new component
- `src/pages/Settings.tsx` — add Tasks tab

