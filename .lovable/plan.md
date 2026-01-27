

# Unified Activity Timeline with Proper Error Handling

## Problem Summary

**Two critical issues are causing debugging confusion:**

1. **Silent Query Failures**: When database queries fail or return empty results, there's no way to distinguish between "no data exists" and "query failed" - both look the same (empty results)

2. **Fragmented Activity Tracking**: Activity is scattered across 4+ tables with no unified timeline:
   - `call_sessions` - Phone calls (Twilio)
   - `ai_threads` - Chat/voice threads
   - `conversation_messages` - Messages from all modes
   - WebRTC sessions - **NOT TRACKED AT ALL** (zero records with `WR%` prefix found)

**The real issue with your midday call**: There is NO inbound call recorded in `call_sessions` today. The last inbound call was yesterday at 16:25:39. This means either:
- The call never connected to the system
- The session insert failed silently
- Twilio webhook didn't fire

---

## Solution: Unified Activity Log + Error Visibility

### Phase 1: Create Unified Activity Log Table

A single table that captures ALL communication events with proper error tracking:

```sql
CREATE TABLE public.activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  
  -- Activity identification
  activity_type TEXT NOT NULL,  -- 'phone_inbound', 'phone_outbound', 'voice_webrtc', 'chat'
  session_id TEXT,              -- WR... for WebRTC, MZ... for Twilio, thread_... for chat
  
  -- Status tracking
  status TEXT NOT NULL,         -- 'started', 'connected', 'completed', 'failed', 'error'
  stage TEXT,                   -- 'webhook', 'token_fetch', 'webrtc_setup', 'transcript_save'
  
  -- Error details
  error_message TEXT,
  error_code TEXT,
  
  -- Metrics
  duration_seconds INTEGER,
  message_count INTEGER DEFAULT 0,
  
  -- Rich context
  metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Fast lookup indexes
CREATE INDEX idx_activity_log_user_time ON activity_log(user_id, created_at DESC);
CREATE INDEX idx_activity_log_session ON activity_log(session_id);
CREATE INDEX idx_activity_log_status ON activity_log(status);

-- RLS Policy
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own activity" ON activity_log
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role can manage activity" ON activity_log
  FOR ALL USING (true);
```

---

### Phase 2: Add Activity Logging to Twilio Bridge

Update `supabase/functions/twilio-realtime-bridge/index.ts` to log at key stages:

**On Webhook Receipt (FIRST thing)**:
```typescript
// Log immediately when webhook is received - before any processing
await supabase.from('activity_log').insert({
  user_id: userId,
  activity_type: direction === 'inbound' ? 'phone_inbound' : 'phone_outbound',
  session_id: streamSid,
  status: 'started',
  stage: 'webhook',
  metadata: { 
    call_sid: callSid,
    direction,
    from_number: fromNumber,
    to_number: toNumber,
    raw_webhook: true
  }
});
```

**On Successful Connection**:
```typescript
await supabase.from('activity_log').upsert({
  session_id: streamSid,
  status: 'connected',
  stage: 'openai_connected'
}, { onConflict: 'session_id' });
```

**On Call End**:
```typescript
await supabase.from('activity_log').update({
  status: 'completed',
  ended_at: new Date().toISOString(),
  duration_seconds: durationSeconds,
  message_count: transcriptCount
}).eq('session_id', streamSid);
```

**On Any Error**:
```typescript
await supabase.from('activity_log').upsert({
  session_id: streamSid || `error_${Date.now()}`,
  status: 'error',
  stage: 'openai_connect',  // or wherever error occurred
  error_message: error.message,
  error_code: error.code
}, { onConflict: 'session_id' });
```

---

### Phase 3: Add Activity Logging to WebRTC Voice

Update `src/utils/RealtimeVoiceAssistant.ts`:

**Generate Session ID FIRST** (before any async calls):
```typescript
async connect() {
  // STEP 1: Generate session ID IMMEDIATELY
  this.sessionId = `WR${Date.now().toString(36)}${crypto.randomUUID().substring(0, 8)}`;
  this.connectionStartTime = Date.now();
  
  // Get user for logging
  const { data: { user } } = await supabase.auth.getUser();
  this.userId = user?.id || null;
  
  // STEP 2: Log activity start BEFORE any async operations
  await this.logActivity('started', 'token_fetch');
  
  try {
    // ... existing token fetch code ...
    
    await this.logActivity('connected', 'webrtc_setup');
    
  } catch (error) {
    await this.logActivity('error', 'token_fetch', { 
      error_message: error.message 
    });
    throw error;
  }
}
```

