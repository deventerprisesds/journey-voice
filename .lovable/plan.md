

## Enable Horizontal Scrolling in Today's Schedule (Stopgap Fix for CLIP-01)

### Problem
The Today's Schedule section clips content on the right side. While previous attempts restructured flex layouts, the underlying issue is that the `ScrollArea` only scrolls vertically, preventing users from reaching content that extends beyond the viewport width.

### Solution
Enable horizontal scrolling so users can pan right to see all content - a practical stopgap while the card width optimization is addressed separately.

---

### Technical Changes

**File: `src/components/FocusView.tsx`**

#### Change 1: Add horizontal ScrollBar to ScrollArea (Line 367)

The current `ScrollArea` only includes a vertical scrollbar. Add a horizontal scrollbar to enable side-to-side panning:

```tsx
// Before (line 367-368)
<ScrollArea className="h-[400px] lg:h-[500px]">
  <div className="space-y-4">

// After
<ScrollArea className="h-[400px] lg:h-[500px]" type="always">
  <div className="space-y-4 min-w-max">
```

Then at the closing of the ScrollArea, add the horizontal scrollbar component:

```tsx
// Before (around line ~465)
</ScrollArea>

// After - need to import ScrollBar and add it
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

// Inside ScrollArea, after the content div closes:
<ScrollBar orientation="horizontal" />
</ScrollArea>
```

#### Change 2: Ensure content can expand horizontally

Add `min-w-max` to the content container so it can grow beyond the viewport width, making horizontal scroll meaningful.

---

### Update Debug Tracker

**File: `docs/DEBUG_TRACKER.md`**

Add to Attempted Fixes Log:

| Issue ID | Attempt | Date | Outcome |
|----------|---------|------|---------|
| CLIP-01 | Enable horizontal scrolling with ScrollBar orientation="horizontal" | 2026-01-30 | PENDING |

---

### Files Changed

| File | Action |
|------|--------|
| `src/components/FocusView.tsx` | Add horizontal ScrollBar and `min-w-max` to content |
| `docs/DEBUG_TRACKER.md` | Log attempt |

