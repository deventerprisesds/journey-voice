
# Fix Plan: Outlook Events + Chat Panel Height

## Issue 1: Outlook Calendar Events Not Created

### Root Cause
The edge function `send-unified-notification` looks for secrets named:
- `AZURE_AD_CLIENT_ID`
- `AZURE_AD_CLIENT_SECRET`

But your Supabase project has secrets configured as:
- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`

This mismatch causes the token refresh to fail silently, and expired tokens cannot be renewed.

### Solution
Update the `send-unified-notification` edge function to use the correct secret names:

**File:** `supabase/functions/send-unified-notification/index.ts`

Change lines 191-192 from:
```typescript
const clientId = Deno.env.get('AZURE_AD_CLIENT_ID');
const clientSecret = Deno.env.get('AZURE_AD_CLIENT_SECRET');
```

To:
```typescript
const clientId = Deno.env.get('MICROSOFT_CLIENT_ID') || Deno.env.get('AZURE_AD_CLIENT_ID');
const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET') || Deno.env.get('AZURE_AD_CLIENT_SECRET');
```

This will check for both naming conventions for backward compatibility.

---

## Issue 2: Chat Panel Height Not Constrained

### Root Cause
The CommsConsole panel lacks proper height constraints. Looking at the CSS hierarchy:

1. `MainLayout` sets up the aside with `flex flex-col` but no explicit height control
2. `CommsConsole` uses `h-full` which should inherit height
3. The problem is that `ConversationPane` → `TranscriptScroll` has `flex-1` but the flex container chain is broken

The missing piece is that the aside in MainLayout needs `h-[calc(100vh-56px)]` or similar, and the CommsConsole needs `overflow-hidden` to ensure flex children respect boundaries.

### Solution
Update the MainLayout and CommsConsole to properly constrain heights:

**File:** `src/components/MainLayout.tsx` (line 483)

Change:
```tsx
<aside className="w-[400px] border-l border-border bg-card/50 flex-shrink-0 flex flex-col">
  <CommsConsole mode="panel" />
</aside>
```

To:
```tsx
<aside className="w-[400px] border-l border-border bg-card/50 flex-shrink-0 flex flex-col h-[calc(100dvh-56px)] overflow-hidden">
  <CommsConsole mode="panel" />
</aside>
```

The `56px` accounts for the top header height (h-14 = 3.5rem = 56px).

**File:** `src/components/CommsConsole/CommsConsole.tsx` (line 93)

Update the panel mode container to add `overflow-hidden`:
```tsx
<div className={cn('flex flex-col h-full overflow-hidden bg-background', className)}>
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `supabase/functions/send-unified-notification/index.ts` | Fix secret name mismatch: use `MICROSOFT_CLIENT_ID` |
| `src/components/MainLayout.tsx` | Add explicit height and overflow-hidden to chat panel aside |
| `src/components/CommsConsole/CommsConsole.tsx` | Add overflow-hidden to panel mode container |

## Technical Details

### Secret Name Fix
The Microsoft OAuth secrets were originally added with `MICROSOFT_` prefix but the code (likely copied from Azure AD examples) expected `AZURE_AD_` prefix. By supporting both, we maintain backward compatibility.

### Height Constraint Fix
The CSS flexbox model requires explicit height constraints to flow down properly. Without `overflow-hidden` on flex containers, child elements with `flex-1` can grow beyond their parent's intended bounds. The `h-[calc(100dvh-56px)]` calculation ensures the panel fills exactly the remaining viewport height below the header.
