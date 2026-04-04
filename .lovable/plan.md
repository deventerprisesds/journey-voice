

# Fix Focus View: Duration-Proportional Card Heights + Time Range Display

## Problem

All task cards render at the same height regardless of duration. A 2-hour task (11:00 AM – 1:00 PM) looks identical to a 30-minute task. This makes it appear that time slots are missing rather than covered by the longer task. Additionally, cards only show the start time, not the full time range.

## Changes in `src/components/FocusView.tsx`

### 1. Show time range instead of just start time

On the task card (line ~1104), change from:
```
10:30 AM  Order graduation outfit
```
to:
```
10:30 – 11:00 AM  Order graduation outfit
```

Use `end_time` when available; otherwise compute from `start_time + estimate_minutes`.

Same change for external event cards (~line 1200).

### 2. Make card height proportional to duration

Set a minimum height on each task/event card based on its duration. Use a scale like `minHeight = max(baseHeight, slots * slotHeight)` where each 30-minute slot adds height. For example:
- 30 min → default card height (no change)
- 60 min → ~120px
- 120 min → ~200px

This is applied as an inline `style={{ minHeight }}` on the card div. The base unit (e.g., 56px per 30-min slot) matches the natural height of a single-slot card so the visual proportions are correct.

### 3. Slot grid uses 30-minute increments (already does)

The existing slot calculation already uses 30-minute increments. No change needed there — the occupied-slot logic correctly marks all slots within a task's duration. The visual mismatch was purely because card height didn't reflect duration.

## Files changed

| File | Change |
|------|--------|
| `src/components/FocusView.tsx` ~line 1079-1176 | Add `minHeight` style based on duration; show time range |
| `src/components/FocusView.tsx` ~line 1186-1220 | Same for external event cards |

