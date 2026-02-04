# commsMode Routing Implementation - COMPLETED

## Summary

The commsMode routing fix has been implemented. Scheduled calls now respect the delivery method setting (phone, app_message, slack, email).

## Changes Made

### 1. Database Functions (Migration Applied)
- `schedule_next_call()` - Added `p_comms_mode` parameter
- `sync_scheduled_calls()` - Extracts `commsMode` from scheduled_calls JSON and passes it through

### 2. Edge Function Updated
- `notification-delivery` - Routes delivery based on `comms_mode`:
  - `app_message` → `send-chat-message` + push
  - `slack`/`email` → `send-unified-notification`
  - `phone` (default) → Twilio voice call

## Re-sync Required

To update existing scheduled notifications with the new comms_mode, go to Settings and toggle any scheduled call off/on, or update any setting field. This triggers the `sync_scheduled_calls` trigger which will recreate notifications with the correct `comms_mode`.

Alternatively, run in Supabase SQL Editor:
```sql
UPDATE user_scheduling_prefs SET updated_at = NOW() WHERE scheduled_calls IS NOT NULL;
```
