

## Debug Analysis: Twilio Phone Calls Still Silent

### Evidence Summary

| Data Point | Value | Meaning |
|------------|-------|---------|
| Worker health version | `2026-01-28-cf-v3` | Correct version deployed |
| Most recent call | `CA41cbaaf7e7a21df7eb5914e87eec98c9` at 22:52 | Your last test call |
| Activity logs for call | Only `cf_disconnect` | No startup, greeting, or session logs |
| Errors for call | None | Call appeared to run but nothing happened |
| Earlier error logs | `Invalid value: 'input_text'. Value must be 'text'.` | Shows OLD code was running at 20:32 |
| Pre-connect sessions | Empty (no sessions in last 2 hours) | For inbound calls, no pre-connect is used |

### Root Cause Analysis

The pattern reveals **three distinct issues**:

#### Issue 1: Greeting Flow Broken for Inbound Calls (HIGH PRIORITY)
For INBOUND calls (user calling the Twilio number), the flow is:
1. Twilio → `twilio-voice-handler` → generates TwiML
2. TwiML points to Cloudflare worker
3. Cloudflare receives WebSocket, gets `start` event
4. Cloudflare calls `handleStart()` → should log `cf_ws_start`
5. Cloudflare calls `connectToOpenAI()` → should log `cf_openai_connect`
6. Cloudflare calls `configureSession()` → should log `cf_session_configured`
7. Cloudflare calls `sendGreeting()` → should log greeting attempt/success

**BUT**: For call `CA41cbaaf7e7a21df7eb5914e87eec98c9`, we only see `cf_disconnect`. This means the entire initialization path is failing **silently** before any logs are written, or logs are being written but the first one (`cf_ws_start` in `handleStart`) is replacing itself.

Looking at the code, `logActivityToSupabase()` lines 168-210:
- First call creates a new record and saves `this.activityLogId`
- Subsequent calls UPDATE the same record (not INSERT new ones)

**This is why we only see one log!** Every stage overwrites the previous one rather than creating new entries. This makes debugging impossible.

#### Issue 2: Fallback Path Still Has Wrong Message Type
At line 950 in `fallbackToOpenAIWithNotification()`:
```typescript
content: [{
  type: 'input_text',  // WRONG - should be 'text' for assistant role
  text: notificationText
}]
```
If ElevenLabs fails and triggers fallback, this will cause the same `input_text` error.

#### Issue 3: ElevenLabs TTS May Be Failing Silently
For ElevenLabs mode:
1. Session configured with `modalities: ['text']`
2. AI generates text response (not audio)
3. `handleTextDelta()` buffers text
4. `sendToElevenLabs()` calls edge function
5. Audio should be sent to Twilio

If `elevenlabs-tts` edge function fails or returns invalid data, the call will be silent. No logs are appearing for `cf_elevenlabs_tts` which should be logged at line 912.

---

### Fixes Required

#### Fix 1: Logging Architecture - Create Separate Entries (CRITICAL)
Change `logActivityToSupabase()` to always INSERT new records for each stage, not UPDATE the same record. This gives us full visibility into every step.

**File:** `cloudflare/src/TwilioCallSession.ts`

Replace the UPDATE/INSERT logic (lines 168-210) with always-INSERT:

