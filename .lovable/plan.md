
# Fix: Outlook Calendar Event Reminders for Task Notifications

## Problem Summary

The Outlook reminder option in Settings doesn't work because:

1. **Notification delivery uses external webhook**: When you enable `OUTLOOK_EVENT` channel, the `send-unified-notification` function sends data to an external n8n webhook (`UNIFIED_WEBHOOK_URL`) rather than using the Microsoft Graph API directly
2. **Direct API integration exists but isn't used**: The `calendar-integration-manager` function has working Microsoft Graph API code for creating Outlook events, but notifications don't use it
3. **Missing connection between channels and OAuth tokens**: The notification system doesn't retrieve your Office 365 OAuth tokens to create events directly

## Current Flow (Broken)
```text
Task Due Reminder
    ↓
notification-delivery reads user's channels (includes OUTLOOK_EVENT)
    ↓
Calls send-unified-notification with OUTLOOK_EVENT channel
    ↓
send-unified-notification builds event payload
    ↓
Sends to UNIFIED_WEBHOOK_URL (n8n webhook)
    ↓
n8n webhook may or may not handle Outlook correctly
    ↓
❌ No event appears in Outlook
```

## Proposed Flow (Fixed)
```text
Task Due Reminder
    ↓
notification-delivery reads user's channels (includes OUTLOOK_EVENT)
    ↓
Calls send-unified-notification with OUTLOOK_EVENT channel
    ↓
send-unified-notification detects OUTLOOK_EVENT
    ↓
Fetches user's Office 365 OAuth tokens via get_office365_connection_secure()
    ↓
Creates event directly via Microsoft Graph API
    ↓
✅ Event with reminder appears in Outlook app
```

## Solution: Direct Microsoft Graph API Integration

### Part 1: Update send-unified-notification Edge Function

Modify `supabase/functions/send-unified-notification/index.ts` to create Outlook events directly using the Microsoft Graph API instead of relying on the external webhook.

**New function to add:**
```typescript
async function createOutlookEventDirect(
  supabaseClient: any,
  userId: string,
  eventData: {
    title: string;
    startTime: string;
    endTime: string;
    description?: string;
    reminderMinutes?: number;
  }
): Promise<{ success: boolean; eventId?: string; error?: string }> {
  // 1. Get user's Office 365 connection with decrypted tokens
  const { data: connection, error } = await supabaseClient
    .rpc('get_office365_connection_secure');
  
  if (error || !connection || connection.length === 0) {
    return { success: false, error: 'No Office 365 connection found' };
  }
  
  const { access_token, refresh_token, expires_at } = connection[0];
  
  // 2. Check if token needs refresh
  if (new Date(expires_at) < new Date()) {
    // Refresh token logic (call calendar-token-manager)
  }
  
  // 3. Create event via Microsoft Graph API
  const event = {
    subject: eventData.title,
    body: {
      contentType: 'text',
      content: eventData.description || '',
    },
    start: {
      dateTime: eventData.startTime,
      timeZone: 'UTC',
    },
    end: {
      dateTime: eventData.endTime,
      timeZone: 'UTC',
    },
    isReminderOn: true,
    reminderMinutesBeforeStart: eventData.reminderMinutes || 15,
  };
  
  const response = await fetch(
    'https://graph.microsoft.com/v1.0/me/calendar/events',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    }
  );
  
  if (!response.ok) {
    return { success: false, error: `Graph API error: ${response.status}` };
  }
  
  const result = await response.json();
  return { success: true, eventId: result.id };
}
```

**Modify the main flow** to use direct creation for Outlook:
```typescript
// In callUnifiedWebhook function, add before sending to external webhook:
if (payload.channels.includes('OUTLOOK_EVENT')) {
  const outlookResult = await createOutlookEventDirect(
    supabaseClient,
    payload.userId,
    {
      title: dynamicOutlookEvent?.title || payload.title || 'Task Reminder',
      startTime: dynamicOutlookEvent?.startTime || new Date().toISOString(),
      endTime: dynamicOutlookEvent?.endTime || new Date(Date.now() + 60*60*1000).toISOString(),
      description: payload.body,
      reminderMinutes: 15,
    }
  );
  
  result.channelResults.outlook = outlookResult;
  
  // Remove OUTLOOK_EVENT from channels going to external webhook
  payload.channels = payload.channels.filter(c => c !== 'OUTLOOK_EVENT');
}
```

### Part 2: Add Token Refresh Support

Create a helper function to refresh expired tokens using the existing `calendar-token-manager`:

```typescript
async function refreshOutlookToken(
  supabaseClient: any,
  connectionId: string,
  refreshToken: string
): Promise<string | null> {
  // Call the token manager to refresh
  const { data, error } = await supabaseClient.functions.invoke(
    'calendar-token-manager',
    {
      body: {
        action: 'refresh',
        provider: 'office365',
        connection_id: connectionId,
        refresh_token: refreshToken,
      }
    }
  );
  
  return error ? null : data?.access_token;
}
```

### Part 3: Update Notification Settings UI

Enhance the Outlook toggle with connection status and test button:

```typescript
{/* Outlook Calendar Events */}
<div className="flex items-center justify-between p-3 rounded-lg border">
  <div className="flex items-center gap-3">
    <Calendar className="h-5 w-5 text-blue-500" />
    <div>
      <span className="font-medium">Outlook Calendar</span>
      <p className="text-xs text-muted-foreground">
        Creates events with native phone reminders
      </p>
      {/* Show connection status */}
      {hasOutlookConnection ? (
        <p className="text-xs text-green-600">
          ✓ Connected: {outlookEmail}
        </p>
      ) : (
        <p className="text-xs text-amber-600">
          ⚠ Not connected - add in Calendar settings
        </p>
      )}
    </div>
  </div>
  <div className="flex items-center gap-2">
    <Switch 
      checked={prefs.channels.includes('OUTLOOK_EVENT')} 
      onCheckedChange={() => handleToggleChannel('OUTLOOK_EVENT')}
      disabled={!hasOutlookConnection}
    />
    <Button 
      size="sm" 
      variant="outline" 
      onClick={sendTestOutlookEvent}
      disabled={!hasOutlookConnection}
    >
      Test
    </Button>
  </div>
</div>
```

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/send-unified-notification/index.ts` | Add direct Microsoft Graph API integration for Outlook events |
| `src/components/NotificationSettings.tsx` | Show Outlook connection status; disable toggle if not connected |

## Technical Details

### Microsoft Graph API Event Creation

The key properties for native reminders:
```json
{
  "subject": "Task: Review Report",
  "isReminderOn": true,
  "reminderMinutesBeforeStart": 15,
  "start": {
    "dateTime": "2026-02-01T14:00:00",
    "timeZone": "America/New_York"
  },
  "end": {
    "dateTime": "2026-02-01T15:00:00", 
    "timeZone": "America/New_York"
  }
}
```

### Existing OAuth Infrastructure

Your project already has:
- `calendar_connections` table with encrypted tokens
- `get_office365_connection_secure()` RPC to decrypt tokens
- `calendar-token-manager` edge function for token refresh
- Working Office 365 connection (`Von.Ellis@EnterpriseDS.io`)

## Expected Behavior After Fix

1. Go to Settings → Notifications
2. Enable "Outlook Calendar" toggle (shows your connected account)
3. Click "Test" → Creates test event in Outlook with reminder
4. When task reminders are due, events appear in Outlook app with native notifications

The notification will appear as an Outlook event with:
- Native phone/desktop push notification
- Configurable reminder time (default 15 minutes before)
- Event details showing task title and description
