

# Fix Demo Mode Activity Logging for WebRTC Voice Sessions

## Problem Summary

The Instance Visibility feature was implemented but **silently fails in demo mode** because:
1. `logActivity()` requires `this.userId` which is null when not authenticated
2. `saveTranscript()` has the same guard
3. The demo user ID is only set in the edge function, not in the client-side class

## Root Cause

| Component | Current Behavior | Expected Behavior |
|-----------|------------------|-------------------|
| `RealtimeVoiceAssistant.userId` | Set from `supabase.auth.getUser()` → null in demo | Should fall back to demo user ID |
| `logActivity()` | Returns early if no userId | Should log with demo user ID |
| `saveTranscript()` | Returns early if no userId | Should save with demo user ID |

## Solution

Modify `src/utils/RealtimeVoiceAssistant.ts` to use the demo user ID as a fallback when no authenticated user exists.

### Change 1: Set Demo User ID Fallback in `connect()`

**Location**: `src/utils/RealtimeVoiceAssistant.ts` around line 374

```typescript
// CURRENT:
const { data: { user } } = await supabase.auth.getUser();
this.userId = user?.id || null;

// FIXED:
const { data: { user } } = await supabase.auth.getUser();
// Use demo user ID as fallback for unauthenticated sessions
this.userId = user?.id || '00000000-0000-0000-0000-000000000001';
console.log(`[VOICE] User ID: ${this.userId} (demo=${!user?.id})`);
```

This single change enables both activity logging and transcript saving for demo mode because both methods check `this.userId`.

### Change 2: Add Instance Count to Activity Log Metadata

**Location**: `src/utils/RealtimeVoiceAssistant.ts` in `logActivity()` method

Add the current instance count to metadata for debugging visibility:

```typescript
metadata: {
  tts_provider: this.ttsProvider,
  connection_time_ms: this.connectionStartTime ? Date.now() - this.connectionStartTime : 0,
  instance_id: this.instanceId,
  active_instances: activeInstances.size,  // ADD THIS
  ...extra.metadata
}
```

## Files to Modify

| File | Change |
|------|--------|
| `src/utils/RealtimeVoiceAssistant.ts` | Add demo user fallback + include instance count in metadata |

## Expected Results After Fix

1. **Activity Log Populated**: `SELECT * FROM activity_log WHERE activity_type = 'voice_webrtc'` will return WebRTC sessions
2. **Instance Count Visible**: Each activity log entry will have `metadata.active_instances` showing how many connections were active
3. **Transcripts Saved**: `SELECT * FROM conversation_messages WHERE voice_session_id LIKE 'WR%'` will return WebRTC transcripts

## Verification Query

```sql
SELECT 
  session_id,
  status,
  stage,
  metadata->>'instance_id' as instance_id,
  metadata->>'active_instances' as active_instances,
  created_at
FROM activity_log 
WHERE activity_type = 'voice_webrtc'
ORDER BY created_at DESC
LIMIT 10;
```

## Technical Notes

- This mirrors how `generate-realtime-token` already uses demo user ID for unauthenticated requests
- The demo user ID has RLS policies allowing SELECT, INSERT, UPDATE on relevant tables
- No database schema changes required
- Console logging still works independently for immediate debugging

