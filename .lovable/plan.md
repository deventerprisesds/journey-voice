
# Explicit Error Notification on ElevenLabs Fallback

## Problem

The current fallback mechanism silently switches from ElevenLabs to OpenAI TTS when ElevenLabs times out. This causes confusion because:
1. You hear a different voice with no explanation
2. You don't know what went wrong
3. Debugging later is harder because the "fix" masked the real issue

## Solution

Replace the silent fallback with an explicit spoken error message that tells you what happened, then continues with OpenAI voice.

## Changes to `supabase/functions/twilio-realtime-bridge/index.ts`

**Current behavior (lines 1401-1427):**
```typescript
if (fetchError.name === 'AbortError') {
  console.warn(`[ELEVENLABS] ⚠️ Request timed out, falling back to OpenAI voice`);
  // Silently falls back to OpenAI and speaks the original text
  openaiWs.send(JSON.stringify({
    type: "response.create",
    response: { 
      modalities: ["audio"],
      instructions: `Speak the following text naturally: "${fullText}"`
    }
  }));
}
```

**New behavior:**
```typescript
if (fetchError.name === 'AbortError') {
  console.warn(`[ELEVENLABS] ⚠️ Request timed out after ${ELEVENLABS_TIMEOUT_MS}ms`);
  isProcessingElevenLabsTTS = false;
  
  if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
    // EXPLICIT ERROR NOTIFICATION - Tell the user what happened
    const errorNotification = `I apologize, but there was an error with my voice system. ` +
      `ElevenLabs took too long to respond, so I'm switching to a backup voice. ` +
      `Here's what I was trying to say: ${fullText}`;
    
    console.log(`[ELEVENLABS-ERROR] Notifying user of TTS failure`);
    
    openaiWs.send(JSON.stringify({
      type: "response.create",
      response: { 
        modalities: ["audio"],
        instructions: errorNotification
      }
    }));
  }
  return;
}
```

## Also Handle Non-Timeout Errors

The same explicit notification should apply when ElevenLabs returns a non-200 response (lines 1435-1439):

**Current behavior:**
```typescript
if (!response.ok) {
  const errorText = await response.text();
  console.error(`[ELEVENLABS] TTS API error: ${response.status} - ${errorText}`);
  isProcessingElevenLabsTTS = false;
  return;  // Silent failure - user hears nothing
}
```

**New behavior:**
```typescript
if (!response.ok) {
  const errorText = await response.text();
  console.error(`[ELEVENLABS] TTS API error: ${response.status} - ${errorText}`);
  isProcessingElevenLabsTTS = false;
  
  // EXPLICIT ERROR NOTIFICATION
  if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
    const errorNotification = `I apologize, but my voice system encountered an error. ` +
      `ElevenLabs returned status ${response.status}. ` +
      `Switching to backup voice. Here's what I was saying: ${fullText}`;
    
    console.log(`[ELEVENLABS-ERROR] Notifying user of API error: ${response.status}`);
    
    openaiWs.send(JSON.stringify({
      type: "response.create",
      response: { 
        modalities: ["audio"],
        instructions: errorNotification
      }
    }));
  }
  return;
}
```

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/twilio-realtime-bridge/index.ts` | Update timeout fallback (lines ~1401-1428) and API error handler (lines ~1435-1439) to explicitly announce the error before falling back |

## Expected Outcome

When ElevenLabs fails, you will hear:
> "I apologize, but there was an error with my voice system. ElevenLabs took too long to respond, so I'm switching to a backup voice. Here's what I was trying to say: [original message]"

This ensures:
1. You know something went wrong
2. You know which system failed (ElevenLabs)
3. You know the specific error (timeout vs API error)
4. You still get the response content
5. Debugging is easier because the error is surfaced, not hidden
