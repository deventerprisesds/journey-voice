

# Integrate AssignmentSyncSettings into Assignments Page

## Problem

The Assignments page (`/assignments`) has a bare "Sync" button that calls `nightly-assignment-sync` directly, ignoring the full-featured `AssignmentSyncSettings` component already built. That component handles sheet URL configuration, EMBA/MIT sync buttons, import mode selection, debug logs, and sync history — all the infrastructure shown in the Settings screenshot.

## Solution

Embed the `AssignmentSyncSettings` component directly into the Assignments page, replacing the standalone sync button. Place it in a collapsible section at the top of the page (above the program toggle and tabs) so users can configure and trigger syncs without leaving the page.

## Changes

### `src/pages/Assignments.tsx`

1. Import `AssignmentSyncSettings` component
2. Replace the manual `handleSync` function and the simple "Sync" button with a collapsible panel containing `<AssignmentSyncSettings />`
3. Keep the header layout but swap the sync button for a toggle that expands the import settings panel
4. After sync completes, re-fetch assignments (add a callback or use an interval/listener to detect new data)
5. Remove the `syncing`, `lastSyncedAt`, and `handleSync` state/logic since the component handles all of that internally

### Layout

```text
┌─────────────────────────────┐
│ Assignments    [⚙ Import ▾] │  ← collapsible trigger
├─────────────────────────────┤
│ ┌─ AssignmentSyncSettings ─┐│  ← collapsed by default
│ │ Sheet URLs, Sync buttons ││
│ └──────────────────────────┘│
├─────────────────────────────┤
│ [EMBA] [MIT] [All]          │  ← program toggle
│ [All|Due Next|Upcoming|...] │  ← status tabs
│ Course accordions...        │
└─────────────────────────────┘
```

### Optional: Add refresh callback

Add an `onSyncComplete` prop to `AssignmentSyncSettings` (or just re-fetch tasks on an interval after the panel is opened). Simplest approach: add a "Refresh" icon button next to the import toggle that calls `fetchAssignments()`.

## Files changed

| File | Change |
|------|--------|
| `src/pages/Assignments.tsx` | Replace manual sync with embedded `AssignmentSyncSettings`, add collapsible import panel |

