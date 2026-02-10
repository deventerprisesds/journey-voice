

# Add saveCallMessage Persistence to twilio-realtime-bridge

## Changes to `supabase/functions/twilio-realtime-bridge/index.ts`

### 1. User transcript persistence (lines 517-524)

Comment out the manual increment (with rollback note) and add `saveCallMessage`:

```typescript
case "conversation.item.input_audio_transcription.completed":
  const transcript = (msg.transcript || '').trim();
  if (transcript) {
    lastUserTranscript = transcript;
    // messageIndex = messageIndex + 1; // NOTE: commented out - saveCallMessage increments internally. Restore if rolling back persistence.
    console.log(`[USER] "${transcript}"`);
    messageIndex = await saveCallMessage(supabase, {
      callSessionId, userId, threadId, streamSid,
      role: 'user', content: transcript, messageIndex
    });
  }
  break;
```

### 2. AI response persistence (lines 456-466)

Add `saveCallMessage` before clearing `currentResponseText`:

```typescript
case "response.done": {
  isAiSpeaking = false;
  currentResponseItemId = null;
  audioSamplesPlayed = 0;
  sentenceBuffer = '';
  const latencyMs = responseStartTime ? Date.now() - responseStartTime : null;
  console.log(`[RESPONSE-DONE] #${responseCreateCount} trigger=${currentResponseTrigger} latency=${latencyMs}ms text="${currentResponseText.substring(0, 200)}"`);
  // PERSIST AI response to call_messages + conversation_messages
  if (currentResponseText.trim()) {
    messageIndex = await saveCallMessage(supabase, {
      callSessionId, userId, threadId, streamSid,
      role: 'assistant', content: currentResponseText.trim(),
      messageIndex, latencyMs: latencyMs ?? undefined
    });
  }
  currentResponseText = '';
  currentResponseTrigger = '';
  break;
}
```

### 3. Tool call persistence (lines 550-556)

Add `saveCallMessage` after tool execution, before sending result to OpenAI:

```typescript
const result = await executeTool(...);
fillerManager?.endTool();

if (result.extractedFacts) lastToolOutput = { ... };

// PERSIST tool call to call_messages
messageIndex = await saveCallMessage(supabase, {
  callSessionId, userId, threadId, streamSid,
  role: 'tool', content: JSON.stringify(result).substring(0, 1000),
  messageIndex, toolInfo: { name: msg.name, input: args, output: result }
});

openaiWs.send(...);
createResponse('FUNCTION_RESULT');
```

### 4. Deploy both edge functions

- `twilio-realtime-bridge` (with new persistence)
- `twilio-scheduled-call` (redeploy to activate window transition branching)

