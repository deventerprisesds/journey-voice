

## Fix Cloudflare Twilio Bridge: Enable ElevenLabs Greeting Audio

### Problem Summary
Phone calls are silent because `sendGreeting()` injects text into OpenAI's conversation history but **never calls ElevenLabs to synthesize the greeting audio**. The greeting text is recorded in OpenAI's memory, but no audio is ever sent to Twilio.

### Root Cause Analysis
**Current flow (broken):**
1. `sendGreeting()` checks for cached audio → none found
2. Injects greeting text into OpenAI as assistant message (line 720-727)
3. Injects "wait for user" system message (line 730-740)
4. Calls `response.create` with `modalities: ['text']` (line 744-747)
5. OpenAI sees the greeting already in history, so generates no new text
6. No text deltas → `handleTextDelta()` never called → **no ElevenLabs synthesis**
7. Result: **Silence**

**Correct flow (fix):**
1. Check for cached audio → none found
2. Call `sendToElevenLabs(greeting)` directly → synthesizes and streams audio to Twilio
3. Inject greeting into OpenAI conversation history (so AI knows what was said)
4. Wait for user to speak
5. Result: **Audible greeting**

---

### Changes to `cloudflare/src/TwilioCallSession.ts`

#### Change 1: Fix Greeting Playback for ElevenLabs Mode
**Lines 714-762** - Update `sendGreeting()` fallback logic:

```typescript
// Fallback: Use ElevenLabs or OpenAI to generate greeting
const greeting = this.greetingText || 'Hi! This is Iris. How can I help you today?';

try {
  if (this.ttsProvider === 'elevenlabs') {
    // ElevenLabs mode: Synthesize and stream greeting directly
    console.log('[CF] Synthesizing greeting via ElevenLabs');
    await this.sendToElevenLabs(greeting);
    
    // Also inject into OpenAI's conversation history so it "knows" what was said
    this.openaiWs?.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: greeting }]
      }
    }));
    
    await this.logAttempt('greeting', 'success', {
      source: 'elevenlabs_direct',
      greeting_text: greeting.substring(0, 50),
      latency_ms: Date.now() - greetingStartTime
    });
  } else {
    // OpenAI TTS mode: Use response.create to generate audio
    this.openaiWs?.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: greeting }]
      }
    }));
    
    this.openaiWs?.send(JSON.stringify({
      type: 'response.create',
      response: { modalities: ['text', 'audio'] }
    }));
    
    await this.logAttempt('greeting', 'success', {
      source: 'openai_tts',
      greeting_text: greeting.substring(0, 50),
      latency_ms: Date.now() - greetingStartTime
    });
  }
} catch (error) {
  // ... error handling
}
```

**Key changes:**
- When `ttsProvider === 'elevenlabs'`: Call `sendToElevenLabs(greeting)` directly
- Remove the confusing "wait for user to respond" system message injection
- Keep OpenAI conversation history update (so AI remembers the greeting)
- Update log source to `elevenlabs_direct` for clarity

#### Change 2: Fix Tool Definitions Parser
**Line 464** - Update `fetchToolDefinitions()`:

```typescript
// Current (broken):
this.toolDefinitions = (data.definitions || []).map(...)

// Fixed - endpoint returns { tools, count }:
this.toolDefinitions = (data.tools || []).map((def: any) => ({
  type: 'function',
  name: def.name,
  description: def.description,
  parameters: def.parameters
}));
```

#### Change 3: Update Version
- `TwilioCallSession.ts` line ~45: `'2026-01-29-cf-v2'`
- `index.ts` line 21: `version: '2026-01-29-cf-v2'`

---

### What This Does NOT Change
- **Auto-response behavior**: OpenAI will NOT auto-respond when user speaks (you were right - that's not what we want)
- After the greeting plays, the system listens for user speech, then OpenAI generates a response, which triggers ElevenLabs synthesis via the existing `handleTextDelta()` → `sendToElevenLabs()` flow

---

### Expected Results After Deployment
| Before | After |
|--------|-------|
| Silent greeting | Audible ElevenLabs greeting within 1-2s |
| `cf_greeting_success` with `source: openai_generated` | `cf_greeting_success` with `source: elevenlabs_direct` |
| `tools_count: 0` | `tools_count: 10+` |
| `cf_tts_success` only for responses | `cf_tts_success` for greeting AND responses |

---

### Testing Checklist
After GitHub Actions deployment completes:
1. Call Twilio number
2. Hear greeting immediately ("Hi! This is Iris...")
3. Say "Hello" → hear ElevenLabs response
4. Check `activity_log` for `cf_greeting_success` with `source: elevenlabs_direct`
5. Confirm `cf_session_configured` shows `tools_count > 0`

