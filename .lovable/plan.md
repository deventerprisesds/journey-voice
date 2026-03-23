

## Problem

The `/agenda` page crashes immediately with:

```
Invariant failed: Could not find required context
at PrivateDraggable
```

Confirmed from the network error logs — the crash happens in `TimeSlotGrid.tsx` at the overlay section (lines 515-588) where `<Draggable>` task cards are rendered **without a parent `<Droppable>`**.

## What changed

The recent dependency reinstall (when `bun.lock` was regenerated to fix the prior build failure) resolved `@hello-pangea/dnd@^18.0.1` to a newer patch that **strictly enforces** the requirement that every `<Draggable>` must be inside a `<Droppable>`. The code structure itself wasn't changed — the library became stricter.

The time slot rows (lines 431-461) correctly have `<Droppable>` wrappers, but the overlay layer (lines 482-591) that renders absolute-positioned task cards uses `<Draggable>` directly inside a plain `<div>`.

## Fix

**File**: `src/components/TimeSlotGrid.tsx`

**Single change**: Wrap each date column in the overlay section with a `<Droppable>` using `isDropDisabled` to satisfy the context requirement without creating conflicting drop targets.

```text
Before (line 482):
  <div key={`overlay-${dateIndex}`} className="relative border-r">
    {items.map((item, idx) => {
      ...
      <Draggable key={t.id} ...>   ← crash: no parent Droppable
      ...
    })}
  </div>

After:
  <Droppable droppableId={`overlay-${dateIndex}`} isDropDisabled>
    {(provided) => (
      <div ref={provided.innerRef} {...provided.droppableProps}
           key={`overlay-${dateIndex}`} className="relative border-r">
        {items.map((item, idx) => {
          ...
          <Draggable key={t.id} ...>   ← now inside a Droppable ✓
          ...
        })}
        {provided.placeholder}
      </div>
    )}
  </Droppable>
```

This is a single-file fix. No other files are affected. The actual drop handling continues to work through the per-slot `<Droppable>` components underneath.

