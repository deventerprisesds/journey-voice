

## Fix: Cached Audio Path Missing OpenAI Context Injection

### Root Cause Identified

When a phone call uses **pre-cached audio** for the greeting (for lowest latency), the Cloudflare worker plays the audio to Twilio but **never injects the conversation context into OpenAI**. This causes:

1. OpenAI has no record of the greeting being spoken
2. OpenAI has no system context about the call state
3. Semantic VAD cannot properly detect turn boundaries
4. `input_audio_buffer.speech_stopped` never fires
5. No transcription → No AI response → AI "fabricates" or stays silent

### Evidence from Debug Logs

| Metric | Value | Problem |
|--------|-------|---------|
| `cf_user_speech_started` | 7 events | User spoke 7 times |
| `cf_user_speech_stopped` | 0 events | Speech never "ended" |
| `cf_transcription` | 0 events | No text was generated |
| `cf_response_started` | 0 events | No AI response |
| `twilio_frames_out` | 0 | No audio sent back to user |

### The Bug (Line 1077)

In `cloudflare/src/TwilioCallSession.ts`, the cached audio path returns early:

```typescript
// Line 1033-1077: Cached audio path
if (this.cachedAudioBase64 && this.twilioWs && this.streamSid) {
  // ... send audio to Twilio ...
  this.isPlaying = false;
  return;  // <-- BUG: Returns before context injection!
}

// Line 1100-1126: Context injection (NEVER REACHED for cached audio)
this.openaiWs?.send(JSON.stringify({
  type: 'conversation.item.create',
  item: { role: 'assistant', content: [...] }
}));
```

### Fix Required

After playing cached audio, inject the same conversation context that the non-cached path does:

1. Inject an `assistant` message with the greeting text
2. Inject a `system` message explaining the conversation state

---

### Technical Changes

**File: `cloudflare/src/TwilioCallSession.ts`**

Update the cached audio path (around lines 1070-1077) to inject context before returning:

```typescript
// After playing cached audio, inject context into OpenAI
const greeting = this.greetingText || 'Hello';

// Inject assistant message with what was just spoken
this.openaiWs?.send(JSON.stringify({
  type: 'conversation.item.create',
  item: {
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: greeting }]
  }
}));

// Inject system context for OpenAI to understand the state
const now = new Date().toLocaleString('en-US', { timeZone: this.timezone });
const contextMsg = `[System: You just spoke the greeting: "${greeting}"
The user is now listening and may respond. Current time: ${now}.
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

console.log('[CF] Injected post-greeting context for cached audio path');
this.isPlaying = false;
return;
```

---

### Why This Fixes the Problem

| Before | After |
|--------|-------|
| OpenAI has empty conversation | OpenAI knows greeting was spoken |
| Semantic VAD confused by context-less audio | VAD has proper turn-taking context |
| No `speech_stopped` → No transcription | Normal turn detection → Transcription works |
| AI stays silent or fabricates | AI responds normally with tool calls |

---

### Files Changed

| File | Change |
|------|--------|
| `cloudflare/src/TwilioCallSession.ts` | Add OpenAI context injection to cached audio greeting path (before the `return` on line 1077) |

---

### Deployment

After fixing, redeploy the Cloudflare worker:
```bash
cd cloudflare && npm run deploy
```