**Add logging helper method**:
```typescript
private async logActivity(
  status: string, 
  stage: string, 
  extra: Record<string, any> = {}
): Promise<void> {
  if (!this.userId) return;
  
  try {
    const { error } = await supabase.from('activity_log').upsert({
      user_id: this.userId,
      activity_type: 'voice_webrtc',
      session_id: this.sessionId,
      status,
      stage,
      error_message: extra.error_message,
      metadata: {
        tts_provider: this.ttsProvider,
        connection_time_ms: Date.now() - (this.connectionStartTime || Date.now()),
        ...extra
      },
      started_at: new Date(this.connectionStartTime || Date.now()).toISOString()
    }, {
      onConflict: 'session_id'
    });
    
    if (error) {
      console.error('[ACTIVITY_LOG] Failed to log activity:', error);
    }
  } catch (err) {
    console.error('[ACTIVITY_LOG] Exception logging activity:', err);
  }
}
```

---

### Phase 4: Add Error Visibility to Queries

Create a helper function for database queries that distinguishes between "no data" and "query failed":

```typescript
// src/utils/dbQuery.ts
export interface QueryResult<T> {
  data: T[] | null;
  error: Error | null;
  isEmpty: boolean;
  isError: boolean;
}

export async function safeQuery<T>(
  queryFn: () => Promise<{ data: T[] | null; error: any }>
): Promise<QueryResult<T>> {
  try {
    const { data, error } = await queryFn();
    
    if (error) {
      console.error('[DB_QUERY] Query failed:', error);
      return {
        data: null,
        error: error,
        isEmpty: false,
        isError: true
      };
    }
    
    return {
      data: data,
      error: null,
      isEmpty: !data || data.length === 0,
      isError: false
    };
  } catch (err) {
    console.error('[DB_QUERY] Exception during query:', err);
    return {
      data: null,
      error: err as Error,
      isEmpty: false,
      isError: true
    };
  }
}
```

---

### Phase 5: Debug Helper View

Create a database view for easy debugging:

```sql
CREATE OR REPLACE VIEW debug_timeline AS
SELECT 
  created_at as timestamp,
  activity_type,
  status,
  stage,
  session_id,
  duration_seconds,
  message_count,
  error_message,
  user_id
FROM activity_log
WHERE created_at > NOW() - INTERVAL '24 hours'

UNION ALL

-- Include legacy call_sessions for backward compatibility
SELECT 
  started_at as timestamp,
  CASE direction 
    WHEN 'inbound' THEN 'phone_inbound'
    WHEN 'outbound' THEN 'phone_outbound'
  END as activity_type,
  CASE 
    WHEN ended_at IS NOT NULL THEN 'completed'
    ELSE 'started'
  END as status,
  'legacy' as stage,
  stream_sid as session_id,
  duration_seconds,
  NULL as message_count,
  NULL as error_message,
  user_id
FROM call_sessions
WHERE started_at > NOW() - INTERVAL '24 hours'

ORDER BY timestamp DESC;
```

---

## Files to Modify

| File | Changes |
|------|---------|
| Database | Create `activity_log` table with indexes and RLS |
| `supabase/functions/twilio-realtime-bridge/index.ts` | Add activity logging at webhook, connect, end, and error stages |
| `src/utils/RealtimeVoiceAssistant.ts` | Add activity logging before token fetch, on connect, on error |
| `src/utils/dbQuery.ts` (new) | Helper for distinguishing query failures from empty results |

---

## Debug Query (After Implementation)

A single query to see ALL recent activity:

```sql
SELECT 
  timestamp,
  activity_type,
  status,
  stage,
  session_id,
  duration_seconds,
  error_message
FROM debug_timeline
WHERE user_id = 'YOUR_USER_ID'
ORDER BY timestamp DESC
LIMIT 20;
```

**Expected output shows clear timeline:**
```
timestamp           | activity_type  | status    | stage         | session_id    | error
--------------------|----------------|-----------|---------------|---------------|-------
2026-01-27 17:45:00 | phone_inbound  | error     | openai_connect| MZ12345...    | WebSocket timeout
2026-01-27 17:44:58 | phone_inbound  | started   | webhook       | MZ12345...    | NULL
2026-01-27 17:30:39 | phone_outbound | completed | NULL          | MZ41ecc...    | NULL
2026-01-27 17:30:18 | phone_outbound | started   | webhook       | MZ41ecc...    | NULL
```

---

## Expected Outcome

1. **Every connection attempt is logged** - Even if it fails at token fetch, there's a record
2. **Error visibility** - Know exactly WHERE in the flow something failed
3. **Single timeline** - Query one table to see all activity across all modes
4. **No more false negatives** - Distinguish "query failed" from "no data exists"
5. **Debug with confidence** - The session ID from `activity_log` links to `call_sessions`, `conversation_messages`, etc.

