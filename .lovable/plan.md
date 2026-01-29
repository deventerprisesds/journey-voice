

# Fix Phone Call Silence: OpenAI Session State After ElevenLabs Greeting

## Root Cause Analysis

The Cloudflare bridge sends the ElevenLabs greeting directly (bypassing OpenAI) but doesn't properly prepare OpenAI's session to receive and respond to user audio afterward.

**Critical Gaps Identified:**

| Behavior | Supabase Bridge | Cloudflare Bridge |
|----------|-----------------|-------------------|
| Greeting injection to OpenAI | conversation.item.create | conversation.item.create |
| System context injection | injectSystemMessage explaining state | MISSING |
| Post-greeting guidance | "You just said X, wait for response" | MISSING |
| Echo suppression clearing | setTimeout clears flags | setTimeout clears flags |
| Audio buffer commitment | Explicit commit in some flows | MISSING |

## The Fix: Three-Part Post-Greeting Setup

### Fix 1: Inject System Context After ElevenLabs Greeting

After sending the ElevenLabs greeting, tell OpenAI what happened and what to expect:

```typescript
// In sendGreeting(), after ElevenLabs TTS completes:

// 1. Inject the assistant message (already exists)
this.openaiWs?.send(JSON.stringify({
  type: 'conversation.item.create',
  item: {
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: greeting }]
  }
}));

// 2. NEW: Inject system context explaining the state
const contextMsg = `[System: You just spoke the greeting: "${greeting}"
The user is now listening and may respond. Current time: ${new Date().toLocaleString('en-US', { timeZone: this.timezone })}.
Wait for the user's response, then continue the conversation naturally.
${this.ragContext ? `Context: ${this.ragContext}` : ''}]`;

this.openaiWs?.send(JSON.stringify({
  type: 'conversation.item.create',
  item: {
    type: 'message',
    role: 'system',
    content: [{ type: 'input_text', text: contextMsg }]
  }
}));
```

### Fix 2: Explicit Buffer Commit on speech_stopped

When user speech stops, explicitly commit the audio buffer to ensure transcription triggers:

```typescript
case 'input_audio_buffer.speech_stopped':
  console.log('[CF] User stopped speaking');
  
  // Explicitly commit the buffer to trigger transcription
  this.openaiWs?.send(JSON.stringify({
    type: 'input_audio_buffer.commit'
  }));
  
  await this.logActivityToSupabase('connected', 'cf_user_speech_stopped', {
    buffer_committed: true
  });
  break;
```

### Fix 3: Add Diagnostic Events for Debugging Visibility

Track the full transcription pipeline to identify exactly where silence occurs:

```typescript
case 'input_audio_buffer.committed':
  console.log('[CF] Audio buffer committed - transcription should follow');
  await this.logActivityToSupabase('connected', 'cf_buffer_committed', {});
  break;
```

## Files to Modify

| File | Changes |
|------|---------|
| `cloudflare/src/TwilioCallSession.ts` | Add system context injection after ElevenLabs greeting, add buffer commit on speech_stopped, add committed event logging |
| `cloudflare/src/index.ts` | Version bump to v7f |
| `.github/workflows/deploy-cloudflare.yml` | Update expected version |

## Technical Details

### Why This Should Work

1. **System context** tells OpenAI what state the conversation is in (greeting already spoken, waiting for user)
2. **Buffer commit** ensures OpenAI's transcription pipeline is triggered even if semantic_vad doesn't auto-trigger
3. **Diagnostic events** will confirm exactly where the pipeline is failing

### Expected Event Flow After Fix

```text
cf_greeting_attempted → cf_greeting_success → cf_user_speech_started → 
cf_user_speech_stopped → cf_buffer_committed → cf_transcription → 
cf_response_started → cf_text_delta_first → (ElevenLabs TTS) → User hears AI
```

### Version Bump

```typescript
// cloudflare/src/index.ts
const WORKER_VERSION = '2026-01-29-cf-v7f';

// cloudflare/src/TwilioCallSession.ts  
const WORKER_VERSION = '2026-01-29-cf-v7f';
```

## Testing Plan

1. Deploy v7f
2. Make a phone call
3. Speak after greeting
4. Check activity_log for new events:
   - `cf_buffer_committed` (confirms audio was committed)
   - `cf_transcription` (confirms OpenAI transcribed user speech)
   - `cf_response_started` (confirms OpenAI is responding)

If `cf_buffer_committed` appears but `cf_transcription` doesn't, the issue is deeper in OpenAI's text-only mode handling and may require switching modalities after greeting.

