

# Fix: Phone Routing + ElevenLabs Error Announcement + Better Logging

## Scope (Reduced)

Only fixing the two **proven** issues. The VAD issue remains under investigation — we won't add a speculative timer until we understand it better.

| Fix | Issue | Confidence |
|-----|-------|------------|
| 1 | Phone lookup matches demo user, routes to wrong bridge | Proven — forensic evidence in logs |
| 2 | ElevenLabs failures are silent — no audio at all | Proven — zero audio_frames_out on quota days |
| 3 | Better routing/bridge logging | Required — can't debug what we can't see |

---

## Fix 1: Phone Lookup — Exclude Demo User

**File:** `supabase/functions/twilio-voice-handler/index.ts` (lines 113-174)

The current query on line 120-124 uses a single `.or()` with `.maybeSingle()` that matches both the real user and demo user. Replace with two-step lookup:

```typescript
async function getUserContext(phoneNumber: string): Promise<...> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const normalizedPhone = phoneNumber.replace(/\D/g, '');
  const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';
  
  console.log(`[getUserContext] Looking up phone: ${phoneNumber} (normalized: ${normalizedPhone})`);

  // Step 1: Exact match, excluding demo user
  const { data: exactMatch, error: exactError } = await supabase
    .from('profiles')
    .select('user_id, phone')
    .or(`phone.eq.${phoneNumber},phone.eq.+${normalizedPhone}`)
    .neq('user_id', DEMO_USER_ID)
    .maybeSingle();

  let userId = exactMatch?.user_id || null;
  console.log(`[getUserContext] Exact match: ${userId || 'none'}${exactError ? ` (error: ${exactError.message})` : ''}`);

  // Step 2: Fuzzy match only if exact fails, still excluding demo
  if (!userId) {
    const last10 = normalizedPhone.slice(-10);
    const { data: fuzzyMatch, error: fuzzyError } = await supabase
      .from('profiles')
      .select('user_id, phone')
      .ilike('phone', `%${last10}%`)
      .neq('user_id', DEMO_USER_ID)
      .maybeSingle();
    
    userId = fuzzyMatch?.user_id || null;
    console.log(`[getUserContext] Fuzzy match (%${last10}%): ${userId || 'none'}${fuzzyError ? ` (error: ${fuzzyError.message})` : ''}`);
  }

  // Step 3: Only fall back to demo if NO real user found
  if (!userId) {
    console.warn(`[getUserContext] No real user found, falling back to demo user`);
    // ... existing demo fallback logic (lines 129-152) ...
  }

  // ... rest unchanged ...
}
```

Also add a `[ROUTING-TRACE]` log after line 1316 in the incoming-call handler:

```typescript
console.log(`[ROUTING-TRACE] Phone: ${callerPhone}, Resolved userId: ${userId}, ` +
  `phoneCallMode: ${phoneCallMode}, selectedMode: ${selectedMode}, ` +
  `isDemoUser: ${userId === '00000000-0000-0000-0000-000000000001'}`);
```

---

## Fix 2: ElevenLabs Failure — Announce the Error Over the Phone

**File:** `supabase/functions/twilio-realtime-bridge/index.ts` (lines 271-291)

After the existing error logging block, add an OpenAI audio response that **tells the user what failed** instead of staying silent:

```typescript
// After line 290 (existing quota logging), before the closing brace:

// ANNOUNCE the error to the user — never be silent
if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
  let errorDescription: string;
  if (errorText.includes('quota_exceeded')) {
    errorDescription = 'ElevenLabs voice quota is exhausted. Voice features are unavailable until credits are added.';
  } else if (response.status === 401) {
    errorDescription = 'ElevenLabs authentication failed. The API key may be invalid or expired.';
  } else {
    errorDescription = `ElevenLabs voice service returned error ${response.status}. Voice output is temporarily unavailable.`;
  }
  
  console.warn(`[ELEVENLABS-ERROR-ANNOUNCE] Speaking error to user: ${errorDescription}`);
  openaiWs.send(JSON.stringify({
    type: "response.create",
    response: {
      modalities: ["audio"],
      instructions: `Tell the user exactly this: "${errorDescription}"`
    }
  }));
}
```

Also add the same pattern in the `catch` block (line 292-293) for unexpected errors:

```typescript
} catch (error) {
  console.error('[ELEVENLABS] TTS error:', error);
  // Announce unexpected errors too
  if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
    openaiWs.send(JSON.stringify({
      type: "response.create",
      response: {
        modalities: ["audio"],
        instructions: `Tell the user: "I encountered a voice system error: ${error.message || 'unknown error'}. Voice output may be affected."`
      }
    }));
  }
}
```

---

## Fix 3: Enhanced Bridge Logging for VAD Investigation

**File:** `supabase/functions/twilio-realtime-bridge/index.ts`

Add targeted logging to help us understand the VAD issue on future calls without guessing:

- Log when `input_audio_buffer.speech_started` and `speech_stopped` events arrive from OpenAI
- Log when `response.create` is triggered (and by what — VAD auto, manual, filler, etc.)
- Log `responseCreateCount` at 5s intervals after greeting so we can see the timeline
- Log the OpenAI session config that was sent (specifically `turn_detection` and `modalities`) to confirm what mode we're actually in

These are log-only changes — no behavior changes for VAD until we have the data.

---

## Fix 4: Update Debug Tracker

**File:** `docs/DEBUG_TRACKER.md`

Add entries:

```
| VOICE-03 | Phone lookup matches demo user, routes to wrong bridge | FIXING |
| VOICE-04 | ElevenLabs failures produce zero audio output | FIXING |
| VOICE-05 | Semantic VAD not triggering responses in text-only mode | INVESTIGATING |
```

Lessons learned:
- `.maybeSingle()` returns null when multiple rows match. Always exclude demo user from phone lookups.
- Every routing decision must be logged with userId, bridge mode, and demo user flag.
- Fallbacks must announce failures audibly — never be silent.

---

## Files to Modify

| File | Change | Priority |
|------|--------|----------|
| `supabase/functions/twilio-voice-handler/index.ts` | Two-step phone lookup excluding demo user; routing trace log | Critical |
| `supabase/functions/twilio-realtime-bridge/index.ts` | ElevenLabs error announcement; enhanced VAD investigation logging | Critical |
| `docs/DEBUG_TRACKER.md` | Document VOICE-03/04/05 | Required |

---

## Testing Plan

1. Deploy both edge functions
2. Trigger an inbound call — verify `[ROUTING-TRACE]` shows real user ID, not demo
3. If ElevenLabs quota is exhausted, verify you HEAR the error message on the call
4. Review bridge logs for new VAD tracing data to inform the next fix
