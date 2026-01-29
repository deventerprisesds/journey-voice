

# Plan: Complete the Default Focus View Fix

## Problem
The Tasks page still loads with Kanban instead of Focus because there are **2 remaining places** still navigating to `view=kanban` that weren't updated in the previous change.

## Files to Update

### 1. Root Route Redirect
**File**: `src/App.tsx`  
**Line 86**

The app's root route (`/`) currently redirects to Kanban:
```typescript
<Route path="/" element={<Navigate to="/tasks?view=kanban" replace />} />
```

Change to:
```typescript
<Route path="/" element={<Navigate to="/tasks?view=focus" replace />} />
```

### 2. CommsConsole Navigation (Tasks Icon)
**File**: `src/components/CommsConsole/NavigationSection.tsx`  
**Line 126**

When the Tasks icon is clicked inside the CommsConsole (collapsed sidebar mode), it navigates to Kanban:
```typescript
onClick={() => navigate('/tasks?view=kanban')}
```

Change to:
```typescript
onClick={() => navigate('/tasks?view=focus')}
```

## Summary

| File | Line | Change |
|------|------|--------|
| `src/App.tsx` | 86 | Root redirect: kanban → focus |
| `src/components/CommsConsole/NavigationSection.tsx` | 126 | Tasks icon click: kanban → focus |

## What Was Already Fixed
- `src/components/MainLayout.tsx` line 171 ✓ (updated in previous change)

## Expected Result
After these 2 simple line changes:
- Opening the app goes to Focus view
- Clicking Tasks from CommsConsole goes to Focus view
- Clicking Tasks from collapsed main sidebar goes to Focus view
- All navigation defaults to Focus as the primary task view

