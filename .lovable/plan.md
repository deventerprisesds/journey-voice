

# Root Cause: `validateTaskWindow` Treats "flexible" as a Free Pass

## The actual bug

Every scheduling path in the app (batch-calendar-scheduler, smart-calendar-scheduler, execute-tool, nightly-schedule-builder) calls `validateTaskWindow` from `_shared/scheduling-defaults.ts` as its safety net. This function has one critical flaw on **line 92-93**:

```typescript
if (allowedWindows.includes('flexible')) {
  return { valid: true, actualWindow, allowedWindows };
}
```

This means: if a category's `defaultTimeWindow` includes `flexible`, **any hour is valid** — including 3 AM, 11 PM, midnight. It never checks that the task hour falls within the `flexible` window's actual range (9 AM – 10 PM).

Categories mapped to `flexible` in defaults: **LIFE, PERSONAL, EDUCATION**. These are exactly the categories getting placed at absurd hours.

Additionally, the nightly builder's `getActiveWindows` correctly skips `flexible` as a real window (line 61: `if (name === 'flexible') continue`), so it does capacity math correctly. But the batch scheduler's AI prompt still presents `flexible: 9am-10pm` as a suggestion — and when the AI ignores it and returns 3 AM, the validator waves it through.

## What the existing system already does right

The scoring, priority board boost, keyword detection, dedup, window capacity math, and day-of-week filtering in the nightly builder are all correct and aligned with `SCHEDULING_RULES.md`. The problem is not in candidate selection — it is in the **post-placement validation** letting invalid times through, and the AI sometimes ignoring the prompt constraints.

## What needs to change (minimal, targeted)

### 1. Fix `validateTaskWindow` in `_shared/scheduling-defaults.ts`

When `allowedWindows` includes `flexible`, instead of returning `valid: true` unconditionally, check that the task hour falls within the `flexible` window's actual hours:

```typescript
if (allowedWindows.includes('flexible')) {
  const flexWindow = timeWindows['flexible'];
  if (flexWindow && (taskHour < flexWindow.start || taskHour >= flexWindow.end)) {
    return { valid: false, actualWindow: null, allowedWindows };
  }
  return { valid: true, actualWindow: actualWindow || 'flexible', allowedWindows };
}
```

Also add a blanket guard: if `actualWindow` is `null` AND the task hour is outside all defined windows, it's always invalid regardless of category.

This single fix propagates to all 4 scheduling paths that call it.

### 2. Add activity-aware context to the AI prompt in `batch-calendar-scheduler`

The AI prompt already has window rules, but it doesn't get the keyword-to-context hints that exist in `schedulingRules.ts`. Add a short section to the prompt:

```text
ACTIVITY CONTEXT HINTS:
- Gym/workout/exercise → schedule in morning window (6-9am weekdays) or early weekends
- Bank/post office/doctor → business hours only (9-5 weekdays)
- Dinner/family/social → evening window (7-10pm)
- Study/homework → after_work or weekends, never morning
```

This uses AI reasoning constructively (understanding what "gym" means) while the hard validator catches any mistakes.

### 3. Update `SCHEDULING_RULES.md` with the validator fix

Add a section documenting that `flexible` is **not** a bypass — it means "any named window within 9 AM – 10 PM" and the validator enforces this.

## Files changed

| File | Change |
|------|--------|
| `supabase/functions/_shared/scheduling-defaults.ts` | Fix `validateTaskWindow` to enforce `flexible` window hours |
| `supabase/functions/batch-calendar-scheduler/index.ts` | Add activity-context hints to AI prompt |
| `docs/SCHEDULING_RULES.md` | Document that `flexible` is not a free pass |

## Why this won't branch further

- The fix is in the **shared validator** that all paths already call — no new paths, no new abstractions.
- The nightly builder's candidate selection and scoring logic is untouched (it's already correct).
- The AI prompt addition is additive context, not a logic change.
- The `SCHEDULING_RULES.md` update documents existing intent, not new rules.

## Checklist (per SCHEDULING_RULES.md)

1. **Authoritative path**: `_shared/scheduling-defaults.ts` — the single validator all paths use
2. **Affected views**: All views that display scheduled tasks (Focus, Daily, Weekly, Agenda)
3. **Coverage**: nightly builder ✓, fill gaps ✓, manual scheduling ✓, display filtering (unchanged)
4. **Assignments**: Untouched — scoring still prioritizes assignment-linked tasks
5. **Timezone**: Untouched — validator already uses timezone-aware hour extraction
6. **Verification**: Deploy, trigger a test schedule, check edge function logs for any rejected placements

