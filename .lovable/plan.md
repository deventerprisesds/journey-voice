
# Fix: UI Showing Wrong Calendar Connection Status

## Problem Identified

The database has multiple Outlook/Office365 connections:

| Provider | Expires At | Status |
|----------|------------|--------|
| `outlook` | 2026-02-02 16:16 | **VALID** |
| `office365` | 2026-01-06 | Expired |
| `office365` | 2025-12-09 | Expired |
| `outlook` | 2025-09-30 | Expired |

The UI code in `NotificationSettings.tsx` uses `find()` which returns the **first match**. Since `get_calendar_connections_safe()` doesn't order results, it may return an expired connection first, causing the "Connection expired" message even though a valid connection exists.

## Solution

Fix the connection selection logic in `NotificationSettings.tsx` to prefer non-expired connections. Currently:

```typescript
const outlook = data.find((c: any) => 
  (c.provider === 'office365' || c.provider === 'outlook') && c.is_active
);
```

Should be updated to:

```typescript
// Filter all matching connections, then prefer non-expired ones
const outlookConnections = data.filter((c: any) => 
  (c.provider === 'office365' || c.provider === 'outlook') && c.is_active
);

// Prefer non-expired, then most recently updated
const outlook = outlookConnections.find((c: any) => 
  !c.expires_at || new Date(c.expires_at) > new Date()
) || outlookConnections.sort((a: any, b: any) => 
  new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
)[0];
```

Apply the same logic for Google connections.

## Technical Changes

### File: `src/components/NotificationSettings.tsx`

Update the `loadCalendarConnections` function (lines 96-131):

```typescript
if (data && Array.isArray(data)) {
  const now = new Date();
  
  // Helper to select best connection: prefer non-expired, then most recent
  const selectBestConnection = (connections: any[]) => {
    if (connections.length === 0) return null;
    
    // First try to find a non-expired connection
    const validConnection = connections.find(c => 
      !c.expires_at || new Date(c.expires_at) > now
    );
    if (validConnection) return validConnection;
    
    // If all expired, return the most recently updated one
    return connections.sort((a, b) => 
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    )[0];
  };
  
  // Filter Outlook connections (both provider names)
  const outlookConnections = data.filter((c: any) => 
    (c.provider === 'office365' || c.provider === 'outlook') && c.is_active
  );
  const outlook = selectBestConnection(outlookConnections);
  
  // Filter Google connections
  const googleConnections = data.filter((c: any) => 
    c.provider === 'google' && c.is_active
  );
  const google = selectBestConnection(googleConnections);
  
  // Set state for Outlook
  if (outlook) {
    const isExpired = outlook.expires_at && new Date(outlook.expires_at) < now;
    setOutlookExpired(isExpired);
    setOutlookConnection({
      id: outlook.id,
      provider: outlook.provider,
      provider_account_email: outlook.provider_account_email,
      is_active: outlook.is_active,
      expires_at: outlook.expires_at
    });
  } else {
    setOutlookConnection(null);
    setOutlookExpired(false);
  }
  
  // Set state for Google
  if (google) {
    const isExpired = google.expires_at && new Date(google.expires_at) < now;
    setGoogleExpired(isExpired);
    setGoogleConnection({
      id: google.id,
      provider: google.provider,
      provider_account_email: google.provider_account_email,
      is_active: google.is_active,
      expires_at: google.expires_at
    });
  } else {
    setGoogleConnection(null);
    setGoogleExpired(false);
  }
}
```

## Optional: Clean Up Old Connections

Consider adding a cleanup step to deactivate or delete old expired connections to prevent clutter:

```sql
-- Deactivate connections expired more than 30 days ago
UPDATE calendar_connections 
SET is_active = false 
WHERE expires_at < NOW() - INTERVAL '30 days' 
  AND is_active = true;
```

## Expected Outcome

After this fix:
1. Outlook will show as **Connected** (using the valid `outlook` connection from today)
2. Google will correctly show as **Expired** (since its token actually expired on 2026-01-09)
3. The UI will always prefer valid connections over expired ones when multiple exist
