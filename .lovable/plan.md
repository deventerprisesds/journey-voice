

# Implement commsMode Routing for Scheduled Calls

## Overview

This implementation fixes the issue where recurring calls ignore the `commsMode` setting (e.g., "App Chat") and always default to phone calls. The fix requires both database function updates and edge function changes.

## Changes Required

### 1. SQL Migration: Update Database Functions

**File: New migration `add_comms_mode_to_scheduled_calls.sql`**

Update `schedule_next_call` function to accept and store `p_comms_mode`:

```sql
CREATE OR REPLACE FUNCTION public.schedule_next_call(
  p_user_id uuid, 
  p_call_id text, 
  p_call_name text, 
  p_call_time time without time zone, 
  p_call_context text, 
  p_timezone text DEFAULT 'America/New_York',
  p_comms_mode text DEFAULT 'phone'  -- NEW parameter
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_local_date DATE;
  v_next_datetime TIMESTAMPTZ;
  v_notification_id UUID;
BEGIN
  v_local_date := (NOW() AT TIME ZONE p_timezone)::DATE;
  v_next_datetime := (v_local_date + p_call_time) AT TIME ZONE p_timezone;
  
  IF v_next_datetime <= NOW() THEN
    v_next_datetime := ((v_local_date + INTERVAL '1 day') + p_call_time) AT TIME ZONE p_timezone;
  END IF;

  INSERT INTO scheduled_notifications (
    user_id, notification_type, title, body, scheduled_for
  ) VALUES (
    p_user_id,
    'scheduled_call',
    p_call_name,
    jsonb_build_object(
      'call_id', p_call_id,
      'call_name', p_call_name,
      'call_time', p_call_time::TEXT,
      'context', p_call_context,
      'timezone', p_timezone,
      'comms_mode', p_comms_mode  -- NEW: include comms_mode in JSON body
    )::TEXT,
    v_next_datetime
  )
  RETURNING id INTO v_notification_id;

  RETURN v_notification_id;
END;
$$;
```

Update `sync_scheduled_calls` trigger to extract and pass `commsMode`:

```sql
CREATE OR REPLACE FUNCTION public.sync_scheduled_calls()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_call JSONB;
  v_call_id TEXT;
  v_call_name TEXT;
  v_call_time TIME;
  v_call_enabled BOOLEAN;
  v_call_context TEXT;
  v_comms_mode TEXT;  -- NEW variable
  v_timezone TEXT;
BEGIN
  v_timezone := COALESCE(NEW.timezone, 'America/New_York');
  
  DELETE FROM scheduled_notifications
  WHERE user_id = NEW.user_id
    AND notification_type = 'scheduled_call'
    AND delivered_at IS NULL
    AND failed_at IS NULL;
  
  IF NEW.scheduled_calls IS NOT NULL THEN
    FOR v_call IN SELECT * FROM jsonb_array_elements(NEW.scheduled_calls)
    LOOP
      v_call_id := v_call->>'id';
      v_call_name := v_call->>'name';
      v_call_time := (v_call->>'time')::TIME;
      v_call_enabled := COALESCE((v_call->>'enabled')::BOOLEAN, false);
      v_call_context := COALESCE(v_call->>'context', '');
      v_comms_mode := COALESCE(v_call->>'commsMode', 'phone');  -- NEW: extract commsMode
      
      IF v_call_enabled AND v_call_time IS NOT NULL THEN
        PERFORM schedule_next_call(
          NEW.user_id,
          v_call_id,
          v_call_name,
          v_call_time,
          v_call_context,
          v_timezone,
          v_comms_mode  -- NEW: pass comms_mode
        );
      END IF;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$;
```

### 2. Edge Function: Update notification-delivery/index.ts

**Key changes in the scheduled_call processing section:**

1. **Update `scheduleNextOccurrence` function** (around line 127-150):
   - Extract `comms_mode` from `callConfig`
   - Pass `p_comms_mode` to the RPC call

2. **Add routing logic in the scheduled_call loop** (around line 233-376):
   - Parse `comms_mode` from `callConfig` (defaults to `'phone'`)
   - Route based on mode:
     - `app_message`: Call `send-chat-message` with context
     - `slack` or `email`: Call `send-unified-notification` with specific channel
     - `phone` (default): Use existing pre-connect + Twilio logic

**New routing structure:**

```typescript
// Parse comms_mode from callConfig
const commsMode = callConfig.comms_mode || 'phone';
console.log(`📞 Scheduled call comms_mode: ${commsMode}`);

if (commsMode === 'app_message') {
  // Route to send-chat-message
  const { data, error } = await supabaseClient.functions.invoke('send-chat-message', {
    body: {
      userId,
      generateFromContext: { callType: callConfig.call_id, context: callConfig.context },
      sendPush: true
    }
  });
  // Handle result...
  
} else if (commsMode === 'slack' || commsMode === 'email') {
  // Route to send-unified-notification
  const { data, error } = await supabaseClient.functions.invoke('send-unified-notification', {
    body: {
      userId,
      title: callConfig.call_name,
      body: `Time for your ${callConfig.call_name}. ${callConfig.context || ''}`,
      channels: [commsMode]
    }
  });
  // Handle result...
  
} else {
  // Default: phone call (existing logic)
  // ... existing pre-connect + Twilio code ...
}

// Schedule next occurrence with comms_mode preserved
await scheduleNextOccurrence(supabaseClient, userId, callConfig);
```

### 3. Re-sync Existing Pending Notifications

After migration, run a one-time re-sync to update pending notifications with correct `comms_mode`:

```sql
-- This will be triggered automatically by updating user_scheduling_prefs
-- Just touch the timezone field to re-trigger sync_scheduled_calls
UPDATE user_scheduling_prefs SET updated_at = NOW();
```

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| New SQL migration | CREATE | Add `p_comms_mode` to `schedule_next_call`, update `sync_scheduled_calls` |
| `supabase/functions/notification-delivery/index.ts` | MODIFY | Route scheduled_call based on `comms_mode` |

## Data Flow After Fix

```text
User sets commsMode: 'app_message' in Settings
         ↓
VoiceAssistantSettings saves to scheduled_calls JSON
         ↓
sync_scheduled_calls trigger extracts commsMode: 'app_message'
         ↓
schedule_next_call(p_comms_mode: 'app_message')
         ↓
scheduled_notifications.body JSON includes "comms_mode": "app_message"
         ↓
notification-delivery reads comms_mode from body
         ↓
Routes to send-chat-message → User gets app chat + push notification
```

## Expected Result

1. User sets "Test call" to use "App Chat" delivery in Settings
2. At scheduled time, `notification-delivery` picks up the notification
3. It parses `comms_mode: 'app_message'` from the notification body
4. Routes to `send-chat-message` instead of `twilio-voice-handler`
5. User receives in-app chat message + push notification (not a phone call)
6. Next occurrence is scheduled with `comms_mode` preserved

