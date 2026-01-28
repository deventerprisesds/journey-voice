
# Fix: Hard Hangup for End Call Button

## Problem

When clicking "End Call", the AI still speaks because:
1. OpenAI's Realtime API has already started generating a response
2. The current `disconnect()` method closes the data channel **without** first telling OpenAI to stop
3. Any queued or in-progress response continues until the connection fully closes

## Current Code Issue

```typescript
// Lines 1214-1217 - Data channel is closed without canceling response first
if (this.dc) {
  this.dc.close();  // ← Closes connection but doesn't cancel in-flight response
  this.dc = null;
}
```

## Solution

Add `response.cancel` and `input_audio_buffer.clear` commands **before** closing the data channel.

## File to Modify

**`src/utils/RealtimeVoiceAssistant.ts`** - Update `disconnect()` method

## Technical Changes

Insert cancellation commands right after removing from registry (after line 1168) and before audio cleanup:

```typescript
async disconnect() {
  console.log(`[VOICE_INSTANCE] Disconnecting #${this.instanceId}...`);
  
  // Remove from global registry FIRST
  activeInstances.delete(this.instanceId);
  console.log(`[VOICE_INSTANCE] Removed #${this.instanceId}, remaining: ${activeInstances.size}`);
  
  // NEW: Cancel any in-flight OpenAI response IMMEDIATELY
  // This must happen while the data channel is still open
  if (this.dc && this.dc.readyState === 'open') {
    try {
      console.log('🔴 Sending response.cancel to stop AI response');
      this.dc.send(JSON.stringify({ type: 'response.cancel' }));
      this.dc.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
    } catch (e) {
      console.warn('Could not send cancel commands:', e);
    }
  }
  
  // ... rest of existing cleanup continues unchanged
}
```

## Why This Works

The OpenAI Realtime API `response.cancel` event:
- Immediately stops the current response generation
- Prevents any further audio/text from being sent on this response
- Is the official way to abort an in-progress response

This is separate from the graceful `disconnect` tool (which the AI calls when the user says "goodbye") - that tool intentionally lets the AI say a farewell before hanging up.

## Expected Outcome

| Before | After |
|--------|-------|
| User clicks End Call → AI continues speaking | User clicks End Call → immediate silence |
| Response plays to completion | Response canceled instantly |
| Feels like putting phone on speaker then walking away | Feels like hanging up a real phone |
