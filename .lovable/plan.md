

## Fix Today's Schedule Section - Ordering and Content Clipping

### Problems Identified from Screenshot

| Issue | Evidence | Root Cause |
|-------|----------|------------|
| **Section ordering wrong** | "Up Next" appears above "Today's Schedule" on mobile | Line 344: `order-2`, Line 473: `order-1` |
| **All right-side content clipped** | Time windows show "6:00 -", "9:00 - 1", "17:00 - 2" - cut off | Line 374: `overflow-hidden` on time window container |

The `overflow-hidden` class on line 374 is clipping the ENTIRE right side of children content - not just time ranges, but also any Play buttons that would appear on the right.

---

### Implementation

#### File: `src/components/FocusView.tsx`

**Change 1: Fix section ordering (lines 344 and 473)**

```tsx
// Line 344 - Today's Schedule container
// Before
<div className="lg:col-span-2 order-2 lg:order-1">

// After
<div className="lg:col-span-2 order-1">
```

```tsx
// Line 473 - Sidebar container  
// Before
<div className="space-y-6 order-1 lg:order-2">

// After
<div className="space-y-6 order-2">
```

**Change 2: Remove overflow-hidden from time window containers (line 374)**

```tsx
// Before
<div key={windowName} className={cn("rounded-lg overflow-hidden", style.bgClass)}>

// After
<div key={windowName} className={cn("rounded-lg", style.bgClass)}>
```

---

### Technical Details

The `overflow-hidden` was likely added for visual styling (to clip rounded corners), but it has the side effect of clipping all child content that extends to the right edge. Removing it will:

- Allow time range text to display fully (e.g., "6:00 - 9:00" instead of "6:00 -")
- Allow Play buttons on task cards to remain visible
- Allow all badge content to display without clipping

If rounded corner clipping is needed, it can be applied only to specific child elements rather than the entire container.

---

### Files Changed

| File | Line | Change |
|------|------|--------|
| `src/components/FocusView.tsx` | 344 | Change `order-2 lg:order-1` to `order-1` |
| `src/components/FocusView.tsx` | 473 | Change `order-1 lg:order-2` to `order-2` |
| `src/components/FocusView.tsx` | 374 | Remove `overflow-hidden` from time window container |

---

### Expected Result

**Before (mobile):**
```
┌────────────────────────┐
│ Up Next          Sch   │  ← Wrong order
├────────────────────────┤
│ Today's Schedule       │
│ Morning        6:00 -  │  ← Clipped
│ Business Hours 9:00 -  │  ← Clipped
└────────────────────────┘
```

**After (mobile):**
```
┌────────────────────────┐
│ Today's Schedule       │  ← First
│ Morning    6:00 - 9:00 │  ← Full content
│ Business   9:00 - 17:00│  ← Full content
├────────────────────────┤
│ Currently Doing        │
├────────────────────────┤
│ Up Next          Sch   │
└────────────────────────┘
```

