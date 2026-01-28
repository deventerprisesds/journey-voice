
# Fix WebRTC Voice Issues: VAD, Greeting, and Live Transcription

## Problem Summary

Three interconnected issues with the in-app WebRTC voice assistant:

1. **VAD Too Sensitive**: Uses `server_vad` with threshold `0.3` which picks up background noise as speech
2. **No Immediate Greeting**: Unlike Twilio which says "Hello" right away, WebRTC waits silently
3. **Live Transcript Not Streaming**: Only shows "Listening..." but not the assistant's words as they stream

## Root Cause Analysis

The WebRTC path (`generate-realtime-token`) and Twilio path (`twilio-realtime-bridge`) use completely different session configurations:

| Setting | WebRTC (Current) | Twilio Bridge | Fix |
|---------|------------------|---------------|-----|
| VAD Type | `server_vad` | `semantic_vad` | Use semantic_vad |
| Threshold | `0.3` (too low) | N/A (AI-based) | Remove |
| Eagerness | Not set | `low` | Add `eagerness: "low"` |
| Greeting | None | Immediate injection | Add greeting trigger |
| Transcription | `whisper-1` | `gpt-4o-mini-transcribe` | Align models |

## Implementation Plan

### Part 1: Align VAD Settings with Twilio Bridge

**File:** `supabase/functions/generate-realtime-token/index.ts`

Change the `turn_detection` configuration (lines 135-140) from:
```typescript
turn_detection: {
  type: "server_vad",
  threshold: 0.3,
  prefix_padding_ms: 400,
  silence_duration_ms: 1200
}
```

To match Twilio bridge:
```typescript
turn_detection: {
  type: "semantic_vad",      // AI-based detection instead of amplitude
  eagerness: "low",          // Let user take their time
  create_response: true,     // Auto-respond when AI thinks user is done
  interrupt_response: true,  // Still allow barge-in
}
```

Also update transcription model (line 132-134) from `whisper-1` to `gpt-4o-mini-transcribe`:
```typescript
input_audio_transcription: {
  model: "gpt-4o-mini-transcribe",
  language: "en",
  prompt: "tasks, schedule, calendar, reschedule, today, tomorrow, priorities"
}
```

### Part 2: Add Immediate Greeting After Connection

**File:** `src/utils/RealtimeVoiceAssistant.ts`

After session is configured (in the `session.updated` event handler), trigger an immediate greeting like Twilio does.

Add handling for `session.updated` event (around line 646 in handleMessage):
```typescript
case 'session.updated':
  console.log('✅ Session configured, triggering greeting');
  this.sendGreeting();
  break;
```

Add a new `sendGreeting()` method that:
1. Loads user profile (name, timezone)
2. Injects a greeting context message
3. Triggers a response

```typescript
private async sendGreeting(): Promise<void> {
  if (!this.dc || this.dc.readyState !== 'open') return;
  
  const greeting = this.getTimeBasedGreeting();
  const userName = 'sir'; // Could be loaded from profile
  
  // Inject greeting context
  this.dc.send(JSON.stringify({
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: 'user',
      content: [{
        type: 'input_text',
        text: `[System: You just connected to ${userName}. Greet them with "${greeting}! What can I help you with?" Keep it brief and wait for their response.]`
      }]
    }
  }));
  
  // Trigger AI response
  this.dc.send(JSON.stringify({
    type: 'response.create',
    response: {
      modalities: this.ttsProvider === 'elevenlabs' ? ['text'] : ['text', 'audio']
    }
  }));
}

private getTimeBasedGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
```

### Part 3: Stream Assistant Transcript in Real-Time

**File:** `src/utils/RealtimeVoiceAssistant.ts`

Add handling for `response.audio_transcript.delta` events to emit interim transcripts:

```typescript
case 'response.audio_transcript.delta':
  // Stream assistant's words as they come
  this.accumulatedAssistantText = (this.accumulatedAssistantText || '') + (event.delta || '');
  this.onMessage({
    type: 'transcript.interim',
    role: 'assistant',
    content: this.accumulatedAssistantText,
    isListening: false
  });
  break;

case 'response.audio_transcript.done':
  // Clear accumulator when done
  this.accumulatedAssistantText = '';
  // ... existing code to save transcript
  break;
```

Add instance variable:
```typescript
private accumulatedAssistantText: string = '';
```

### Part 4: Fix Timestamp Display in PhoneDialer

**File:** `src/components/CommsConsole/PhoneDialer.tsx`

Update line 407 to use the user's timezone:
```typescript
{call.timestamp.toLocaleTimeString('en-US', { 
  hour: '2-digit', 
  minute: '2-digit',
  timeZone: userTimezone || 'America/New_York'
})}
```

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/generate-realtime-token/index.ts` | Change VAD from `server_vad` to `semantic_vad`, update transcription model |
| `src/utils/RealtimeVoiceAssistant.ts` | Add greeting trigger, stream assistant transcript deltas, add accumulator variable |
| `src/components/CommsConsole/PhoneDialer.tsx` | Fix timezone on Recent Calls timestamp |

## Technical Details

### Why `semantic_vad` is Better

- **`server_vad`**: Uses simple amplitude thresholds - any noise above threshold = speech
- **`semantic_vad`**: Uses AI to understand when the user is semantically "done" speaking
- Result: No more false triggers from background noise, better turn-taking

### Greeting Flow After Fix

1. User clicks "Call" in PhoneDialer
2. WebRTC connects, session configured
3. `session.updated` event fires
4. `sendGreeting()` injects context and triggers response
5. AI immediately says "Good afternoon! What can I help you with?"
6. Live transcript shows assistant's words streaming

## Verification Steps

After implementation:
- [ ] Connect via PhoneDialer - AI should greet immediately
- [ ] Background noise should not trigger speech detection
- [ ] Live transcript panel shows assistant's words as they stream
- [ ] Recent calls timestamps show correct timezone
- [ ] Voice behavior matches Twilio phone calls
