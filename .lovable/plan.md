
## Fix Layout Layering and Button Overlap in Phone Mode

### Problem Summary

Based on analysis of the screenshot and code structure:

1. **Vertical Space Competition**: The `TextInputBar` and `ModeToggle` are siblings of `ConversationPane` in `CommsConsole.tsx`. When in phone mode, `PhoneDialer` renders inside `ConversationPane` with its own full-height layout including a bottom TabsList. But `TextInputBar` still renders below, stealing vertical space and causing content to be pushed off-screen.

2. **Stacking vs Scrolling**: Elements that should be in the same scrollable plane are instead stacking on top of each other, making it impossible to scroll to see all controls (like the disconnect button).

3. **Header Button Overlap**: The collapse panel button (`PanelRightClose`) and sidebar toggle (`PanelLeft`) can appear in positions where they overlap with other UI elements.

---

### Root Cause

The layout doesn't properly account for phone mode's unique requirements. The `PhoneDialer` component is self-contained with its own bottom navigation (TabsList), but the parent `CommsConsole` still renders `TextInputBar` and `ModeToggle` below it, creating a layout where:

- PhoneDialer expects to fill available height with its own internal scroll
- TextInputBar + ModeToggle take ~100px of fixed height below
- On small screens, this pushes PhoneDialer content (including call controls) out of view

---

### Solution

#### Fix 1: Conditional Layout in Phone Mode

In `CommsConsole.tsx`, when `currentMode === 'phone'`, do NOT render `TextInputBar` and `ModeToggle` outside the ConversationPane. Instead, the PhoneDialer's internal TabsList serves as the mode selector (users can tap mode toggle from within). 

However, per the user's feedback, the correct fix is NOT to hide elements but to ensure proper **scrolling and z-order**. All content should flow in a single scrollable plane.

**File: `src/components/CommsConsole/ConversationPane.tsx`**

Change the PhoneDialer container from `flex-shrink-0` to allow it to participate in natural document flow:

| Line | Current | Change To |
|------|---------|-----------|
| 53 | `<div className="flex items-center justify-center py-4 flex-shrink-0">` | `<div className="flex items-center justify-center py-4">` |

Additionally, wrap the entire ConversationPane content in a ScrollArea for phone mode to allow scrolling when content exceeds viewport:

```tsx
{mode === 'phone' && onPhoneCallStateChange && (
  <ScrollArea className="flex-1">
    <div className="flex flex-col items-center py-4">
      <PhoneDialer
        callState={phoneCallState}
        onCallStateChange={onPhoneCallStateChange}
      />
    </div>
  </ScrollArea>
)}
```

#### Fix 2: Remove Fixed Positioning from TextInputBar in Phone Mode

**File: `src/components/CommsConsole/CommsConsole.tsx`**

Ensure `TextInputBar` and `ModeToggle` don't have any sticky/fixed positioning. Currently they don't have explicit fixed positioning, but they participate in a flex layout that treats them as fixed-height elements.

The solution is to wrap the entire content area (ConversationPane + TextInputBar + ModeToggle) in a single scrollable container when in phone mode, ensuring users can scroll to reach all controls.

For all three layout modes (panel, embedded, overlay), wrap the main content in a ScrollArea when in phone mode:

```tsx
// In embedded mode (line ~159):
<div className="flex-1 flex flex-col min-h-0 min-w-0">
  {currentMode === 'phone' ? (
    <ScrollArea className="flex-1">
      <div className="flex flex-col min-h-full">
        <AssistantHeader ... />
        <ConversationPane ... />
        <TextInputBar ... />
        <ModeToggle ... />
      </div>
    </ScrollArea>
  ) : (
    <>
      <AssistantHeader ... />
      <ConversationPane ... />
      <TextInputBar ... />
      <ModeToggle ... />
    </>
  )}
</div>
```

#### Fix 3: Header Button Position Correction

**File: `src/components/CommsConsole/AssistantHeader.tsx`**

The sidebar toggle button should remain on the LEFT side. The close button should be on the RIGHT side. Currently both are correctly positioned in separate div groups (left vs right). 

The issue is likely that on mobile in certain modes, both `showSidebarToggle` and `showCloseButton` might be set in a way that causes UI clutter. Looking at the code:

- Line 50-60: Sidebar toggle is in the LEFT group
- Line 119-128: Close button is in a separate div on the RIGHT

These are in separate containers so shouldn't overlap. However, reviewing the props passed in `CommsConsole.tsx`:

| Mode | showSidebarToggle | showCloseButton |
|------|-------------------|-----------------|
| Panel | false | true |
| Embedded mobile | true | false |
| Overlay mobile | true | true |

In overlay mode on mobile, BOTH are shown - sidebar toggle on left, close on right. This shouldn't cause overlap. 

Check if the close button container needs z-index to ensure it renders above sibling elements:

```tsx
{showCloseButton && (
  <Button
    variant="ghost"
    size="icon"
    onClick={onClose}
    className="h-8 w-8 z-10" // Add z-10 to ensure button is above other elements
    aria-label="Collapse panel"
  >
    <PanelRightClose className="w-4 h-4" />
  </Button>
)}
```

---

### Files Changed

| File | Changes |
|------|---------|
| `src/components/CommsConsole/ConversationPane.tsx` | Remove `flex-shrink-0` from phone dialer container; add ScrollArea wrapper for phone mode |
| `src/components/CommsConsole/CommsConsole.tsx` | Wrap main content in ScrollArea for phone mode to enable vertical scrolling |
| `src/components/CommsConsole/AssistantHeader.tsx` | Add `z-10` to close button to prevent overlap issues |

---

### Technical Notes

**Scroll Behavior**
- The PhoneDialer already has internal ScrollArea for its tabs (recents, contacts, etc.)
- The outer scroll ensures the entire phone interface can be scrolled on small screens
- `overscroll-behavior: contain` should be added to prevent scroll chaining

**Z-Order Clarification**
- All interactive elements remain in the same stacking context
- Floating action buttons (if any) should use `z-50` for consistent elevation
- Standard content should not use z-index to avoid stacking context conflicts
