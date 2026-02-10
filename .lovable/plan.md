
# Fix: Phone Call System — Complete Forensic Trace and Fixes

## Forensic Evidence (Not Guesses)

### Issue 1: Outbound morning call hangs up after 1 second

**Trace:**
```text
1. twilio-scheduled-call sends action: 'trigger-call' (NOT 'trigger-call-with-session')
2. trigger-call uses triggerOutboundCall() which creates the Twilio call with a Url callback:
   Url = twilio-voice-handler?action=incoming-call&direction=outbound&context=...&userId=...
3. When Twilio answers, it hits that URL to get TwiML
4. incoming-call runs getUserContext() which does the ilike phone lookup
5. getUserContext matches BOTH profiles (real user +14434150606 AND demo 4434150606)
6. .maybeSingle() returns an ERROR (multiple rows) -> falls through to demo user fallback
7. Demo user has phone_call_mode = 'cloudflare' (from user_scheduling_prefs)
8. TwiML generated points to Cloudflare bridge
9. Supabase bridge never starts -> call_sessions metadata = {} (empty)
10. The call was answered and immediately routed to Cloudflare, which has no pre-connected
    session (has_session: false) -> 1 second of silence -> user hangs up
```

**The 1-second hangup is NOT a Supabase edge function timeout. It's the user hanging up** because they heard nothing. The call_sessions record shows `duration_seconds: null` because the Supabase bridge was never started — the call went to Cloudflare.

### Issue 2: Inbound callback routes to demo user, no responses after greeting

**Trace:**
```text
1. You called back from +14434150606
2. getUserContext() runs: .ilike('phone', '%4434150606%')
3. Matches BOTH:
   - Real user: +14434150606 (user_id: a3378f93-d655-4913-b2fa-ca5b1d8020f1)
   - Demo user: 4434150606 (user_id: 00000000-0000-0000-0000-000000000001)
4. .maybeSingle() errors on multiple matches -> falls to demo user fallback
5. Demo user phone_call_mode = likely 'cloudflare'
6. Call routed to Cloudflare bridge (worker_version: 2026-01-29-cf-v7f)
7. Cloudflare bridge: has_session=false, loaded demo user context
8. Greeting played: "Good morning, Sir. This is Iris." (via ElevenLabs, 503ms)
9. User speech detected 4 times (cf_user_speech_started)
10. OpenAI received audio (801 appends) but generated 0 responses
11. Call summary: twilio_frames_out=24 (greeting only), greeting_triggered=false
```

**Why zero responses:** The Cloudflare bridge has the same semantic VAD issue in text-only mode. OpenAI's VAD with `modalities: ["text"]` and `create_response: true` is unreliable — it receives audio but never triggers a response after the injected greeting. The bridge has no fallback timer to force a response.

### Issue 3: Recurring calls use `trigger-call` instead of `trigger-call-with-session`

**Root cause:** `twilio-scheduled-call/index.ts` line 568 sends `action: 'trigger-call'`, which does NOT pre-connect. This means:
- No cached audio greeting
- No pre-loaded session context
- A second webhook round-trip (Twilio calls back to get TwiML)
- That second webhook hits the broken `getUserContext()` phone lookup

---

## Root Causes Summary

| # | Root Cause | Impact | Evidence |
|---|-----------|--------|----------|
| 1 | `getUserContext()` ilike matches both real + demo user; `.maybeSingle()` silently errors | ALL calls route to demo user context | `user_id: 00000000-...0001` in activity_log |
| 2 | Demo user's `phone_call_mode` routes to Cloudflare bridge | Wrong bridge used entirely | `worker_version: 2026-01-29-cf-v7f` in metadata |
| 3 | Cloudflare bridge has no VAD fallback timer | Zero responses after greeting | `twilio_frames_out: 24`, `greeting_triggered: false` |
| 4 | `twilio-scheduled-call` uses `trigger-call` not `trigger-call-with-session` | No pre-connected session, extra webhook round-trip | `has_session: false` in cf_ws_start |
| 5 | No tracing at the `twilio-voice-handler` level for which user was resolved | Can't see routing decisions in logs | `metadata: {}` in call_sessions |

---

## Fixes

### Fix 1: Phone Lookup — Exclude Demo User (Critical)

**File:** `supabase/functions/twilio-voice-handler/index.ts`, `getUserContext()` (lines 113-174)

Replace the single query with a two-step lookup that excludes the demo user:

```typescript
// Step 1: Exact match, excluding demo user
const { data: exactMatch } = await supabase
  .from('profiles')
  .select('user_id, phone')
  .or(`phone.eq.${phoneNumber},phone.eq.+${normalizedPhone}`)
  .neq('user_id', '00000000-0000-0000-0000-000000000001')
  .maybeSingle();

let userId = exactMatch?.user_id || null;

// Step 2: Fuzzy match only if exact fails, still excluding demo
if (!userId) {
  const { data: fuzzyMatch } = await supabase
    .from('profiles')
    .select('user_id, phone')
    .ilike('phone', `%${normalizedPhone.slice(-10)}%`)
    .neq('user_id', '00000000-0000-0000-0000-000000000001')
    .maybeSingle();
  userId = fuzzyMatch?.user_id || null;
}
```

