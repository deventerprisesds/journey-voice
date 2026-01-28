

# Unified Logging System for Faster Debugging

## The Core Problem

You're right to be frustrated. The current system has **four critical visibility gaps**:

| Issue | Impact |
|-------|--------|
| **RLS blocks frontend inserts** | `activity_log` only has INSERT policy for `service_role`. WebRTC calls from browser (using `anon` key) silently fail to log. |
| **No dedicated error table** | Errors get stuffed into `activity_log.error_message` field, mixed with normal activity. No way to quickly query "show me all recent errors." |
| **Edge function errors vanish** | `console.log()` in edge functions expires quickly. No persistent error storage. |
| **Demo user can't log** | Demo mode (unauthenticated) uses `anon` role which has no INSERT policy on `activity_log`. |

**Proof**: The database shows only **2 phone_outbound entries** in `activity_log` - both created by edge functions using service role. Zero WebRTC entries exist despite the logging code being present in `RealtimeVoiceAssistant.ts`.

## Solution: Three-Tier Unified Logging

### Tier 1: Fix Existing activity_log RLS

Add policies so frontend code can actually write logs:

```sql
-- Allow authenticated users to insert/update their own activity
CREATE POLICY "Users can insert their own activity"
ON activity_log FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own activity"
ON activity_log FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Allow demo user (anon role) to log
CREATE POLICY "Demo user can insert activity"
ON activity_log FOR INSERT TO anon
WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Demo user can update activity"
ON activity_log FOR UPDATE TO anon
USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);
```

### Tier 2: Create Dedicated error_log Table

A separate table specifically for errors with permissive policies:

```sql
CREATE TABLE error_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  source TEXT NOT NULL,        -- 'webrtc', 'phone', 'edge_function', 'frontend'
  component TEXT,              -- 'RealtimeVoiceAssistant', 'generate-realtime-token', etc.
  session_id TEXT,             -- May be null if error occurs before session created
  user_id UUID,                -- May be null for unauthenticated errors
  error_type TEXT NOT NULL,    -- 'connection_failed', 'api_error', 'timeout', etc.
  error_message TEXT NOT NULL,
  error_code TEXT,             -- HTTP status, error code, etc.
  stack_trace TEXT,
  context JSONB DEFAULT '{}'   -- Full state dump for debugging
);

ALTER TABLE error_log ENABLE ROW LEVEL SECURITY;

-- PERMISSIVE: Anyone can insert errors (we want to capture ALL failures)
CREATE POLICY "Anyone can insert errors"
ON error_log FOR INSERT TO public
WITH CHECK (true);

-- Users can view their own errors
CREATE POLICY "Users can view own errors"
ON error_log FOR SELECT TO authenticated
USING (auth.uid() = user_id);

-- Service role can view all
CREATE POLICY "Service can view all errors"
ON error_log FOR SELECT TO service_role
USING (true);
```

### Tier 3: Create Quick Debug Views

Views I can query immediately when you say "debug the last call":

```sql
-- Recent errors (last 24 hours)
CREATE VIEW recent_errors AS
SELECT 
  created_at,
  source,
  component,
  session_id,
  error_type,
  error_message,
  context
FROM error_log
WHERE created_at > now() - interval '24 hours'
ORDER BY created_at DESC
LIMIT 50;

-- Combined debug timeline (activities + errors)
CREATE VIEW debug_timeline_full AS
SELECT 
  created_at as timestamp,
  'activity' as log_type,
  activity_type as source,
  session_id,
  status,
  stage,
  error_message,
  metadata::text as context,
  user_id
FROM activity_log
WHERE created_at > now() - interval '24 hours'
UNION ALL
SELECT 
  created_at as timestamp,
  'error' as log_type,
  source,
  session_id,
  error_type as status,
  component as stage,
  error_message,
  context::text,
  user_id
FROM error_log
WHERE created_at > now() - interval '24 hours'
ORDER BY timestamp DESC
LIMIT 100;
```

## Code Changes

### File: `src/utils/RealtimeVoiceAssistant.ts`

Add a dedicated `logError()` method that writes to `error_log` with no guards:

```typescript
// New method - ALWAYS logs, even without userId/sessionId
private async logError(
  errorType: string,
  errorMessage: string,
  context: Record<string, any> = {}
): Promise<void> {
  try {
    await supabase.from('error_log').insert({
      source: 'webrtc',
      component: 'RealtimeVoiceAssistant',
      session_id: this.sessionId || null,
      user_id: this.userId || null,
      error_type: errorType,
      error_message: errorMessage,
      context: {
        instance_id: this.instanceId,
        tts_provider: this.ttsProvider,
        stage: context.stage,
        ...context
      }
    });
  } catch (e) {
    // Last resort - at least console log
    console.error('[ERROR_LOG] Failed to persist error:', e, { errorType, errorMessage });
  }
}
```

Then use it in all catch blocks:

```typescript
} catch (error) {
  const errorMsg = error instanceof Error ? error.message : String(error);
  await this.logError('connection_failed', errorMsg, { 
    stage: 'token_fetch',
    stack: error instanceof Error ? error.stack : undefined 
  });
  throw error;
}
```

### File: `supabase/functions/generate-realtime-token/index.ts`

Add error logging to the edge function:

```typescript
// At the top, create supabase client
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// In catch block
} catch (error) {
  console.error("Error generating token:", error);
  
  // Persist error to database
  await supabaseAdmin.from('error_log').insert({
    source: 'edge_function',
    component: 'generate-realtime-token',
    user_id: userId,
    error_type: 'token_generation_failed',
    error_message: error instanceof Error ? error.message : String(error),
    context: { 
      ttsProvider,
      stack: error instanceof Error ? error.stack : undefined 
    }
  });
  
  return new Response(...);
}
```

### File: `supabase/functions/twilio-realtime-bridge/index.ts`

Same pattern - log all errors to `error_log` table.

## Expected Outcome

After implementation, when you say "debug the last call":

```sql
-- Step 1: Check recent errors
SELECT * FROM recent_errors LIMIT 10;

-- Step 2: Get full timeline
SELECT * FROM debug_timeline_full WHERE session_id LIKE 'WR%' LIMIT 20;

-- Step 3: Specific session deep dive
SELECT * FROM error_log WHERE session_id = 'WRxxx' ORDER BY created_at;
```

I will **immediately** see:
- What failed
- When it failed  
- Where it failed (component)
- Full context (state at time of failure)
- Stack trace if available

## Files to Modify

| File | Changes |
|------|---------|
| Database migration | Add RLS policies to `activity_log`, create `error_log` table, create views |
| `src/utils/RealtimeVoiceAssistant.ts` | Add `logError()` method, use in all catch blocks |
| `supabase/functions/generate-realtime-token/index.ts` | Add error persistence to `error_log` |
| `supabase/functions/twilio-realtime-bridge/index.ts` | Add error persistence to `error_log` |

## Why This Works

1. **RLS-aware**: Policies allow both authenticated and demo users to log
2. **Fail-safe**: `error_log` has permissive INSERT policy - errors WILL be captured
3. **Queryable**: Views provide instant debugging capability
4. **Unified**: Both frontend and edge functions write to the same tables
5. **Persistent**: Errors survive edge function log expiration

