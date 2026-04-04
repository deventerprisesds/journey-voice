

# Fix Focus View: Show All 15-Minute Labels + Visible Grid Lines

## Problem

The current Focus View gutter only shows full labels at `:00`, a dash at `:30`, and dots at `:15/:45`. The user wants every 15-minute increment to display its actual time label (6:00, 6:15, 6:30, 6:45, 7:00...) matching the cleaner UX already used in the TimeSlotGrid component (visible in the Create New Tasks modal).

Additionally, grid lines need to be more visible so the calendar feel is clear.

## Changes

**File**: `src/components/FocusView.tsx`

### 1. Gutter: Show all 15-minute labels (line ~1064)

Replace the conditional label logic:
```ts
// Current: only shows label at :00, dash at :30, dot at :15/:45
{slot.minute === 0 ? slot.label : slot.minute === 30 ? '—' : '·'}
```

With:
```ts
// New: show formatted time for every slot (e.g. "6:00", "6:15", "6:30", "6:45")
{`${slot.hour}:${slot.minute.toString().padStart(2, '0')}`}
```

Also unify the text styling so all labels are the same size (currently `:00` is `text-xs font-medium` while others are `text-[10px]`). Use consistent `text-[11px] text-muted-foreground` for all, with slightly bolder weight at `:00` marks.

### 2. Grid lines: Make all rows visually distinct (line ~1084-1085)

Current grid lines are nearly invisible (`border-muted/10` for non-hour, `border-muted/30` for hour). Update to:
- `:00` rows: `border-muted/40` (stronger line to mark the hour)
- `:15/:30/:45` rows: `border-muted/20` (visible but lighter)

This creates a clear table-like grid matching the TimeSlotGrid reference.

## Files changed

| File | Change |
|------|--------|
| `src/components/FocusView.tsx` | Show all 15-min labels in gutter + increase grid line visibility |