### Fix 2: Add OpenAI Voice Fallback in Supabase Bridge

**File:** `supabase/functions/twilio-realtime-bridge/index.ts`, `sendElevenLabsTTS()` (lines 271-291)

When ElevenLabs fails (quota, API error), fall back to OpenAI native voice:

```typescript
} else {
  const errorText = await response.text();
  console.error(`[ELEVENLABS] TTS API error: ${response.status} - ${errorText}`);
  
  // Fall back to OpenAI voice
  if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
    console.warn(`[ELEVENLABS-FALLBACK] Using OpenAI voice for: "${fullText.substring(0, 60)}..."`);
    openaiWs.send(JSON.stringify({
      type: "response.create",
      response: {
        modalities: ["audio"],
        instructions: `Speak this exactly: "${fullText}"`
      }
    }));
  }
  
  // Log quota errors for banner
  if (errorText.includes('quota_exceeded') || response.status === 401) {
    // ... existing quota logging ...
  }
}
```

### Fix 3: Add VAD Fallback Timer in Supabase Bridge

**File:** `supabase/functions/twilio-realtime-bridge/index.ts`, after `triggerPendingGreeting()` (line 233)

After greeting plays, if no response is triggered within 8 seconds, force one:

```typescript
// After greeting injection in triggerPendingGreeting():
setTimeout(() => {
  if (responseCreateCount === 0 && openaiWs?.readyState === WebSocket.OPEN) {
    console.warn('[VAD-FALLBACK] No response after 8s, forcing response');
    createResponse('VAD_FALLBACK');
  }
}, 8000);
```

Also add periodic `input_audio_buffer.commit` to nudge VAD in the media handler.

### Fix 4: Add Routing Trace Logging

**File:** `supabase/functions/twilio-voice-handler/index.ts`, in `incoming-call` handler (line 1316)

Log the routing decision so we can always trace which user and bridge was selected:

```typescript
console.log(`[ROUTING-TRACE] Phone: ${callerPhone}, Resolved userId: ${userId}, ` +
  `phoneCallMode: ${phoneCallMode}, selectedMode: ${selectedMode}, ` +
  `isDemoUser: ${userId === '00000000-0000-0000-0000-000000000001'}`);
```

### Fix 5: Update Debug Tracker

**File:** `docs/DEBUG_TRACKER.md`

Add three new entries:

```
| VOICE-03 | Phone lookup matches demo user, routes to wrong bridge | FIXING |
    .ilike('%4434150606%') matches both real (+14434150606) and demo (4434150606).
    .maybeSingle() errors silently, falls to demo user with Cloudflare bridge. |
| VOICE-04 | Outbound scheduled calls use trigger-call not trigger-call-with-session | KNOWN |
    twilio-scheduled-call sends action: 'trigger-call' which causes a second webhook
    round-trip through the broken getUserContext() lookup. |
| VOICE-05 | Semantic VAD unreliable in text-only modality | FIXING |
    OpenAI's semantic VAD with modalities: ["text"] and create_response: true
    does not reliably trigger responses after greeting injection. Need fallback timer. |
```

New lessons learned:
```
- .maybeSingle() returns NULL (not error) when multiple rows match — it silently
  discards ALL results. Always exclude known duplicate records (demo user) from queries.
- Every routing decision must be logged with the resolved userId, bridge mode, and
  whether the demo user was used. Without this, debugging is impossible.
- Semantic VAD + text-only modalities is fundamentally unreliable. Always implement
  a fallback timer that forces response.create if responseCreateCount === 0 after
  a configurable timeout.
```

---

## Files to Modify

| File | Change | Priority |
|------|--------|----------|
| `supabase/functions/twilio-voice-handler/index.ts` | Fix getUserContext() phone lookup; add routing trace logs | Critical |
| `supabase/functions/twilio-realtime-bridge/index.ts` | Add ElevenLabs fallback to OpenAI voice; add VAD fallback timer | Critical |
| `docs/DEBUG_TRACKER.md` | Document VOICE-03/04/05 with full evidence | Required |

---

## Testing Plan

1. Deploy both edge functions
2. Trigger a test outbound call — verify logs show real user ID (not demo), bridge mode = media_streams
3. Call back inbound — verify `[ROUTING-TRACE]` shows real user, not demo
4. If ElevenLabs quota still exhausted, verify `[ELEVENLABS-FALLBACK]` fires and OpenAI voice speaks
5. Verify `response_create_count > 0` in call_sessions metadata
6. Check `activity_log` for correct `user_id` on all entries
