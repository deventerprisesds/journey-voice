
# Plan: Add Outlook OAuth Connection & Improve Error Feedback in Notification Settings

## Problem Summary

From the screenshots and investigation:

1. **"Not connected" for Outlook** - Your Outlook connections exist but have expired tokens (expired Jan 6, 2026). The UI shows "Not connected - add in Calendar settings" but there's no way to connect directly from the Notification Settings page.

2. **No OAuth setup path** - Clicking through to "Calendar settings" doesn't exist - you'd need to go to the Calendar page and find the connection modal there, which is not intuitive.

3. **Test Email failed silently** - The test button showed a success toast saying "Check your unified webhook" but gave no indication if the email was actually delivered or if there was an issue.

---

## Solution

### Part 1: Add "Connect Outlook" Button Directly in Notification Settings

Allow users to initiate the OAuth flow right from the Notification Settings page instead of having to navigate elsewhere.

**Changes to `src/components/NotificationSettings.tsx`:**

```typescript
// Import the OAuth component
import { CalendarOAuthManager } from './CalendarOAuthManager';

// In the Outlook section, when not connected:
{!outlookConnection ? (
  <div className="mt-2">
    <CalendarOAuthManager
      provider="outlook"
      onSuccess={() => {
        loadCalendarConnections();
        toast({ title: "Outlook Connected", description: "Your Outlook calendar is now connected." });
      }}
      onError={(err) => toast({ title: "Connection Failed", description: err, variant: "destructive" })}
    />
  </div>
) : null}
```

### Part 2: Show Connection Status with Expiry Warning

Indicate when a connection exists but tokens are expired, with a reconnect option.

```typescript
// Add state for tracking expired status
const [outlookExpired, setOutlookExpired] = useState(false);

// In loadCalendarConnections, check expiry:
if (outlook) {
  const isExpired = outlook.expires_at && new Date(outlook.expires_at) < new Date();
  setOutlookConnection({...});
  setOutlookExpired(isExpired);
}

// In UI:
{outlookConnection && outlookExpired ? (
  <p className="text-xs text-amber-600">
    ⚠ Connection expired - click to reconnect
  </p>
) : outlookConnection ? (
  <p className="text-xs text-green-600">
    ✓ Connected: {outlookConnection.provider_account_email}
  </p>
) : (
  <CalendarOAuthManager provider="outlook" ... />
)}
```

### Part 3: Improve Test Email Feedback

Currently the test email shows success even if delivery fails. Update to show clearer feedback:

```typescript
const sendTestEmail = async () => {
  if (!email) {
    toast({
      title: "Email Required",
      description: "Please enter an email address before testing.",
      variant: "destructive",
    });
    return;
  }
  
  try {
    const { data, error } = await supabase.functions.invoke('send-unified-notification', {...});
    
    if (error) throw error;
    
    toast({
      title: "Test Email Sent",
      description: `Email notification sent to ${email}. Please check your inbox.`,
    });
  } catch (error) {
    console.error('Error sending test email:', error);
    toast({
      title: "Email Test Failed",
      description: error.message || "Could not send test email. Check your email configuration.",
      variant: "destructive",
    });
  }
};
```

### Part 4: Add Same Pattern for Google Calendar

Apply the same connection button pattern for Google Calendar consistency.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/NotificationSettings.tsx` | Add inline OAuth buttons for Outlook/Google; show expiry status; improve test feedback |

---

## UI After Fix

```text
+--------------------------------------------+
| Delivery Channels                          |
|                                            |
| [Email toggle] ✓ Enabled                   |
|   your@email.com                           |
|                                            |
| [Outlook Calendar]                         |
|   Create events with native phone reminders|
|   ⚠ Connection expired                     |
|   [ 🔄 Reconnect Outlook Calendar ]        |
|                                            |
| [Google Calendar]                          |
|   Create calendar events                   |
|   [ Connect Google Calendar ]              |
|                                            |
| [Slack toggle] ✓ Enabled                   |
+--------------------------------------------+
```

---

## Technical Details

### OAuth Flow Integration

The `CalendarOAuthManager` component already handles the full OAuth flow:
1. Calls `calendar-token-manager` edge function to get OAuth URL
2. Redirects user to Microsoft/Google consent screen
3. Callback handled by `useOAuthCallback` hook (already in Settings page)
4. Tokens stored in `calendar_connections` table

### Why Connections Show "Not Connected"

The `get_calendar_connections_safe` RPC uses `auth.uid()` to filter by current user. If:
- User is in demo mode → no connections shown
- Tokens expired → connections still shown (the query doesn't filter by expiry)

The issue is the UI isn't fetching the `expires_at` field to show expired status.

---

## Expected Behavior After Fix

1. Go to Settings → Notifications
2. See Outlook shows "Connection expired" with a "Reconnect" button
3. Click button → redirected to Microsoft login
4. After auth → return to Settings with fresh tokens
5. Test Email shows clear success/failure message with email address
6. Test Outlook Event creates an event in your calendar with reminder
