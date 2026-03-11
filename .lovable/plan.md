

## Problem Confirmed

From the latest run (March 11, 2026 — a Wednesday):

| VENTURES Task | Scheduled (ET) | Correct? |
|---|---|---|
| Answer all business emails | 10:00 AM | Yes (keyword override: "email" → business_hours) |
| Update on entrepreneurial consulting... | 6:00 PM | **Wrong** — after_work, not business_hours |
| Meet with potential entrepreneurial partner | 7:00 PM | **Wrong** — after_work, not business_hours |

Your settings say VENTURES → `weekends or business_hours`. On a Wednesday, `weekends` is irrelevant, so the only valid window is `business_hours` (9am-5pm). The AI ignored this and placed them at 6-7 PM.

**Two root causes in `supabase/functions/batch-calendar-scheduler/index.ts`:**

1. **Line 196**: Per-task line says `"prefer"` — the AI treats this as optional
2. **No day-of-week filtering**: On a Wednesday, `weekends` is still listed as a valid option, confusing the AI. When business_hours fills up, the AI picks any available slot instead of reporting overflow.

## Changes — `supabase/functions/batch-calendar-scheduler/index.ts`

### A. Add day-of-week filtering (~line 164, after `userCategoryMappings`)

Determine if target date is a weekday or weekend. For each category, filter out inapplicable windows:
- Weekday → remove `weekends`
- Weekend → remove `morning`, `business_hours`, `after_work`
- If all windows filtered out → fall back to `flexible`

```typescript
const dayOfWeek = targetDateObj.getDay(); // 0=Sun, 6=Sat
const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

// Filter windows applicable to this day
const filteredCategoryMappings: Record<string, any> = {};
for (const [cat, mapping] of Object.entries(userCategoryMappings)) {
  const wins = Array.isArray(mapping.defaultTimeWindow) 
    ? mapping.defaultTimeWindow : [mapping.defaultTimeWindow];
  const validWins = wins.filter((w: string) => {
    if (isWeekend && ['morning', 'business_hours', 'after_work'].includes(w)) return false;
    if (!isWeekend && w === 'weekends') return false;
    return true;
  });
  filteredCategoryMappings[cat] = {
    ...mapping,
    defaultTimeWindow: validWins.length > 0 ? validWins : ['flexible'],
  };
}
```

Use `filteredCategoryMappings` everywhere instead of `userCategoryMappings`.

### B. Change "prefer" to "MUST use" (line 196)

```
// Before
(prefer ${catInfo.windows}: ${catInfo.hours})
// After  
(MUST schedule within ${catInfo.windows}: ${catInfo.hours})
```

### C. Strengthen overflow instruction in RULE 1 (~line 265)

Add after the existing RULE 1 text:
```
If a category's required window is fully booked, DO NOT place the task in a different window. Instead, mark it with reasoning "OVERFLOW - no available slot in required window" and schedule it for the next valid day.
```

### Files Modified
- `supabase/functions/batch-calendar-scheduler/index.ts` — day-of-week filtering, strict prompt language, overflow handling

