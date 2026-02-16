
# Fix: Voicemail Fallback to Chat Not Firing

## Root Cause Analysis

Three bugs prevent the fallback from ever working:

### Bug 1: Session ID Mismatch
The status-callback (line 1480) queries `pre_connect_sessions` using `statusData.callSid` (Twilio's Call SID, e.g., `CA1234...`). But the session was stored with a custom `sessionId` (a UUID generated before the call). These are completely different values, so the lookup **always returns null**, meaning `userId`, `context`, and `agenda` are all lost.

**Fix**: When the Twilio call is created (line 948-949), we already log the CallSid and sessionId. We need to **store the CallSid alongside the session** so the status-callback can find it. The cleanest approach: add a `call_sid` column to `pre_connect_sessions` and update it after the Twilio API responds.

### Bug 2: Session Deleted Before Status-Callback
`getPreConnectSession` (session-manager.ts line 87) deletes the session after the call connects (one-time use). The status-callback fires **after** the call ends, so the session is already gone.

**Fix**: Don't delete the session on retrieval. Instead, rely on the existing TTL-based cleanup (`cleanupExpiredSessions`). Extend the TTL from 2 minutes to 30 minutes to survive the full call lifecycle.

### Bug 3: No Answering Machine Detection
The Twilio call creation does not include the `MachineDetection` parameter, so `AnsweredBy` is always null in the status-callback. Voicemail is never detected -- only `no-answer`/`busy`/`failed` statuses trigger fallback.

**Fix**: Add `MachineDetection=DetectMessageEnd` to the Twilio API call parameters.

## Changes

### Database Migration

```sql
ALTER TABLE public.pre_connect_sessions
ADD COLUMN IF NOT EXISTS call_sid TEXT;
```

### File: `supabase/functions/twilio-voice-handler/index.ts`

1. **triggerOutboundCallWithSession** (after line 948): After getting `callData.sid` from Twilio, update the `pre_connect_sessions` row to store the `call_sid`:
   ```typescript
   // Store CallSid so status-callback can find this session
   const supabase = createClient(supabaseUrl, supabaseServiceKey);
   await supabase.from('pre_connect_sessions')
     .update({ call_sid: callData.sid })
     .eq('session_id', sessionId);
   ```

2. **triggerOutboundCallWithSession** (line 916-924): Add `MachineDetection` parameter:
   ```typescript
   requestBody.append('MachineDetection', 'DetectMessageEnd');
   ```

3. **status-callback** (line 1477-1481): Change the session lookup to query by `call_sid` instead of `session_id`:
   ```typescript
   const { data: session } = await supabase
     .from('pre_connect_sessions')
     .select('user_id, context, agenda, greeting_text, timezone')
     .eq('call_sid', statusData.callSid)
     .maybeSingle();
   ```

4. **Also handle `triggerOutboundCall`** (the non-session path): Apply the same `MachineDetection` parameter so all outbound calls support voicemail detection.

### File: `supabase/functions/_shared/session-manager.ts`

1. **getPreConnectSession** (line 87): Remove the delete-on-retrieval behavior. Change it to just return the data without deleting.
2. **storePreConnectSession** (line 57): Increase TTL from 2 minutes to 30 minutes to survive the full call lifecycle:
   ```typescript
   expires_at: new Date(Date.now() + 1800000).toISOString() // 30 min TTL
   ```

### File: `supabase/functions/twilio-scheduled-call/index.ts`

No changes needed -- this function creates sessions and triggers calls, which already use `storePreConnectSession`. The fix is downstream.

## Expected Behavior After Fix

1. Scheduled call fires at 6 AM
2. Twilio dials the user's phone; `MachineDetection=DetectMessageEnd` is enabled
3. Phone is dead / goes to voicemail: Twilio reports `CallStatus=no-answer` or `AnsweredBy=machine_start`
4. Status-callback fires: queries `pre_connect_sessions` by `call_sid`, finds the session with full agenda/context
5. Reads user's `fallbackMode` from `user_scheduling_prefs` (defaults to `app_message`)
6. Calls `send-chat-message` with the agenda summary
7. User turns phone on, opens app, sees the missed-call chat message with their schedule

## Files Changed

| File | Change |
|------|--------|
| **Migration** | Add `call_sid TEXT` column to `pre_connect_sessions` |
| `supabase/functions/twilio-voice-handler/index.ts` | Store `call_sid` after Twilio API call; fix session lookup to use `call_sid`; add `MachineDetection` param |
| `supabase/functions/_shared/session-manager.ts` | Remove delete-on-retrieval; extend TTL to 30 min |
