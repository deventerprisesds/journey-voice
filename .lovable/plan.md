
# Plan: Fix Default View to Focus + Clean Up Toolbar Layout

## Issues Identified

### 1. Default View Goes to Kanban Instead of Focus
**Location**: `src/components/MainLayout.tsx` line 171

When the sidebar is collapsed (or on mobile), clicking the Tasks icon navigates to:
```
/tasks?view=kanban
```

Should be:
```
/tasks?view=focus
```

### 2. Toolbar Buttons Wrapping to New Lines
**Location**: `src/components/KanbanBoard.tsx` lines 1023-1091

The current toolbar uses `flex-wrap` which causes buttons to break onto multiple rows on narrow screens. World-class apps use horizontal scrolling or condensed layouts instead.

**Current state** (from screenshot):
- Voice button + Select + Show Completed on row 1
- Filters + AI Create + Schedule on row 2
- Looks cluttered and unprofessional

---

## Proposed Changes

### Fix 1: Change Default View to Focus

**File**: `src/components/MainLayout.tsx`

**Line 171**: Change navigation target
```typescript
// Before
onClick={() => navigate('/tasks?view=kanban')}

// After  
onClick={() => navigate('/tasks?view=focus')}
```

---

### Fix 2: Make Toolbar Horizontally Scrollable (No Wrap)

**File**: `src/components/KanbanBoard.tsx`

**Strategy**: Replace `flex-wrap` with horizontal scroll container on mobile. On desktop, keep normal flex layout.

**Changes to lines 1022-1092**:

1. Remove `flex-wrap` from toolbar container
2. Add horizontal scroll container with `overflow-x-auto` and `scrollbar-thin`
3. Add `flex-nowrap` to prevent wrapping
4. Condense button labels on mobile (show only icons)

```typescript
{/* Toolbar - always visible */}
<div className="flex items-center justify-end gap-2">
  <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin pb-1">
    <VoiceAssistantButton />
    <Button variant={isSelectMode ? "default" : "outline"} size="sm" ...>
      <CheckCircle2 className="h-4 w-4" />
      <span className="hidden sm:inline ml-2">
        {isSelectMode ? 'Cancel' : 'Select'}
      </span>
    </Button>
    {/* Similar pattern for other buttons */}
  </div>
</div>
```

**Key changes**:
- Remove `flex-wrap` from both containers
- Add `overflow-x-auto scrollbar-thin` for horizontal scrolling
- Hide button text on mobile with `hidden sm:inline`
- Keep icons always visible
- Add `flex-shrink-0` to buttons to prevent squishing

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/MainLayout.tsx` | Line 171: Change kanban to focus |
| `src/components/KanbanBoard.tsx` | Lines 1023-1091: Refactor toolbar for scroll/condense |

---

## Expected Outcome

1. Collapsed sidebar Tasks icon navigates to Focus view
2. Mobile comms panel close returns to Focus view
3. Toolbar stays on single line with horizontal scroll
4. Icons always visible, text hidden on mobile
5. Professional single-row toolbar layout

---

## Technical Details

### Mobile Toolbar Pattern
```text
+--------------------------------------------------+
| [Mic] [✓] [Eye] [Filter] [AI] [Calendar]     →   |
+--------------------------------------------------+
        (horizontally scrollable, no wrap)
```

### Desktop Toolbar Pattern  
```text
+------------------------------------------------------------------------+
| [Mic] [✓ Select] [Eye Show Completed] [Filters] [AI Create] [Schedule] |
+------------------------------------------------------------------------+
        (all buttons visible with labels)
```
