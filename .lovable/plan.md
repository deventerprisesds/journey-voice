

## Problem: Hardcoded UTC Offset + Missing Tracing

### Root Cause Found

The AI prompt in `batch-calendar-scheduler` **hardcodes `-05:00` (EST)** in 6 places (lines 282, 331, 332, 338, 339). Today is **March 11, 2026** — Eastern Daylight Time (`-04:00`), not EST.

When the AI returns `T10:00:00-05:00`, JavaScript's `new Date()` interprets it as **15:00 UTC**, which is actually **11:00 AM EDT** — a 1-hour systematic shift. Worse, the AI sees the `-05:00` examples and may choose EST-based reasoning for window boundaries (e.g., thinking 5 PM EST = `T22:00:00Z` when it's actually `T21:00:00Z` in EDT), causing tasks to land in wrong windows.

Additionally, there is **zero tracing** between the edge function response and what gets saved/displayed in FocusView, making it impossible to pinpoint where times diverge.

### Changes

#### 1. Dynamic timezone offset in prompt (`supabase/functions/batch-calendar-scheduler/index.ts`)

Replace all 6 hardcoded `-05:00` instances with a dynamically computed offset using the `getTzOffsetMinutesAt` utility already available in `_shared/timezone.ts`:

```typescript
import { normalizeDateTime, getTodayInTimezone, getTzOffsetMinutesAt } from "../_shared/timezone.ts";

// Compute actual offset for the target date
const targetNoon = new Date(`${targetDateISO}T12:00:00Z`);
const offsetMin = getTzOffsetMinutesAt(targetNoon, timezone);
const offsetSign = offsetMin >= 0 ? '+' : '-';
const absH = String(Math.floor(Math.abs(offsetMin) / 60)).padStart(2, '0');
const absM = String(Math.abs(offsetMin) % 60).padStart(2, '0');
const tzOffset = `${offsetSign}${absH}:${absM}`; // e.g., "-04:00" for EDT
```

Then replace all `"-05:00"` with `"${tzOffset}"` in the prompt template.

#### 2. End-to-end tracing in FocusView (`src/components/FocusView.tsx`)

Add 4 trace checkpoints in `handleAutoFill` (around lines 527-562):

- **Checkpoint A**: Log tasks sent to scheduler (title, category, id)
- **Checkpoint B**: Log raw `result.scheduled` array (taskId, start_time, end_time, reasoning)
- **Checkpoint C**: Log each DB update before execution (taskId, start_time, end_time)
- **Checkpoint D**: After saves, re-fetch from DB and log actual stored values to catch write issues

Also log the time-window grouping in `getTimeWindowForTask` so we can see how each task's `start_time` maps to a visual window.

#### 3. Tracing in `useBatchScheduling.ts`

Log the raw edge function response data immediately after receiving it, before any processing.

### Files Modified
- `supabase/functions/batch-calendar-scheduler/index.ts` — dynamic offset, redeploy
- `src/components/FocusView.tsx` — 4 trace checkpoints + window grouping trace
- `src/hooks/useBatchScheduling.ts` — raw response logging

