

## UI Fixes: Comms Panel Button + Kanban Navigation Nesting

This plan addresses the two immediately actionable UI issues while we wait for the Cloudflare deployment.

---

## Issue 1: Missing Comms Panel Collapse Button

### Problem
When the Comms panel is open on desktop, there's no visible button to collapse it. The existing close button in `AssistantHeader.tsx` has `md:hidden`, making it invisible on desktop.

### Solution
Add a collapse button to the panel header that's visible on desktop.

### Implementation

**File: `src/components/CommsConsole/AssistantHeader.tsx`**

Change the close button visibility from `md:hidden` to always visible when in panel mode:

```tsx
// Line 119-129: Make close button visible on desktop for panel mode
{showCloseButton && (
  <Button
    variant="ghost"
    size="icon"
    onClick={onClose}
    className="h-8 w-8"  // Remove md:hidden
    aria-label="Collapse panel"
  >
    <PanelRightClose className="w-4 h-4" />  // Use panel-specific icon
  </Button>
)}
```

Also import `PanelRightClose` from lucide-react (already imported in MainLayout but not in AssistantHeader).

---

## Issue 2: Kanban Views Not Nested in Navigation

### Problem
The category tabs (Today, Career, Prof. Education, Ventures, Life) are only visible once you're on the Kanban page. User wants them nested under the "Kanban Board" nav item for quick navigation.

### Solution
Add a second level of nesting under "Kanban Board" with the category tabs.

### Implementation

**File: `src/components/MainLayout.tsx`**

Update the `navItems` structure to include Kanban tabs as sub-items:

```typescript
// Lines 78-86: Expand Kanban Board sub-item with category tabs
{
  icon: LayoutGrid,
  label: 'Tasks',
  subItems: [
    { 
      icon: Columns3, 
      label: 'Kanban Board', 
      path: '/tasks?view=kanban',
      subItems: [  // Add nested category tabs
        { label: 'Today', path: '/tasks?view=kanban&tab=today' },
        { label: 'Career', path: '/tasks?view=kanban&tab=career' },
        { label: 'Prof. Education', path: '/tasks?view=kanban&tab=prof_education' },
        { label: 'Ventures', path: '/tasks?view=kanban&tab=ventures' },
        { label: 'Life', path: '/tasks?view=kanban&tab=life' },
      ]
    },
    { icon: List, label: 'List View', path: '/tasks?view=grid' },
  ],
},
```

Update `renderNavItem` to handle the third level of nesting with a secondary Collapsible or a flat list of links.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/CommsConsole/AssistantHeader.tsx` | Add `PanelRightClose` icon, remove `md:hidden` from close button |
| `src/components/MainLayout.tsx` | Add category tabs as sub-items under Kanban Board nav item |

---

## Voice Delay Investigation (Parallel Task)

While implementing these UI fixes, the voice delay issue requires separate investigation:

1. **WebRTC Voice**: Check if ElevenLabs TTS calls are timing out or if session configuration changed
2. **Phone Calls**: The Cloudflare worker is still on old version - once deployment completes, phone calls should improve
3. **Console errors**: The `response_cancel_not_active` and `MP3 playback error` suggest timing race conditions during disconnect

The voice investigation will continue as a separate tracked task after confirming the Cloudflare deployment status.

---

## Summary

This plan provides:
1. **Visible collapse button** for the Comms panel on desktop
2. **Quick navigation** to Kanban category tabs from the sidebar
3. **Tracking** for the ongoing Cloudflare deployment and voice delay investigation

