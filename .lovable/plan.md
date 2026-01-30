

## Central Timezone Fix for Task Scheduling

### Problem Summary
You're experiencing two issues:
1. **Scheduled date shows as yesterday** - Tasks set for "today" display with yesterday's date
2. **Wrong time slots** - "Eat lunch" was scheduled at 6am instead of noon

### Root Cause Analysis

After inspecting the database and code, here's what's happening:

**Why dates appear as "yesterday":**
- The system stores `due_date` as a date-only string like `"2026-01-29"`
- Postgres interprets this as midnight UTC (`2026-01-29 00:00:00+00`)
- For US Eastern timezone (UTC-5), midnight UTC is actually 7pm the previous evening
- Result: January 29 UTC displays as January 28 in your local time

**Why "Eat lunch" was at 6am:**
- The AI scheduler returned `"2026-01-30T11:00:00"` meaning "11am local"
- Without a timezone offset, the system stored it as 11:00 UTC
- 11:00 UTC = 6:00 AM Eastern Time

**Database evidence:**
```
Transfer $40,000 → due_date: 2026-01-29 00:00:00+00 (displays as Jan 28 in ET)
Eat lunch → start_time: 2026-01-30 11:00:00+00 (displays as 6am in ET)
```

---

### Solution: Central Timezone Normalization

We'll create a single timezone utility that ALL scheduling code uses, ensuring consistent behavior everywhere.

---

### Implementation Steps

#### Step 1: Create Shared Timezone Utility
**File:** `supabase/functions/_shared/timezone.ts` (new)

```text
┌─────────────────────────────────────────────────────────────┐
│  Timezone Normalization Functions                           │
├─────────────────────────────────────────────────────────────┤
│  normalizeDueDate(input, tz)                                │
│    - "2026-01-29" → end-of-day in user's tz → UTC ISO       │
│    - Returns: "2026-01-30T04:59:59.999Z" (for ET)           │
│                                                             │
│  normalizeDateTime(input, tz)                               │
│    - "2026-01-29T12:00:00" → treat as local → UTC ISO       │
│    - Returns: "2026-01-29T17:00:00Z" (for ET noon)          │
│                                                             │
│  getTzOffsetMinutesAt(date, tz)                             │
│    - Gets offset for specific timezone at specific moment   │
│    - Handles DST automatically                              │
└─────────────────────────────────────────────────────────────┘
```

#### Step 2: Fix Task Creation (execute-tool)
**File:** `supabase/functions/execute-tool/index.ts`

**Changes:**
- Import shared timezone utility
- In `parseAndCreateTasks`:
  - Normalize `due_date` through `normalizeDueDate(task.due_date, userTimezone)`
  - Normalize scheduled `start_time`/`end_time` through `normalizeDateTime()`
- Add rule: If `due_date` was auto-inferred (not explicitly set by user), sync it to match scheduled date

**Before:**
```typescript
due_date: task.due_date  // "2026-01-29" stored as midnight UTC
```

**After:**
```typescript
due_date: normalizeDueDate(task.due_date, userTimezone)  
// "2026-01-29" → "2026-01-30T04:59:59.999Z" (end of Jan 29 in ET)
```

#### Step 3: Fix Batch Calendar Scheduler
**File:** `supabase/functions/batch-calendar-scheduler/index.ts`

**Changes:**
A) **Harden the AI prompt** - Require explicit timezone offsets:
```
Return ISO 8601 with timezone offset. Examples:
- "2026-01-30T12:00:00-05:00" (noon Eastern)
- "2026-01-30T17:00:00Z" (noon Eastern as UTC)
```

B) **Add post-processing safety net** - Normalize ALL times from AI:
```typescript
// After parsing AI response
result.start_time = normalizeDateTime(result.start_time, timezone);
result.end_time = normalizeDateTime(result.end_time, timezone);
```

This ensures "11:00" is correctly interpreted as 11am local → stored as UTC.

#### Step 4: Fix Reschedule Tool Path
**File:** `supabase/functions/execute-tool/index.ts`

In `rescheduleTask`:
- Currently sets `start_time = "${new_date}T${new_start_time}"` (naive)
- Change to use `normalizeDateTime()` before storing
- Ensure `due_date` updates also go through `normalizeDueDate()`

#### Step 5: Fix "Today" Tab Filter
**File:** `src/components/TabbedKanbanBoard.tsx`

**Current logic:**
```typescript
// Only checks due_date
task.due_date && isToday(parseISO(task.due_date))
```

**Updated logic:**
```typescript
// Check BOTH due_date AND scheduled date
const isDueToday = task.due_date && isToday(parseISO(task.due_date));
const isScheduledToday = task.start_time && isToday(parseISO(task.start_time));
return isDueToday || isScheduledToday || isActiveStatus;
```

This ensures tasks scheduled for today appear in the Today tab even if due_date differs.

---

### Files to Change

| File | Change |
|------|--------|
| `supabase/functions/_shared/timezone.ts` | **New** - Central timezone utilities |
| `supabase/functions/execute-tool/index.ts` | Normalize dates in task creation/update |
| `supabase/functions/batch-calendar-scheduler/index.ts` | Normalize AI-returned times |
| `src/components/TabbedKanbanBoard.tsx` | Include scheduled-today tasks in Today tab |

---

### Expected Results After Fix

| User Input | Due Date (stored) | Displays As |
|------------|-------------------|-------------|
| "Today I need to email Craig" | 2026-01-30T04:59:59Z | Jan 29 ✅ |
| "Tomorrow call financial aid" | 2026-01-31T04:59:59Z | Jan 30 ✅ |
| "Eat lunch" (auto-scheduled) | start_time: noon local → correct UTC | 12:00 PM ✅ |

---

### Why This is the "Central Fix"

Instead of patching individual components:
- **One utility** handles all timezone conversions
- **All edge functions** use the same normalization
- **All date-only values** become end-of-day in user's timezone
- **All naive timestamps** are treated as local and converted properly

This prevents timezone bugs across the entire application, not just in one place.

---

### Non-Technical Summary

Right now, when you say "do this today," the system saves midnight in London time (UTC). But you're in a US timezone, so midnight London is still yesterday evening for you - that's why it shows as yesterday.

The fix makes the system always think in YOUR timezone first, then convert to the universal format for storage. This way "today" always means YOUR today, and "noon" always means YOUR noon.

