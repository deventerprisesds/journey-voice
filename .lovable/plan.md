

# Add Response Transcript Logging for Double-Goodbye Debugging

## What

Add logging to capture every OpenAI assistant response with its full text content and trigger source. Currently the bridge logs nothing about what the AI actually says — we only see user transcripts. This makes it impossible to diagnose double responses.

## Changes

**File:** `supabase/functions/twilio-realtime-bridge/index.ts`

### 1. Add response transcript accumulator (after line 190)

```typescript
let currentResponseText = '';
let currentResponseTrigger = '';
```

### 2. Capture trigger source in `createResponse()` (line 197-203)

Store the trigger so we can log it when the response completes:

```typescript
function createResponse(trigger: string) {
  if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;
  responseCreateCount++;
  responseStartTime = Date.now();
  currentResponseText = '';
  currentResponseTrigger = trigger;
  console.log(`[RESPONSE] #${responseCreateCount} triggered by: ${trigger}`);
  openaiWs.send(JSON.stringify({ type: "response.create" }));
}
```

### 3. Accumulate text from audio transcript deltas (new case, after line 478)

Add a handler for `response.audio_transcript.delta` to capture what the AI is saying via audio:

```typescript
case "response.audio_transcript.delta":
  if (msg.delta) currentResponseText += msg.delta;
  break;
```

### 4. Also accumulate from `response.text.delta` (modify line 458-466)

Add accumulation to the existing text delta handler:

```typescript
case "response.text.delta":
  if (msg.delta) currentResponseText += msg.delta;
  // existing ElevenLabs TTS logic unchanged...
  break;
```

### 5. Log complete response on `response.done` (modify lines 451-456)

```typescript
case "response.audio.done":
  break;
case "response.done":
  isAiSpeaking = false;
  currentResponseItemId = null;
  audioSamplesPlayed = 0;
  sentenceBuffer = '';
  const latencyMs = responseStartTime ? Date.now() - responseStartTime : null;
  console.log(`[RESPONSE-DONE] #${responseCreateCount} trigger=${currentResponseTrigger} latency=${latencyMs}ms text="${currentResponseText.substring(0, 200)}"`);
  currentResponseText = '';
  currentResponseTrigger = '';
  break;
```

This separates `response.audio.done` (which fires mid-response) from `response.done` (which fires at the end), and logs the full text of each response.

## What This Gives Us

On the next call where the AI repeats itself, we'll see logs like:

```
[RESPONSE-DONE] #1 trigger=SESSION_GREETING latency=1200ms text="Good morning, Von! How are you today?"
[RESPONSE-DONE] #2 trigger=??? latency=800ms text="Good morning! Is there anything I can help you with?"
```

This will tell us exactly what triggered the duplicate and what it said, making the root cause obvious.

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/twilio-realtime-bridge/index.ts` | Add response text accumulation and logging on `response.done` |