```typescript
private async logActivityToSupabase(
  status: 'started' | 'connected' | 'completed' | 'error',
  stage: string,
  metadata: Record<string, any> = {}
) {
  if (!this.callSid) return;

  try {
    const activity = {
      user_id: this.userId || '00000000-0000-0000-0000-000000000001',
      activity_type: this.direction === 'inbound' ? 'phone_inbound' : 'phone_outbound',
      session_id: this.callSid,
      status,
      stage,
      metadata: {
        ...metadata,
        worker_version: WORKER_VERSION,
        tts_provider: this.ttsProvider,
        stream_sid: this.streamSid,
        sequence: Date.now()  // Add sequence for ordering
      },
      started_at: new Date().toISOString()
    };

    // Always INSERT - each stage gets its own record for full visibility
    await fetch(
      `${this.env.SUPABASE_URL}/rest/v1/activity_log`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.env.SUPABASE_SERVICE_KEY}`,
          'apikey': this.env.SUPABASE_SERVICE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(activity)
      }
    );

    console.log(`[CF] Activity logged: ${stage} (${status})`);
  } catch (error) {
    console.error('[CF] Failed to log activity:', error);
  }
}
```

#### Fix 2: Fallback Message Type (MEDIUM)
Fix the assistant content type in `fallbackToOpenAIWithNotification()`:

**File:** `cloudflare/src/TwilioCallSession.ts`, lines 949-954

Change:
```typescript
content: [{
  type: 'input_text',  // WRONG
  text: notificationText
}]
```

To:
```typescript
content: [{
  type: 'text',  // CORRECT for assistant role
  text: notificationText
}]
```

Also fix lines 973-976 (original text re-send):
```typescript
content: [{
  type: 'text',  // CORRECT for assistant role
  text: originalText
}]
```

#### Fix 3: Add ElevenLabs TTS Attempt Logging
Ensure we log TTS attempts:

**File:** `cloudflare/src/TwilioCallSession.ts`, around line 843

Add logging at the START of `sendToElevenLabs()`:
```typescript
private async sendToElevenLabs(text: string) {
  if (!this.twilioWs || !this.streamSid) return;

  const startTime = Date.now();
  console.log(`[CF] ElevenLabs TTS: "${text.substring(0, 50)}..."`);
  
  // Log attempt for debugging
  await this.logAttempt('tts', 'attempted', {
    text_preview: text.substring(0, 50),
    voice_id: this.elevenlabsVoiceId
  });
  
  this.isPlaying = true;
  // ... rest of function
```

And log success/failure at the end:
```typescript
// After successful send (around line 910)
await this.logAttempt('tts', 'success', {
  text_length: text.length,
  audio_bytes: mulawBytes.length,
  latency_ms: latency
});

// In catch block (around line 920)
await this.logAttempt('tts', 'failed', {
  error: String(error),
  text_length: text.length
});
```

#### Fix 4: Update GitHub Actions Version Check
The GitHub Actions workflow expects version `2026-01-28-cf-v3` - update to a new version after fixes:

**File:** `cloudflare/src/TwilioCallSession.ts`, line 76

```typescript
const WORKER_VERSION = '2026-01-29-cf-v1';
```

**File:** `.github/workflows/deploy-cloudflare.yml`, line 51

```yaml
EXPECTED_VERSION="2026-01-29-cf-v1"
```

---

### Technical Details

**Why Activity Logs Were Overwriting:**

The current implementation:
1. First call to `logActivityToSupabase()` creates record, saves ID to `this.activityLogId`
2. All subsequent calls check `if (this.activityLogId)` and PATCH instead of POST
3. Result: only the FINAL stage is visible

**Why No Errors Were Logged:**

The greeting path at line 753 uses the correct `type: 'text'` now. But the OpenAI session may not be ready, or the response may be empty. Without per-stage logging, we can not see what happened.

---

### Files to Modify

| File | Changes |
|------|---------|
| `cloudflare/src/TwilioCallSession.ts` | 1. Change `logActivityToSupabase` to always INSERT, 2. Fix `input_text` in fallback function (lines 950, 974), 3. Add TTS attempt logging, 4. Update version |
| `.github/workflows/deploy-cloudflare.yml` | Update expected version |

---

### Testing Checklist

After deployment:
1. Call Twilio number
2. Check `activity_log` - should see MULTIPLE entries per call:
   - `cf_ws_start`
   - `cf_preconnect_fetch` (if applicable)
   - `cf_openai_connect`
   - `cf_session_configured`
   - `cf_greeting_attempted`
   - `cf_greeting_success` or `cf_greeting_failed`
   - `cf_elevenlabs_tts` or similar
   - `cf_disconnect`
3. If still silent, the logs will now show exactly WHERE it fails

---

### Task Tracking

Create a task to verify this fix:
- **Title:** Verify Cloudflare greeting and logging fixes
- **Description:** After deploying fixes, make a test call and confirm: (1) Multiple activity_log entries per call, (2) Greeting audio plays, (3) Two-way conversation works

