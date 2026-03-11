

## Why Tasks Were Placed in Wrong Windows

The root cause is on **line 228** of `batch-calendar-scheduler/index.ts`:

```
1. ${targetDateObj ? `IMPORTANT: Schedule ALL tasks for ${targetDateISO} first. Start from current time if today, or from 9am if future date.` : 'Schedule each task in its preferred time window based on category'}
```

When `nightly-schedule-builder` calls `batch-calendar-scheduler`, it **always passes `targetDate`**, which means `targetDateObj` is always truthy. This triggers the instruction:

> "IMPORTANT: Schedule ALL tasks for [date] first. Start from current time if today, or from 9am if future date."

This tells the AI to **pack everything starting at 9am sequentially**, completely overriding the category-to-window mappings listed further down in the prompt. The AI reads "Schedule ALL tasks for today first" as a higher-priority directive than "CAREER goes in business_hours, LIFE goes in flexible." So it just slots tasks one after another from 9am regardless of category.

Additionally, `allowOverflow: true` (line 200) reinforces this "just fit them all in" behavior.

The category windows ARE listed in the prompt (lines 237-240), but they're presented as soft guidance while the "Schedule ALL" instruction reads as a hard constraint. The AI prioritizes the explicit directive over the category hints.

### Fix: Enforce Window Constraints in the AI Prompt

**File: `supabase/functions/batch-calendar-scheduler/index.ts`**

1. **Rewrite line 228** — Remove the "Schedule ALL tasks first" override. Replace with strict window enforcement:

```
SCHEDULING RULES:
1. STRICT WINDOW ENFORCEMENT: Each task MUST be placed within its category's designated time window. This is a HARD constraint, not a suggestion.
2. KEYWORD OVERRIDE: If a task title contains activity keywords, those override the category window:
   - Shopping/mall/grocery/errands → after_work (5pm-10pm)
   - Email/meeting/call/interview → business_hours (9am-5pm)  
   - Workout/exercise/breakfast → morning (6am-9am)
   - Dinner/family/social → evening (7pm-10pm)
3. NEVER double-book - each task must not overlap with busy slots OR other tasks
4. Higher priority tasks get earlier slots WITHIN their window
5. Respect due dates - schedule before deadline
6. Leave 15-minute buffer between tasks when possible
```

2. **Change the category mappings section** (lines 237-240) from informational to imperative, and include keyword scan examples.

3. **Remove or soften `allowOverflow`** — Instead of telling the AI to cram everything in, let tasks that genuinely don't fit remain unscheduled (to be handled by the bump queue later).

### Summary of Changes

| File | Change |
|------|--------|
| `supabase/functions/batch-calendar-scheduler/index.ts` | Rewrite AI prompt lines 206-256: enforce category windows as hard constraints, add keyword override rules, remove "Schedule ALL first" directive |
| `supabase/functions/nightly-schedule-builder/index.ts` | Change `allowOverflow: true` → `allowOverflow: false` so unschedulable tasks stay in the queue instead of being force-fit into wrong windows |

This is a prompt-only fix in the edge function — no schema changes needed. After deployment, the nightly scheduler (and any manual re-trigger) will respect the window rules.

