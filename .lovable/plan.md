

# Why Assignment Tasks Aren't Being Created — Root Cause Analysis

## What the data shows

- **469 assignments** exist across both tables (345 EMBA + 124 MIT)
- **427 are skipped** every sync run, **0 created**
- Only **3 tasks** in the entire database have `assignment_id` set (all DONE)
- Upcoming assignments due Apr 9-24 have **zero linked tasks** — confirmed by querying for titles like "Bullard Houses" and "Zeta Energy"

## Why wasn't this caught before?

This bug has existed **since the function was first written**. It was never caught because:

1. The first 3 tasks with `assignment_id` were likely created by a different code path (manual creation or an earlier version of the sync), not by this function
2. The function reports `status: completed` with `skipped_count: 427` — it looks like a successful run. There are no error logs. The skip is silent because the broken `.or()` query returns results (false positives from malformed filter syntax) rather than throwing an error
3. The nightly cron invokes it, it "succeeds", and moves on. Nobody noticed 0 creates because the activity log just shows counts — it never logged warnings about unexpected skip rates

## The actual bug (line 82)

```typescript
.or(`title.eq.${assignment.title},title.eq.📚 ${assignment.title}`);
```

PostgREST uses commas as delimiters inside `.or()`. When a title contains a comma (e.g., `"Deficits and Debt: The U.S. Current Account"`), the filter breaks apart into malformed fragments. Some fragments match unrelated tasks, producing false positives that cause the assignment to be skipped. Since most assignment titles contain colons, commas, or parentheses, nearly all 469 assignments hit this path and get incorrectly skipped.

## The fix

Replace the unsafe `.or()` with two separate `.eq()` queries:

```typescript
const { data: exactMatch } = await supabase
  .from('tasks')
  .select('id, title, status')
  .eq('user_id', userId)
  .is('assignment_id', null)
  .is('completed_at', null)
  .not('status', 'eq', 'DONE')
  .eq('title', assignment.title)
  .limit(1);

const { data: emojiMatch } = !exactMatch?.length 
  ? await supabase
      .from('tasks')
      .select('id, title, status')
      .eq('user_id', userId)
      .is('assignment_id', null)
      .is('completed_at', null)
      .not('status', 'eq', 'DONE')
      .eq('title', `📚 ${assignment.title}`)
      .limit(1)
  : { data: null };

const titleMatches = [...(exactMatch || []), ...(emojiMatch || [])];
```

Also add a warning log when skip rate is abnormally high (>90%) to catch similar issues in the future.

## After fix: trigger manual sync

Once deployed, invoke the function manually to create tasks for all upcoming assignments. This will populate the Focus View, Weekly Agenda, and scheduling pipeline with the ~40+ assignments due in the next 3 weeks.

## Files changed

| File | Change |
|------|--------|
| `supabase/functions/nightly-assignment-sync/index.ts` | Replace unsafe `.or()` with two safe `.eq()` queries; add high-skip-rate warning log |

One edge function redeployed, then triggered manually.

