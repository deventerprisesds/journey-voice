

# Add Message Persistence to WebRTC Voice Assistant

## Problem Identified

WebRTC voice transcripts are **not being persisted** to the database despite the code existing in `RealtimeVoiceAssistant.ts`. The root cause:

The `generate-realtime-token` edge function does **NOT** include `input_audio_transcription` in the OpenAI session configuration. Without this setting, OpenAI never fires the `conversation.item.input_audio_transcription.completed` event, so user speech is never transcribed and saved.

### Evidence

| Query | Result |
|-------|--------|
| `voice_session_id IS NOT NULL` | All 16 results start with `MZ` (Twilio phone calls) |
| `voice_session_id LIKE 'WR%'` | 0 results (no WebRTC transcripts) |
| `activity_log WHERE activity_type = 'voice_webrtc'` | 0 results |

### Code Analysis

| Component | Status |
|-----------|--------|
| `RealtimeVoiceAssistant.ts` lines 674-688 | Event handlers exist for transcripts |
| `RealtimeVoiceAssistant.ts` lines 694-735 | `saveTranscript()` method exists, calls `generate-embeddings` |
| `generate-realtime-token` lines 118-314 | **MISSING** `input_audio_transcription` config |

---

## Solution

### Fix 1: Add `input_audio_transcription` to Session Config

Update `supabase/functions/generate-realtime-token/index.ts` to include the transcription model:

```typescript
// In the session creation request body (around line 126)
body: JSON.stringify({
  model: "gpt-4o-realtime-preview-2024-12-17",
  voice: openaiVoice,
  modalities: modalities,
  input_audio_format: "pcm16",
  output_audio_format: "pcm16",
  // ADD THIS - enables user speech transcription
  input_audio_transcription: {
    model: "whisper-1"
  },
  turn_detection: {
    type: "server_vad",
    threshold: 0.3,
    prefix_padding_ms: 400,
    silence_duration_ms: 1200
  },
  // ... rest of config
})
```

### Fix 2: Ensure Activity Logging Works

The `activity_log` table shows 0 WebRTC sessions. The `logActivity` method exists but may not be persisting correctly. Verify:

1. The `activity_log` table has the `session_id` column with a unique constraint
2. The upsert is working (check for silent failures)

### Fix 3: Add Explicit Error Handling (Per User Preference)

If transcript saving fails, the error is logged via `console.warn` but not surfaced. Add explicit error tracking:

```typescript
// In saveTranscript() method
if (error) {
  console.error('TRANSCRIPT_SAVE_ERROR:', {
    role,
    sessionId: this.sessionId,
    error: error.message
  });
  // Emit error event for visibility
  this.onMessage({
    type: 'transcript.error',
    role,
    error: error.message,
    sessionId: this.sessionId
  });
}
```

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/generate-realtime-token/index.ts` | Add `input_audio_transcription: { model: "whisper-1" }` to session config |
| `src/utils/RealtimeVoiceAssistant.ts` | (Optional) Enhance error handling in `saveTranscript()` |

---

## Expected Flow After Fix

```text
User speaks → OpenAI VAD detects speech end
    ↓
OpenAI Whisper transcribes: "conversation.item.input_audio_transcription.completed"
    ↓
RealtimeVoiceAssistant.handleMessage() receives event
    ↓
saveTranscript('user', event.transcript) called
    ↓
supabase.functions.invoke('generate-embeddings', { action: 'store_conversation', ... })
    ↓
conversation_messages + conversation_embeddings tables updated
    ↓
voice_session_id = "WRxx..." (WebRTC prefix) visible in database
```

---

## Verification Steps

After deploying:

1. Start a WebRTC voice session
2. Speak a few sentences
3. Check console for: `📝 User transcript:` and `💾 Saved user transcript via generate-embeddings`
4. Query database: `SELECT * FROM conversation_messages WHERE voice_session_id LIKE 'WR%' ORDER BY created_at DESC LIMIT 5`
5. Confirm both user and assistant messages are persisted

---

## Technical Notes

- The Twilio bridge already handles this correctly (it calls `generate-embeddings` with the same pattern)
- This follows the memory guideline "code-reuse-over-duplication" - using the existing `generate-embeddings` function
- The `whisper-1` model is OpenAI's transcription model, same as used in the Twilio bridge
- No database schema changes required - using existing `conversation_messages` and `conversation_embeddings` tables

