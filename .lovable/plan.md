# Unified Activity Timeline - IMPLEMENTED ✅

## Status: Complete

The unified activity logging system is now implemented across all communication modes.

---

## What Was Implemented

### 1. Database: `activity_log` table + `debug_timeline` view
- Captures ALL communication events in one place
- Tracks: phone_inbound, phone_outbound, voice_webrtc, chat
- Status tracking: started, connected, completed, failed, error
- Stage tracking: webhook, token_fetch, webrtc_setup, openai_websocket
- Error details: error_message, error_code
- Metrics: duration_seconds, message_count
- Indexes on user_id, session_id, status for fast queries

### 2. WebRTC Voice (`src/utils/RealtimeVoiceAssistant.ts`)
- Session ID (`WR...`) generated FIRST before any async operations
- Activity logged at: started (token_fetch), connected (webrtc_ready), error (any stage), completed (disconnect)
- Message count tracked for session metrics
- All errors now logged with stage context

### 3. Twilio Bridge (`supabase/functions/twilio-realtime-bridge/index.ts`)
- Activity logged at: started (webhook), connected (session_configured), error (openai_websocket), completed (closeCallSession)
- Session ID uses stream_sid for correlation
- Metrics include: greeting_latency, response_create_count, audio_frames

### 4. Query Helper (`src/utils/dbQuery.ts`)
- `safeQuery<T>()` - distinguishes between query failure and empty results
- `safeSingleQuery<T>()` - for single row queries
- `logActivity()` - helper for consistent activity logging
- All functions log timing and error details

---

## Debug Query

Single query to see ALL recent activity across modes:

```sql
SELECT 
  timestamp,
  activity_type,
  status,
  stage,
  session_id,
  duration_seconds,
  message_count,
  error_message
FROM debug_timeline
WHERE user_id = 'YOUR_USER_ID'
ORDER BY timestamp DESC
LIMIT 20;
```

---

## Expected Output

```
timestamp           | activity_type  | status    | stage           | session_id    | duration | msgs | error
--------------------|----------------|-----------|-----------------|---------------|----------|------|-------
2026-01-27 18:30:00 | voice_webrtc   | completed | disconnect      | WR4a3b2c1...  | 45       | 8    | NULL
2026-01-27 18:29:15 | voice_webrtc   | connected | webrtc_ready    | WR4a3b2c1...  | NULL     | 0    | NULL
2026-01-27 18:29:14 | voice_webrtc   | started   | token_fetch     | WR4a3b2c1...  | NULL     | 0    | NULL
2026-01-27 17:45:00 | phone_inbound  | completed | NULL            | MZ12345...    | 120      | 15   | NULL
2026-01-27 17:43:00 | phone_inbound  | started   | webhook         | MZ12345...    | NULL     | 0    | NULL
2026-01-27 17:30:39 | phone_outbound | completed | legacy          | MZ41ecc...    | 90       | NULL | NULL
```

---

## Files Modified

| File | Changes |
|------|---------|
| Database | Created `activity_log` table + `debug_timeline` view |
| `src/utils/RealtimeVoiceAssistant.ts` | Added `logActivity()` method, session ID generation FIRST, logging at all stages |
| `supabase/functions/twilio-realtime-bridge/index.ts` | Added activity logging to createCallSession, closeCallSession, onerror |
| `src/utils/dbQuery.ts` (NEW) | Helper for safe queries + activity logging |

---

## Benefits Achieved

1. **Every connection attempt is logged** - Even if token fetch fails, there's a record
2. **Error visibility** - Know exactly WHERE in the flow something failed
3. **Single timeline** - Query one table to see all activity across all modes
4. **No more false negatives** - Distinguish "query failed" from "no data exists"
5. **Debug with confidence** - Session IDs link to call_sessions, conversation_messages
