# Master Debug Tracking Sheet

## Purpose
Track all issues, attempted fixes, outcomes, and lessons learned to ensure progressive debugging and avoid repeating failed approaches.

---

## Active Issues

| ID | Problem | Status | Root Cause |
|----|---------|--------|------------|
| CLIP-01 | Time ranges cut off in Today's Schedule ("6:00 -" instead of "6:00 - 9:00") | OPEN | ScrollArea enforces overflow-hidden at root; internal flex layouts overflow horizontally |
| NAV-01 | Top-right assistant button hidden | FIXED | Demo badge positioned at same location (top-4 right-4) |
| NAV-02 | No floating assistant button | REGRESSED | Was removed when refactoring desktop toggle button |

---

## Attempted Fixes Log

| Issue ID | Attempt | Date | Outcome | Why It Failed/Succeeded |
|----------|---------|------|---------|-------------------------|
| CLIP-01 | Remove `overflow-hidden` from time window container (line 374) | 2026-01-29 | FAILED | ScrollArea component has `overflow-hidden` baked into its root element - cannot be overridden from children |
| NAV-01 | Add assistant button to top header | 2026-01-29 | PARTIAL | Button added but Demo badge covered it |
| NAV-01 | Move Demo badge to center | 2026-01-30 | SUCCESS | Badge now centered, no longer overlaps assistant button |

---

## Lessons Learned

1. **ScrollArea overflow-hidden is immutable**: The Radix ScrollArea component applies `overflow-hidden` at the root level. Fix must be internal layout changes, not CSS overrides.

2. **Fixed position conflicts**: Multiple fixed-position elements at the same coordinates (top-4 right-4) will overlap. Always check for existing fixed elements before adding new ones.

3. **Flex overflow prevention pattern**: Use `min-w-0` on flex containers that should shrink, `truncate` on text that can be cut, and `flex-shrink-0` on elements that must remain visible.

---

## Pending Solutions

### CLIP-01: Time Range Clipping

**Correct approach**: Restructure time window header so content never exceeds container width:

- Wrap in `justify-between` layout
- Left group: `min-w-0` (can shrink) with `truncate` on label
- Right group (time range): `flex-shrink-0 whitespace-nowrap` (never shrinks)

This prioritizes time visibility over label length.

### NAV-02: Floating Button

Re-add the floating button that was accidentally removed:

- Position: `fixed right-4 bottom-4 z-50`
- Size: `h-12 w-12 rounded-full`
- Behavior: Opens Comms panel on click
