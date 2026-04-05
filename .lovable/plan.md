

# Add "Reschedule Today" — Single-Day Scheduling Mode

## Problem
The nightly schedule builder always runs a full 7-day horizon for all users, which is slow. When iterating on scheduling fixes, you're stuck with stale results because re-running the full builder takes too long / times out.

## Solution
Two changes: make the edge function accept a single-day mode, and add a button in FocusView to trigger it.

---

## Part 1: Edge Function — Single-Day + Single-User Mode

**File**: `supabase/functions/nightly-schedule-builder/index.ts`

**Parse request body** (after line 150, before the users query):
```ts
let body: any = {};
try { body = await req.json(); } catch { /* no body = full run */ }
const requestedUserId = body?.userId;       // optional: scope to one user
const singleDay = body?.singleDay === true; // optional: only schedule today
```

**Filter users** (~line 156): If `requestedUserId` is provided, filter the `users` array to just that user instead of processing everyone.

**Scope day loop** (~line 457): If `singleDay` is true, set `totalDays = 1` instead of 7. This skips the future-clear step for days 2-7 and only clears/rebuilds today.

**Skip future-clear in single-day mode** (~line 282): Wrap the STEP 1.1 (clear future-scheduled tasks) block in `if (!singleDay) { ... }` so it doesn't wipe the rest of the week when you're only rebuilding today.

---

## Part 2: FocusView — "Reschedule Today" Button

**File**: `src/components/FocusView.tsx`

Add a new button next to the existing "Auto-fill" and "Clear All" buttons (~line 860):

```tsx
<Button
  variant="ghost"
  size="sm"
  onClick={handleRescheduleToday}
  disabled={isRescheduling}
  className="text-xs h-7"
  title="Clear and rebuild today's full schedule"
>
  {isRescheduling ? <Clock className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
  {!isRescheduling && 'Reschedule'}
</Button>
```

**Handler** (`handleRescheduleToday`): Add new state `isRescheduling` and handler that:
1. Confirms with user: "This will clear and rebuild today's schedule. Continue?"
2. Calls `supabase.functions.invoke('nightly-schedule-builder', { body: { userId: user.id, singleDay: true } })`
3. Shows toast with result count
4. Calls `onTaskUpdate()` to refresh

---

## Files changed

| File | Change |
|------|--------|
| `supabase/functions/nightly-schedule-builder/index.ts` | Accept optional `userId` + `singleDay` body params; scope loop to 1 day; skip future-clear in single-day mode |
| `src/components/FocusView.tsx` | Add "Reschedule" button + handler that invokes single-day builder |

