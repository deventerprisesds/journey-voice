
# Plan: Reduce 15-Minute Grid Height by 75%

## Summary

The 15-minute time slot grid on the Agenda page is too tall, making hour-long tasks take up excessive vertical space. This change reduces the grid height to 25% of its current size (a 75% reduction).

---

## Current Values → New Values

| Constant | Current | New (25% of original) |
|----------|---------|----------------------|
| Slot height (CSS) | `h-16` (64px) | `h-4` (16px) |
| PX_PER_MINUTE | 64/15 ≈ 4.27 | 16/15 ≈ 1.07 |
| Min task height | 48px | 12px |
| Height per slot | 64px | 16px |

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/TimeSlotGrid.tsx` | Update all height-related constants |

---

## Technical Implementation Details

### TimeSlotGrid.tsx Changes

**Change 1: Update PX_PER_MINUTE constant (line 201)**
```typescript
// Before
const PX_PER_MINUTE = 64 / 15;

// After
const PX_PER_MINUTE = 16 / 15; // Reduced from 64px to 16px per 15-min slot
```

**Change 2: Update task height calculation (line 169)**
```typescript
// Before
height: Math.max(48, durationIn15MinSlots * 64 - 4)

// After
height: Math.max(12, durationIn15MinSlots * 16 - 2)
```

**Change 3: Update time slot row height CSS class (line 377)**
```typescript
// Before
className="relative border-r h-16 hover:bg-muted/30 ..."

// After
className="relative border-r h-4 hover:bg-muted/30 ..."
```

**Change 4: Update overlay container height (line 405)**
```typescript
// Before
height: `${timeSlots.length * 64}px`

// After
height: `${timeSlots.length * 16}px`
```

**Change 5: Update task height in overlay (line 418)**
```typescript
// Before
const height = Math.max(48, (item.endMin - item.startMin) * PX_PER_MINUTE - 4);

// After
const height = Math.max(12, (item.endMin - item.startMin) * PX_PER_MINUTE - 2);
```

---

## Visual Impact

| Duration | Current Height | New Height |
|----------|---------------|------------|
| 15 min | ~60px | ~14px |
| 30 min | ~124px | ~30px |
| 1 hour | ~252px | ~62px |
| 2 hours | ~508px | ~126px |

The entire day view (6 AM - 10 PM = 64 slots) will shrink from **4096px** to **1024px** - much more scrollable on a single screen.

---

## Additional Considerations

- The time labels and add-task buttons may need font/padding adjustments if they appear cramped at the new height
- Task text content may need smaller font sizes or truncation at reduced heights
- The minimum task height (12px) ensures even short tasks remain clickable
