

## Problem Statement

After Clear All + Auto-fill, LIFE tasks still appear in business_hours. We lack visibility into exactly what Clear does, what survives it, and what auto-fill writes back. Current trace logs go to browser console (unreachable on mobile). The auto-fill must remain gap-filling (preserve manual placements).

## Root Causes Found

1. **Clear All relies on the React `tasks` prop** (line 429) — if the prop is stale or incomplete, tasks survive the clear
2. **No post-clear verification** — we never check the DB after clearing to confirm everything was actually reset
3. **All tracing is `console.log`** — invisible when testing on a phone; I can't read it either
4. **Edge function keyword overrides (RULE 2)** conflict with category mappings — "gym" → morning, "mall" → after_work, but LIFE category says after_work/evening. The AI gets confused and picks arbitrary slots

## Changes

### 1. Bulletproof Clear All (`src/components/FocusView.tsx`)

Replace the loop-over-props approach with a single direct DB update + verification:

```typescript
// BEFORE: loops over scheduledToday prop (stale data risk)
for (const task of scheduledToday) { ... }

// AFTER: single DB query targeting all today's tasks
const { data: todayTasks } = await supabase
  .from('tasks')
  .select('id, title, category, start_time, scheduling_context')
  .eq('user_id', user.id)
  .gte('start_time', todayStartUTC)
  .lt('start_time', tomorrowStartUTC)
  .neq('status', 'DONE');

// Batch clear
await supabase.from('tasks').update({
  start_time: null, end_time: null,
  is_scheduled: false, scheduling_context: null
}).in('id', todayTaskIds);

// VERIFY: query DB to confirm zero remaining
const { count } = await supabase.from('tasks')
  .select('id', { count: 'exact' })
  .eq('user_id', user.id)
  .eq('is_scheduled', true)
  .gte('start_time', todayStartUTC)
  .lt('start_time', tomorrowStartUTC);
// Log verification result to error_log
```

### 2. Write traces to `error_log` table (not console)

Move all trace checkpoints (Clear, Auto-fill A-D, Window assignment) to `supabase.from('error_log').insert()` with:
- `component: 'FocusView'`
- `error_type: 'clear_trace' | 'autofill_trace' | 'window_trace