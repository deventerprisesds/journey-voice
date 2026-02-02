
# Implementation Plan: Outlook Provider Name Normalization

## Summary
Fix the provider name mismatch where new connections are stored as `'outlook'` but the UI and notification function query for `'office365'`.

## Changes to Implement

### 1. `src/components/NotificationSettings.tsx`
**Line 86**: Update Outlook connection lookup to accept both provider names
```typescript
// Before
const outlook = data.find((c: any) => c.provider === 'office365' && c.is_active);

// After  
const outlook = data.find((c: any) => 
  (c.provider === 'office365' || c.provider === 'outlook') && c.is_active
);
```

**New useEffect**: Add listener for OAuth completion to auto-refresh connection status
```typescript
useEffect(() => {
  const handleConnectionUpdate = () => {
    console.log('[NotificationSettings] OAuth completion detected, refreshing connections...');
    loadCalendarConnections();
  };
  
  window.addEventListener('calendar-connection-updated', handleConnectionUpdate);
  return () => window.removeEventListener('calendar-connection-updated', handleConnectionUpdate);
}, [user]);
```

### 2. `src/hooks/useOAuthCallback.tsx`
**After line 117**: Dispatch custom event to notify settings to refresh
```typescript
// Dispatch event to notify settings components to refresh
window.dispatchEvent(new CustomEvent('calendar-connection-updated', {
  detail: { provider }
}));
```

### 3. `supabase/functions/send-unified-notification/index.ts`
**Lines 104-106**: Update query to accept both provider names
```typescript
// Before
.eq('provider', 'office365')

// After
.in('provider', ['office365', 'outlook'])
```

## Files Changed

| File | Change |
|------|--------|
| `src/components/NotificationSettings.tsx` | Accept both `outlook` and `office365` as valid; add event listener |
| `src/hooks/useOAuthCallback.tsx` | Dispatch `calendar-connection-updated` event after success |
| `supabase/functions/send-unified-notification/index.ts` | Query for both provider names |

## Expected Result
- Button shows "Connected" immediately after OAuth redirect
- Test Outlook Event button successfully creates calendar events
- Works with both old `office365` and new `outlook` connections

## Note
Keeping old connections as requested - no database cleanup in this change.
